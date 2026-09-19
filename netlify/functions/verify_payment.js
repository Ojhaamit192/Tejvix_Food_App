const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");

// POST { restaurant, pin, order_id }
// Staff only tap this after actually seeing the payment land — matching the
// amount and the customer's UTR against their own UPI app / bank
// notification. This is what actually protects the restaurant: the UTR
// typed by the customer is not proof by itself, this manual check is.
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
  if (!slug || !pin || !orderId) return err(400, "restaurant, pin and order_id are required");

  const supabase = getSupabase();

  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, admin_pin")
    .eq("slug", slug)
    .single();
  if (restErr || !restaurant) return err(404, "Restaurant not found");
  if (pin !== restaurant.admin_pin) return err(401, "Incorrect PIN");

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .eq("restaurant_id", restaurant.id)
    .single();
  if (orderErr || !order) return err(404, "Order not found");
  if (order.status === "cancelled") return err(409, "This order already auto-cancelled — payment wasn't confirmed in time");

  const { error: updateErr } = await supabase
    .from("orders")
    .update({ payment_status: "paid", payment_verify_deadline: null })
    .eq("id", orderId);
  if (updateErr) return err(500, updateErr.message);

  return ok({ ok: true });
};
