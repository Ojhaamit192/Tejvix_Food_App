const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase, todayDate } = require("./_supabase");

// GET ?restaurant=slug&pin=1234 -> today's summary for the restaurant owner.
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  const params = event.queryStringParameters || {};
  const slug = params.restaurant || "";
  const pin = params.pin || "";
  if (!slug || !pin) return err(400, "restaurant and pin are required");

  const supabase = getSupabase();

  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, name, admin_pin")
    .eq("slug", slug)
    .single();
  if (restErr || !restaurant) return err(404, "Restaurant not found");
  if (pin !== restaurant.admin_pin) return err(401, "Incorrect PIN");

  const day = todayDate();

  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .select("status, order_type, total, payment_status, created_at, order_items(name, qty)")
    .eq("restaurant_id", restaurant.id)
    .eq("day", day);
  if (ordersErr) return err(500, ordersErr.message);

  const rows = orders || [];
  const served = rows.filter((o) => o.status === "served");
  const cancelled = rows.filter((o) => o.status === "cancelled");
  const live = rows.filter((o) => ["received", "preparing", "ready"].includes(o.status));
  const dineIn = rows.filter((o) => o.order_type === "dinein").length;
  const takeaway = rows.filter((o) => o.order_type === "takeaway").length;

  const dishCounts = {};
  rows.forEach((o) => (o.order_items || []).forEach((i) => (dishCounts[i.name] = (dishCounts[i.name] || 0) + i.qty)));
  const popularDish = Object.entries(dishCounts).sort((a, b) => b[1] - a[1])[0];

  const hourCounts = {};
  rows.forEach((o) => {
    const hour = new Date(o.created_at).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });
  const busiestHourEntry = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
  const busiestHour = busiestHourEntry ? `${busiestHourEntry[0]}:00 - ${Number(busiestHourEntry[0]) + 1}:00` : null;

  const revenue = rows.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + Number(o.total), 0);

  const { count: upcomingReservations } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .eq("status", "scheduled");

  const unverifiedNow = rows.filter((o) => o.payment_status === "unverified" && o.status !== "cancelled").length;

  return ok({
    restaurant: restaurant.name,
    day,
    total_orders: rows.length,
    live: live.length,
    served: served.length,
    cancelled: cancelled.length,
    dine_in: dineIn,
    takeaway,
    popular_dish: popularDish ? { name: popularDish[0], qty: popularDish[1] } : null,
    busiest_hour: busiestHour,
    revenue,
    upcoming_reservations: upcomingReservations || 0,
    unverified_payments_now: unverifiedNow,
  });
};
