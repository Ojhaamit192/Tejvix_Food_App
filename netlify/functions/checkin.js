const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase, todayDate } = require("./_supabase");

// POST { restaurant, pin, order_id, table_number }
// Called from the staff panel's Reservations tab when a guest with a
// pre-booked table arrives. Assigns a real kitchen-queue token and table
// number, and flips the order into the normal live-order board.
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
  const tableNumber = (data.table_number || "").trim();

  if (!slug || !pin || !orderId || !tableNumber) {
    return err(400, "restaurant, pin, order_id and table_number are required");
  }

  const supabase = getSupabase();

  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, admin_pin")
    .eq("slug", slug)
    .single();
  if (restErr || !restaurant) return err(404, "Restaurant not found");
  if (pin !== restaurant.admin_pin) return err(401, "Incorrect PIN");

  const { data: reservation, error: resErr } = await supabase
    .from("orders")
    .select("id, day, payment_status")
    .eq("id", orderId)
    .eq("restaurant_id", restaurant.id)
    .eq("status", "scheduled")
    .single();
  if (resErr || !reservation) return err(404, "Reservation not found");
  if (reservation.payment_status === "unverified") {
    return err(409, "Confirm this reservation's payment before checking the guest in");
  }

  const day = todayDate();

  const { data: maxRow } = await supabase
    .from("orders")
    .select("seq")
    .eq("restaurant_id", restaurant.id)
    .eq("day", day)
    .order("seq", { ascending: false })
    .limit(1);
  const seq = maxRow && maxRow.length ? maxRow[0].seq + 1 : 1;

  const { error: updateErr } = await supabase
    .from("orders")
    .update({
      status: "received",
      day,
      seq,
      table_number: tableNumber,
      queued_at: new Date().toISOString(),
    })
    .eq("id", reservation.id);
  if (updateErr) return err(500, updateErr.message);

  return ok({ token: `#${seq}` });
};
