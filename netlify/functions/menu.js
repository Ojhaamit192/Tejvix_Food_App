const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");

// GET ?restaurant=slug -> restaurant info + menu items (available and
// unavailable both included, so the customer page can show "sold out").
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  const slug = (event.queryStringParameters && event.queryStringParameters.restaurant) || "";
  if (!slug) return err(400, "restaurant query param is required");

  const supabase = getSupabase();

  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, name, address, phone, whatsapp, brand_color, photos, upi_id, payment_qr_url, avg_prep_minutes, advance_deposit, razorpay_key_id")
    .eq("slug", slug)
    .single();
  if (restErr || !restaurant) return err(404, "Restaurant not found");

  const { data: items, error: itemsErr } = await supabase
    .from("menu_items")
    .select("id, name, category, price, veg, is_bestseller, is_available, description, sort_order")
    .eq("restaurant_id", restaurant.id)
    .order("sort_order");
  if (itemsErr) return err(500, itemsErr.message);

  return ok({
    restaurant: {
      name: restaurant.name,
      address: restaurant.address,
      phone: restaurant.phone,
      whatsapp: restaurant.whatsapp,
      brand_color: restaurant.brand_color,
      photos: restaurant.photos || [],
      upi_id: restaurant.upi_id,
      payment_qr_url: restaurant.payment_qr_url,
      avg_prep_minutes: restaurant.avg_prep_minutes,
      advance_deposit: restaurant.advance_deposit,
      razorpay_key_id: restaurant.razorpay_key_id,
    },
    items: items || [],
  });
};
