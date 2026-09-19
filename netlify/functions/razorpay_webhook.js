const crypto = require("crypto");
const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");
const { insertOrder } = require("./_create_order");

// POST — configured in each restaurant's own Razorpay Dashboard
// (Settings → Webhooks) pointing at this same URL for every restaurant,
// listening for the "payment.captured" event. Not required for the app to
// work — confirm_razorpay_payment.js already creates the order the instant
// Checkout succeeds — but this exists so a payment that succeeded while the
// customer's browser tab was closed (crash, lost connection, etc.) still
// turns into a real order instead of vanishing.
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") return err(405, "Method not allowed");

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return err(400, "Invalid JSON");
  }

  const paymentEntity = body?.payload?.payment?.entity;
  const razorpayOrderId = paymentEntity?.order_id;
  const razorpayPaymentId = paymentEntity?.id;
  if (body.event !== "payment.captured" || !razorpayOrderId) {
    // Nothing to do for other event types — acknowledge so Razorpay stops retrying.
    return ok({ ignored: true });
  }

  const supabase = getSupabase();

  const { data: pending, error: pendingErr } = await supabase
    .from("pending_orders")
    .select("id, consumed, payload, restaurants(id, name, avg_prep_minutes, razorpay_webhook_secret)")
    .eq("razorpay_order_id", razorpayOrderId)
    .single();
  if (pendingErr || !pending) return ok({ ignored: true }); // unknown order — nothing we can do

  const restaurant = pending.restaurants;
  const webhookSecret = restaurant.razorpay_webhook_secret;
  if (webhookSecret) {
    const signatureHeader = event.headers["x-razorpay-signature"] || event.headers["X-Razorpay-Signature"];
    const expected = crypto.createHmac("sha256", webhookSecret).update(event.body || "").digest("hex");
    if (!signatureHeader || signatureHeader !== expected) {
      return err(400, "Webhook signature verification failed");
    }
  }
  // If the restaurant hasn't set a webhook secret yet, the webhook is
  // simply not trusted to create orders on its own — confirm_razorpay_payment.js
  // remains the only path until a secret is configured (see README).
  if (!webhookSecret) return ok({ ignored: true });

  if (pending.consumed) return ok({ already_processed: true });

  const { data: claimed } = await supabase
    .from("pending_orders")
    .update({ consumed: true })
    .eq("id", pending.id)
    .eq("consumed", false)
    .select("id")
    .single();
  if (!claimed) return ok({ already_processed: true }); // the browser callback won the race

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

  return ok({ ok: true, order_id: result.order_id });
};
