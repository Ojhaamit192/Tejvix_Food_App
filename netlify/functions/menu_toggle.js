const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");

// POST { restaurant, pin, item_id, is_available }
// Lets staff mark a dish "out of stock" the moment the kitchen runs out,
// so it's greyed out (and un-orderable) on the customer menu immediately.
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
  const itemId = (data.item_id || "").trim();
  const isAvailable = !!data.is_available;

  if (!slug || !pin || !itemId) return err(400, "restaurant, pin and item_id are required");

  const supabase = getSupabase();

  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, admin_pin")
    .eq("slug", slug)
    .single();
  if (restErr || !restaurant) return err(404, "Restaurant not found");
  if (pin !== restaurant.admin_pin) return err(401, "Incorrect PIN");

  const { error: updateErr } = await supabase
    .from("menu_items")
    .update({ is_available: isAvailable })
    .eq("id", itemId)
    .eq("restaurant_id", restaurant.id);
  if (updateErr) return err(500, updateErr.message);

  return ok({ ok: true, is_available: isAvailable });
};
