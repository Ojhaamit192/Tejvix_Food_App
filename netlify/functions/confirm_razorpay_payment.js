const crypto = require("crypto");
const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");
const { insertOrder } = require("./_create_order");

// POST { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//
// This is called by the browser the instant Razorpay Checkout's own
// success handler fires. The signature is verified here, server-side,
// against the restaurant's secret key — exactly what makes this a real,
// automatic payment verification instead of the manual UTR-matching flow.
// If the browser tab closes before this call completes (payment succeeded
// but the callback never ran), razorpay_webhook.js is the backstop that
// creates the order anyway once Razorpay's own servers confirm it.
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") return err(405, "Method not allowed");

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    data = {};
  }

  const razorpayOrderId = (data.razorpay_order_id || "").trim();
  const razorpayPaymentId = (data.razorpay_payment_id || "").trim();
  const razorpaySignature = (data.razorpay_signature || "").trim();
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return err(400, "razorpay_order_id, razorpay_payment_id and razorpay_signature are required");
  }

  const supabase = getSupabase();

  const { data: pending, error: pendingErr } = await supabase
    .from("pending_orders")
    .select("id, restaurant_id, consumed, order_id, payload, restaurants(id, name, avg_prep_minutes, razorpay_key_secret)")
    .eq("razorpay_order_id", razorpayOrderId)
    .single();
  if (pendingErr || !pending) return err(404, "No matching payment session found");

  // Already turned into an order — most likely the webhook won the race.
  // Return the same success shape so the browser can just show it.
  if (pending.consumed) {
    if (!pending.order_id) return err(409, "Payment already processed");
    const { data: existing, error: existingErr } = await supabase
      .from("orders")
      .select("id, seq, order_type, booking_type, table_number, scheduled_at, party_size, total, payment_status, status, created_at, order_items(name, price, qty)")
      .eq("id", pending.order_id)
      .single();
    if (existingErr || !existing) return err(409, "Payment already processed");
    return ok({
      order_id: existing.id,
      token: existing.booking_type === "advance" ? "Reserved" : `#${existing.seq}`,
      order_type: existing.order_type,
      booking_type: existing.booking_type,
      table_number: existing.table_number,
      scheduled_at: existing.scheduled_at,
      party_size: existing.party_size,
      items: (existing.order_items || []).map((i) => ({ name: i.name, price: i.price, qty: i.qty })),
      total: existing.total,
      payment_status: existing.payment_status,
      status: existing.status,
      created_at: existing.created_at,
    });
  }

  const restaurant = pending.restaurants;
  const expectedSignature = crypto
    .createHmac("sha256", restaurant.razorpay_key_secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  if (expectedSignature !== razorpaySignature) {
    return err(400, "Payment signature verification failed");
  }

  // Atomically claim this pending order so a concurrent webhook call can't
  // also create it — whichever of the two updates this row first wins.
  const { data: claimed } = await supabase
    .from("pending_orders")
    .update({ consumed: true })
    .eq("id", pending.id)
    .eq("consumed", false)
    .select("id")
    .single();
  if (!claimed) return err(409, "Payment already processed");

  const p = pending.payload;
  let result;
  try {
    result = await insertOrder(
      supabase,
      restaurant,
      {
        name: p.name, phone: p.phone, orderType: p.orderType, bookingType: p.bookingType,
        tableNumber: p.tableNumber, scheduledAt: p.scheduledAt, partySize: p.partySize,
        lineItems: p.lineItems, subtotal: p.subtotal, tax: p.tax, total: p.total, notes: p.notes,
      },
      { paymentMethod: "razorpay", paymentStatus: "paid", razorpayPaymentId, razorpayOrderId }
    );
  } catch (e) {
    return err(500, e.message);
  }

  await supabase.from("pending_orders").update({ order_id: result.order_id }).eq("id", pending.id);

  return ok(result);
};
