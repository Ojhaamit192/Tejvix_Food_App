const { todayDate } = require("./_supabase");

const LOYALTY_EVERY = 5; // every 5th order at a restaurant gets a reward message

/**
 * payload: {
 *   name, phone, orderType, bookingType, tableNumber, scheduledAt, partySize,
 *   lineItems: [{ menu_item_id, name, price, qty }], subtotal, tax, total, notes
 * }
 * paymentInfo: {
 *   paymentMethod: "upi" | "counter" | "razorpay",
 *   paymentStatus: "unverified" | "paid",
 *   paymentUtr, paymentVerifyDeadline,   -- only used for the manual "upi" flow
 *   razorpayPaymentId, razorpayOrderId,  -- only used for the "razorpay" flow
 * }
 */
async function insertOrder(supabase, restaurant, payload, paymentInfo) {
  const {
    name, phone, orderType, bookingType, tableNumber, scheduledAt, partySize,
    lineItems, subtotal, tax, total, notes,
  } = payload;

  const day = bookingType === "advance" ? new Date(scheduledAt).toISOString().slice(0, 10) : todayDate();

  // Walk-in / order-now gets a real kitchen-queue number immediately.
  // An advance reservation gets its real number at check-in (see checkin.js).
  let seq = 0;
  if (bookingType === "now") {
    const { data: maxRow } = await supabase
      .from("orders")
      .select("seq")
      .eq("restaurant_id", restaurant.id)
      .eq("day", day)
      .order("seq", { ascending: false })
      .limit(1);
    seq = maxRow && maxRow.length ? maxRow[0].seq + 1 : 1;
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      restaurant_id: restaurant.id,
      day,
      seq,
      customer_name: name,
      phone,
      order_type: orderType,
      table_number: orderType === "dinein" && bookingType === "now" ? tableNumber : null,
      booking_type: bookingType,
      scheduled_at: bookingType === "advance" ? scheduledAt : null,
      party_size: bookingType === "advance" ? partySize : null,
      payment_method: paymentInfo.paymentMethod,
      payment_status: paymentInfo.paymentStatus,
      payment_utr: paymentInfo.paymentUtr || null,
      payment_verify_deadline: paymentInfo.paymentVerifyDeadline || null,
      razorpay_payment_id: paymentInfo.razorpayPaymentId || null,
      razorpay_order_id: paymentInfo.razorpayOrderId || null,
      status: bookingType === "advance" ? "scheduled" : "received",
      subtotal,
      tax,
      total,
      notes,
    })
    .select("id, created_at")
    .single();
  if (orderErr) throw new Error(orderErr.message);

  if (lineItems.length) {
    const { error: itemsErr } = await supabase.from("order_items").insert(
      lineItems.map((i) => ({
        order_id: order.id,
        menu_item_id: i.menu_item_id,
        name: i.name,
        price: i.price,
        qty: i.qty,
      }))
    );
    if (itemsErr) throw new Error(itemsErr.message);
  }

  // Loyalty: count this phone's past orders at this restaurant (all time).
  const { count: pastOrders } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .eq("phone", phone)
    .neq("status", "cancelled");
  const visitNumber = (pastOrders || 0) + 1; // includes the order just placed
  let loyaltyMessage = null;
  if (visitNumber % LOYALTY_EVERY === 0) {
    loyaltyMessage = `This is your order #${visitNumber} with ${restaurant.name} — ask staff about your loyalty reward!`;
  }

  return {
    order_id: order.id,
    token: bookingType === "advance" ? "Reserved" : `#${seq}`,
    order_type: orderType,
    booking_type: bookingType,
    table_number: tableNumber || null,
    scheduled_at: bookingType === "advance" ? scheduledAt : null,
    party_size: bookingType === "advance" ? partySize : null,
    items: lineItems,
    subtotal,
    tax,
    total,
    payment_status: paymentInfo.paymentStatus,
    estimated_minutes: restaurant.avg_prep_minutes,
    status: bookingType === "advance" ? "scheduled" : "received",
    loyalty_message: loyaltyMessage,
    created_at: order.created_at,
  };
}

module.exports = { insertOrder };
