const { CORS_HEADERS, ok, err } = require("./_shared");
const { getSupabase } = require("./_supabase");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("restaurants")
    .select("slug, name, address, phone, brand_color, photos")
    .order("name");

  if (error) return err(500, error.message);
  return ok({ restaurants: data });
};
