// Thin wrapper around the BlessedTexts SMS API (sms.blessedtexts.com).
// Endpoint and field names (api_key, sender_id, phone, message) confirmed
// against the account owner's BlessedTexts API documentation.
const BLESSEDTEXTS_API_URL = process.env.BLESSEDTEXTS_API_URL || "https://sms.blessedtexts.com/api/sms/v1/sendsms";
const BLESSEDTEXTS_API_KEY = process.env.BLESSEDTEXTS_API_KEY;
const BLESSEDTEXTS_SENDER_ID = process.env.BLESSEDTEXTS_SENDER_ID;

async function sendSms(to, message) {
  if (!to) return { ok: false, error: "No phone number provided." };
  if (!BLESSEDTEXTS_API_KEY) {
    const warning = `BLESSEDTEXTS_API_KEY not set — would have texted ${to}: "${message}"`;
    console.warn(`[sms] ${warning}`);
    return { ok: false, error: warning };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s hard cap — never let this hang a request
  try {
    // ---- BLESSEDTEXTS CONFIG (confirmed against their API docs) ----
    const body = { api_key: BLESSEDTEXTS_API_KEY, sender_id: BLESSEDTEXTS_SENDER_ID, phone: to, message };
    // -----------------------------------------------------------------
    const res = await fetch(BLESSEDTEXTS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("[sms] BlessedTexts request failed:", res.status, data);
      return { ok: false, status: res.status, response: data, error: `BlessedTexts returned ${res.status}: ${JSON.stringify(data)}` };
    }
    return { ok: true, status: res.status, response: data };
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[sms] BlessedTexts request timed out after 15s");
      return { ok: false, error: "BlessedTexts request timed out after 15s" };
    }
    console.error("[sms] BlessedTexts request error:", err.message);
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendSms };
