const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");

// GET ?restaurant=slug&pin=1234 -> all not-yet-arrived reservations (soonest first).
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

  // An unpaid/unverified reservation past its window auto-cancels here.
  await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("restaurant_id", restaurant.id)
    .eq("status", "scheduled")
    .eq("payment_status", "unverified")
    .lt("payment_verify_deadline", new Date().toISOString());

  const { data, error } = await supabase
    .from("orders")
    .select("id, customer_name, phone, party_size, scheduled_at, total, payment_status, payment_utr, payment_verify_deadline, notes, order_items(name, qty)")
    .eq("restaurant_id", restaurant.id)
    .eq("status", "scheduled")
    .order("scheduled_at");
  if (error) return err(500, error.message);

  return ok({
    reservations: (data || []).map((r) => ({
      id: r.id,
      name: r.customer_name,
      phone: r.phone,
      party_size: r.party_size,
      scheduled_at: r.scheduled_at,
      total: r.total,
      payment_status: r.payment_status,
      payment_utr: r.payment_utr,
      payment_verify_deadline: r.payment_verify_deadline,
      notes: r.notes,
      pre_ordered: (r.order_items || []).map((i) => `${i.qty}× ${i.name}`).join(", "),
    })),
  });
};
