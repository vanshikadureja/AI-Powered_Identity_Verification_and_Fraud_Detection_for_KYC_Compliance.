// src/api.js
const API_BASE = process.env.REACT_APP_API_BASE || "http://127.0.0.1:5000";
const FRAUD_BASE = process.env.REACT_APP_FRAUD_BASE || "http://127.0.0.1:8000";

/**
 * Helper: fetch JSON with timeout and improved errors.
 * @param {string} url
 * @param {object} options
 * @param {number} timeoutMs
 */
async function fetchJson(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);

    // Non-2xx
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `Request failed (${res.status}) ${res.statusText}`;
      // try to parse json error message if available
      try {
        const json = JSON.parse(text || "{}");
        if (json.error) msg += ` — ${json.error}`;
        else if (json.message) msg += ` — ${json.message}`;
      } catch (e) {
        if (text) msg += ` — ${text.substring(0, 200)}`;
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }

    // If no content
    if (res.status === 204) return null;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await res.json();
    } else {
      // fallback to text
      return await res.text();
    }
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

/* -------------------------
   API helpers
   ------------------------- */

/**
 * Accepts either a File or FormData.
 * If a File provided, a FormData with key "aadhaar" will be created.
 */
export async function extractAadhaar(input) {
  let fd;
  if (input instanceof FormData) {
    fd = input;
  } else {
    fd = new FormData();
    fd.append("aadhaar", input);
  }
  return await fetchJson(`${API_BASE}/extract_aadhaar`, {
    method: "POST",
    body: fd,
  });
}

export async function extractPan(input) {
  let fd;
  if (input instanceof FormData) {
    fd = input;
  } else {
    fd = new FormData();
    fd.append("pan", input);
  }
  return await fetchJson(`${API_BASE}/extract_pan`, {
    method: "POST",
    body: fd,
  });
}

/**
 * Submit KYC.
 * Accepts either a FormData (recommended) or a plain object (will be converted to FormData).
 */
export async function submitKyc(data) {
  let fd;
  if (data instanceof FormData) {
    fd = data;
  } else {
    fd = new FormData();
    Object.keys(data || {}).forEach((k) => {
      const v = data[k];
      // If array or object, stringify (except File)
      if (v instanceof File) fd.append(k, v);
      else if (Array.isArray(v) || typeof v === "object") fd.append(k, JSON.stringify(v));
      else if (v !== undefined && v !== null) fd.append(k, String(v));
    });
  }
  return await fetchJson(`${API_BASE}/submit-kyc`, {
    method: "POST",
    body: fd,
  });
}

/* Data retrieval */
export async function getKycData() {
  return await fetchJson(`${API_BASE}/get_kyc_data`);
}

/* Fraud aggregate (separate service) */
export async function getFraudAggregate() {
  return await fetchJson(`${FRAUD_BASE}/fraud-aggregate`);
}

/* Approve / reject / flag endpoints */
export async function approve(id) {
  return await fetchJson(`${API_BASE}/approve/${encodeURIComponent(id)}`, {
    method: "POST",
  });
}

export async function rejectKyc(id) {
  return await fetchJson(`${API_BASE}/reject/${encodeURIComponent(id)}`, {
    method: "POST",
  });
}

export async function flagKyc(id) {
  return await fetchJson(`${API_BASE}/flag/${encodeURIComponent(id)}`, {
    method: "POST",
  });
}

/* default export for convenience */
export default {
  extractAadhaar,
  extractPan,
  submitKyc,
  getKycData,
  getFraudAggregate,
  approve,
  rejectKyc,
  flagKyc,
};