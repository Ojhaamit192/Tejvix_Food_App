const { createClient } = require("@supabase/supabase-js");

let client = null;

/**
 * Returns a singleton Supabase client authenticated with the SERVICE ROLE
 * key. This key is secret and must only ever be used server-side (here, in
 * Netlify functions) — never send it to the browser. It bypasses Row Level
 * Security, which is why supabase/schema.sql adds no public policies: the
 * only door in is through these functions.
 */
function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  }

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { getSupabase, todayDate };
