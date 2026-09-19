const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

let client = null;

/**
 * Returns a singleton Supabase client authenticated with the SERVICE ROLE
 * key. This key is secret and must only ever be used server-side (here, in
 * Netlify functions) — never send it to the browser. It bypasses Row Level
 * Security, which is why supabase/schema.sql adds no public policies: the
 * only door in is through these functions.
 *
 * The `realtime.transport` option below is a workaround: supabase-js's
 * Realtime client (which we never actually use — no function here
 * subscribes to anything) insists on a native WebSocket constructor, which
 * only exists in Node 22+. Netlify's function runtime is currently on an
 * older Node version, so without this, every single function call crashes
 * with "Node.js detected but native WebSocket not found" before it even
 * reaches our code. Passing the `ws` package in satisfies that check.
 */
function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket },
  });
  return client;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { getSupabase, todayDate };
