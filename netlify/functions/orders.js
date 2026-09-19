const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase, todayDate } = require("./_supabase");

// GET ?restaurant=slug&pin=1234 -> today's live orders (received, preparing,
// ready) with their line items, oldest first — the kitchen display feed.
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
    .select("id, admin_pin")
    .eq("slug", slug)
    .single();
  if (restErr || !restaurant) return err(404, "Restaurant not found");
  if (pin !== restaurant.admin_pin) return err(401, "Incorrect PIN");

  const day = todayDate();

  // Any UPI order still "unverified" past its deadline auto-cancels here,
  // the moment the kitchen board (or the customer's tracking page) next
  // polls — no separate scheduled job needed.
  await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("restaurant_id", restaurant.id)
    .eq("day", day)
    .eq("payment_status", "unverified")
    .lt("payment_verify_deadline", new Date().toISOString())
    .in("status", ["received", "preparing", "ready"]);

  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .select("id, seq, customer_name, phone, order_type, table_number, payment_method, payment_status, payment_utr, payment_verify_deadline, status, total, notes, created_at, queued_at, order_items(name, qty, price)")
    .eq("restaurant_id", restaurant.id)
    .eq("day", day)
    .in("status", ["received", "preparing", "ready"])
    .order("created_at");
  if (ordersErr) return err(500, ordersErr.message);

  return ok({
    orders: (orders || []).map((o) => ({
      id: o.id,
      token: `#${o.seq}`,
      name: o.customer_name,
      phone: o.phone,
      order_type: o.order_type,
      table_number: o.table_number,
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      payment_utr: o.payment_utr,
      payment_verify_deadline: o.payment_verify_deadline,
      status: o.status,
      total: o.total,
      notes: o.notes,
      created_at: o.created_at,
      queued_at: o.queued_at || o.created_at,
      items: (o.order_items || []).map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    })),
  });
};
