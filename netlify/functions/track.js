const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");

// GET ?order_id=... -> lets the customer's browser poll for status updates
// without any PIN. Only the fields a customer should see are returned.
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  const orderId = (event.queryStringParameters && event.queryStringParameters.order_id) || "";
  if (!orderId) return err(400, "order_id query param is required");

  const supabase = getSupabase();

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, seq, status, order_type, booking_type, table_number, scheduled_at, party_size, total, payment_status, payment_verify_deadline, created_at, ready_at, restaurants(name, avg_prep_minutes)")
    .eq("id", orderId)
    .single();
  if (error || !order) return err(404, "Order not found");

  // If this order's own payment window has lapsed unverified, auto-cancel
  // it right here so the customer sees the true state on their next poll.
  let status = order.status;
  if (
    order.payment_status === "unverified" &&
    order.payment_verify_deadline &&
    new Date(order.payment_verify_deadline).getTime() < Date.now() &&
    ["received", "preparing", "ready"].includes(status)
  ) {
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    status = "cancelled";
  }

  return ok({
    token: status === "scheduled" ? "Reserved" : `#${order.seq}`,
    status,
    order_type: order.order_type,
    booking_type: order.booking_type,
    table_number: order.table_number,
    scheduled_at: order.scheduled_at,
    party_size: order.party_size,
    total: order.total,
    payment_status: order.payment_status,
    restaurant_name: order.restaurants ? order.restaurants.name : "",
    estimated_minutes: order.restaurants ? order.restaurants.avg_prep_minutes : 20,
    created_at: order.created_at,
    ready_at: order.ready_at,
  });
};
