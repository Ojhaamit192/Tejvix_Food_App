const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");
const { insertOrder } = require("./_create_order");

const TAX_RATE = 0.05;
const MAX_ADVANCE_DAYS = 7;
const VERIFY_WINDOW_MINUTES = 10; // an unverified UPI order auto-cancels if staff don't confirm it in time

// This is the MANUAL payment path: a restaurant with no Razorpay keys set
// up shows its own UPI QR and asks the customer to type in the UTR, which
// staff then confirm by hand (see verify_payment.js). A restaurant with
// Razorpay configured uses create_payment_order.js + confirm_razorpay_payment.js
// instead — Razorpay verifies the payment automatically, no staff step needed.
//
// POST body:
// {
//   restaurant, name, phone,
//   order_type: "dinein" | "takeaway",
//   booking_type: "now" | "advance",
//   table_number,                 -- required for dinein + booking_type "now"
//   scheduled_at,                 -- ISO string, required for booking_type "advance"
//   party_size,                   -- required for booking_type "advance"
//   payment_method: "upi" | "counter",
//   payment_utr,                  -- required when payment_method is "upi"
//   items: [{ id, qty }],         -- may be empty for an "advance" reservation with no pre-order
//   notes
// }
//
// Prices are always re-read from the database here — never trusted from the
// browser. payment_status is likewise decided here, not by the client: a
// UPI order always starts "unverified" until a staff member confirms it.
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
  const paymentMethod = data.payment_method === "counter" ? "counter" : "upi";
  const paymentUtr = (data.payment_utr || "").trim();
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
  if (paymentMethod === "upi" && !/^[a-zA-Z0-9]{6,20}$/.test(paymentUtr)) {
    return err(400, "A valid UPI reference/UTR number (from your payment app) is required");
  }

  const supabase = getSupabase();

  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, name, avg_prep_minutes, advance_deposit, upi_id, payment_qr_url, razorpay_key_id")
    .eq("slug", slug)
    .single();
  if (restErr || !restaurant) return err(404, "Restaurant not found");
  if (restaurant.razorpay_key_id) {
    return err(400, "This restaurant uses Razorpay for payment — please use the app's payment button, not this endpoint");
  }
  if (paymentMethod === "upi" && !restaurant.upi_id && !restaurant.payment_qr_url) {
    return err(400, "This restaurant hasn't set up UPI payments yet — please choose pay at counter");
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
    // Reserving a table with no food chosen yet — a flat advance deposit confirms the booking.
    subtotal = Number(restaurant.advance_deposit);
    tax = 0;
    total = subtotal;
  } else {
    subtotal = lineItems.reduce((sum, i) => sum + i.price * i.qty, 0);
    tax = Math.round(subtotal * TAX_RATE);
    total = subtotal + tax;
  }

  // Counter payments are trusted immediately (cash changes hands in person).
  // UPI payments start "unverified" — staff match the UTR against their own
  // bank/UPI notification and confirm it (see verify_payment.js) before the
  // kitchen starts preparing. If nobody confirms within the window, the
  // order auto-cancels the next time the kitchen board or tracking page is
  // polled (see the expiry sweep in orders.js / track.js).
  const paymentStatus = paymentMethod === "counter" ? "paid" : "unverified";
  const paymentVerifyDeadline =
    paymentMethod === "upi" ? new Date(Date.now() + VERIFY_WINDOW_MINUTES * 60 * 1000).toISOString() : null;

  let result;
  try {
    result = await insertOrder(
      supabase,
      restaurant,
      {
        name, phone, orderType, bookingType,
        tableNumber, scheduledAt: scheduledAtRaw, partySize,
        lineItems, subtotal, tax, total, notes,
      },
      { paymentMethod, paymentStatus, paymentUtr: paymentMethod === "upi" ? paymentUtr : null, paymentVerifyDeadline }
    );
  } catch (e) {
    return err(500, e.message);
  }

  return ok(result);
};
