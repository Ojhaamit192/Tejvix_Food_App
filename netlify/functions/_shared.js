const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(body) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
function err(statusCode, message) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: message }) };
}

module.exports = { CORS_HEADERS, ok, err };
