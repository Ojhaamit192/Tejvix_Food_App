const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");

const ALLOWED = ["received", "preparing", "ready", "served", "cancelled"];

// POST { restaurant, pin, order_id, status }
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
  const pin = (data.pin || "").trim();
  const orderId = (data.order_id || "").trim();
  const status = (data.status || "").trim();

  if (!slug || !pin || !orderId || !ALLOWED.includes(status)) {
    return err(400, "restaurant, pin, order_id and a valid status are required");
  }

  const supabase = getSupabase();

  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, admin_pin")
    .eq("slug", slug)
    .single();
  if (restErr || !restaurant) return err(404, "Restaurant not found");
  if (pin !== restaurant.admin_pin) return err(401, "Incorrect PIN");

  if (status === "preparing") {
    const { data: order, error: orderFetchErr } = await supabase
      .from("orders")
      .select("payment_status")
      .eq("id", orderId)
      .eq("restaurant_id", restaurant.id)
      .single();
    if (orderFetchErr || !order) return err(404, "Order not found");
    if (order.payment_status === "unverified") {
      return err(409, "Confirm the customer's payment before starting preparation");
    }
  }

  const patch = { status };
  if (status === "ready") patch.ready_at = new Date().toISOString();
  if (status === "served") patch.served_at = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .eq("restaurant_id", restaurant.id);
  if (updateErr) return err(500, updateErr.message);

  return ok({ ok: true, status });
};
