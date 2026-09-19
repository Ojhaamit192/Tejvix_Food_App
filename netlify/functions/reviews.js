const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");

// GET ?restaurant=slug -> average rating + count, for the directory card.
// POST { order_id, rating, comment } -> submit a review after collecting the order.
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  const supabase = getSupabase();

  if (event.httpMethod === "GET") {
    const slug = (event.queryStringParameters && event.queryStringParameters.restaurant) || "";
    if (!slug) return err(400, "restaurant query param is required");

    const { data: restaurant, error: restErr } = await supabase
      .from("restaurants")
      .select("id")
      .eq("slug", slug)
      .single();
    if (restErr || !restaurant) return err(404, "Restaurant not found");

    const { data, error } = await supabase.from("reviews").select("rating").eq("restaurant_id", restaurant.id);
    if (error) return err(500, error.message);

    const count = data.length;
    const average = count ? data.reduce((sum, r) => sum + r.rating, 0) / count : null;
    return ok({ average: average ? Math.round(average * 10) / 10 : null, count });
  }

  if (event.httpMethod === "POST") {
    let data;
    try {
      data = JSON.parse(event.body || "{}");
    } catch {
      data = {};
    }

    const orderId = (data.order_id || "").trim();
    const rating = Number(data.rating);
    const comment = (data.comment || "").trim();

    if (!orderId || !rating || rating < 1 || rating > 5) {
      return err(400, "order_id and a rating (1-5) are required");
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, restaurant_id")
      .eq("id", orderId)
      .single();
    if (orderErr || !order) return err(404, "Order not found");

    const { error: insertErr } = await supabase.from("reviews").insert({
      restaurant_id: order.restaurant_id,
      order_id: order.id,
      rating,
      comment,
    });
    if (insertErr) return err(500, insertErr.message);

    return ok({ ok: true });
  }

  return err(405, "Method not allowed");
};
