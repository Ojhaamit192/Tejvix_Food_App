const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");

const TAX_RATE = 0.05;
const MAX_ADVANCE_DAYS = 7;

// POST body: same shape as order.js's body, minus any payment fields —
// this endpoint decides the amount itself, from the database, and Razorpay
// decides how payment happens. Returns { razorpay_order_id, key_id, amount }
// for the browser to open Razorpay Checkout with. The order itself is only
// created afterwards, once payment is verified (see confirm_razorpay_payment.js
// and razorpay_webhook.js) — this call never touches the `orders` table.
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

  const slug = (data.restaurant || "").trim();
  const name = (data.name || "").trim();
  const phone = (data.phone || "").trim();
  const orderType = data.order_type === "takeaway" ? "takeaway" : "dinein";
  const bookingType = data.booking_type === "advance" ? "advance" : "now";
  const tableNumber = (data.table_number || "").trim();
  const scheduledAtRaw = (data.scheduled_at || "").trim();
  const partySize = parseInt(data.party_size, 10) || 0;
  const notes = (data.notes || "").trim();
  const requestedItems = Array.isArray(data.items) ? data.items : [];

  if (!slug || !name || !phone.match(/^\d{10}$/)) {
    return err(400, "restaurant, name and a valid 10-digit phone are required");
  }
  if (orderType === "takeaway" && bookingType === "advance") {
    return err(400, "Advance booking is only available for dine-in");
  }
  if (orderType === "dinein" && bookingType === "now" && !tableNumber) {
    return err(400, "table_number is required for a dine-in order placed now");
  }
  if (bookingType === "advance") {
    if (!scheduledAtRaw) return err(400, "scheduled_at is required to reserve a table");
    if (!partySize || partySize < 1) return err(400, "party_size is required to reserve a table");
    const when = new Date(scheduledAtRaw);
    if (isNaN(when.getTime())) return err(400, "scheduled_at is not a valid date/time");
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + MAX_ADVANCE_DAYS);
    if (when.getTime() < Date.now() - 5 * 60 * 1000) return err(400, "scheduled_at must be in the future");
    if (when.getTime() > maxDate.getTime()) return err(400, `Reservations can only be made up to ${MAX_ADVANCE_DAYS} days ahead`);
  } else if (!requestedItems.length) {
    return err(400, "At least one item is required");
  }

  const supabase = getSupabase();

  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, name, avg_prep_minutes, advance_deposit, razorpay_key_id, razorpay_key_secret")
    .eq("slug", slug)
    .single();
  if (restErr || !restaurant) return err(404, "Restaurant not found");
  if (!restaurant.razorpay_key_id || !restaurant.razorpay_key_secret) {
    return err(400, "This restaurant hasn't set up Razorpay");
  }

  const itemIds = requestedItems.map((i) => i.id);
  let lineItems = [];
  if (itemIds.length) {
    const { data: menuRows, error: menuErr } = await supabase
      .from("menu_items")
      .select("id, name, price, is_available")
      .eq("restaurant_id", restaurant.id)
      .in("id", itemIds);
    if (menuErr) return err(500, menuErr.message);

    const menuById = {};
    (menuRows || []).forEach((m) => (menuById[m.id] = m));

    for (const req of requestedItems) {
      const item = menuById[req.id];
      const qty = Math.max(1, parseInt(req.qty, 10) || 1);
      if (!item) return err(400, `Item ${req.id} not found on this menu`);
      if (!item.is_available) return err(409, `"${item.name}" just went out of stock — please remove it and try again`);
      lineItems.push({ menu_item_id: item.id, name: item.name, price: Number(item.price), qty });
    }
  }

  let subtotal, tax, total;
  if (!lineItems.length && bookingType === "advance") {
    subtotal = Number(restaurant.advance_deposit);
    tax = 0;
    total = subtotal;
  } else {
    subtotal = lineItems.reduce((sum, i) => sum + i.price * i.qty, 0);
    tax = Math.round(subtotal * TAX_RATE);
    total = subtotal + tax;
  }

  const amountPaise = Math.round(total * 100);
  const authHeader = "Basic " + Buffer.from(`${restaurant.razorpay_key_id}:${restaurant.razorpay_key_secret}`).toString("base64");

  let razorpayOrder;
  try {
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: `tf_${Date.now()}`,
        notes: { restaurant: slug, customer: name, phone },
      }),
    });
    razorpayOrder = await rzpRes.json();
    if (!rzpRes.ok) return err(502, razorpayOrder.error?.description || "Razorpay couldn't create the payment order");
  } catch (e) {
    return err(502, "Couldn't reach Razorpay — please try again");
  }

  const payload = {
    name, phone, orderType, bookingType,
    tableNumber, scheduledAt: scheduledAtRaw, partySize,
    lineItems, subtotal, tax, total, notes,
  };

  const { error: pendingErr } = await supabase.from("pending_orders").insert({
    restaurant_id: restaurant.id,
    razorpay_order_id: razorpayOrder.id,
    amount: total,
    payload,
  });
  if (pendingErr) return err(500, pendingErr.message);

  return ok({
    razorpay_order_id: razorpayOrder.id,
    key_id: restaurant.razorpay_key_id,
    amount: amountPaise,
    total,
  });
};
