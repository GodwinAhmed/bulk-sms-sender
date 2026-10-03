/**
 * BulkSMS helpers shared by the Pages Functions.
 * Ported from the original Express server (v1.1 fixes preserved).
 */

const BULKSMS_API = 'https://api.bulksms.com/v1';
const E164_PATTERN = /^\+\d{10,15}$/;

// 60ms between sequential sends — sending BulkSMS requests back-to-back with
// no gap has been observed to trigger bare, empty-bodied 400s from their API.
const SEND_DELAY_MS = 60;

export function buildAuthHeader(tokenId, tokenSecret) {
  const bytes = new TextEncoder().encode(`${tokenId}:${tokenSecret}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/**
 * [^}]+ (not \w+) so column names with spaces, e.g. "{{Patient Name}}", resolve.
 * Column lookup is case-insensitive.
 */
export function interpolate(template, row) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmedKey = key.trim();
    const match = Object.keys(row).find(
      k => k.trim().toLowerCase() === trimmedKey.toLowerCase()
    );
    return match !== undefined ? String(row[match] ?? '') : `{{${key}}}`;
  });
}

/**
 * Handles E.164, country code without +, standard 0XXXXXXXXX, and
 * 9-digit numbers whose leading 0 was stripped by Excel.
 */
export function normalizePhone(raw, countryPrefix = '27') {
  if (!raw) return raw;
  let phone = String(raw).replace(/\s+/g, '').replace(/[^\d+]/g, '');

  if (phone.startsWith('+')) return phone;

  if (phone.startsWith(countryPrefix) && phone.length === countryPrefix.length + 9) {
    phone = '0' + phone.slice(countryPrefix.length);
  }

  if (phone.length === 9 && !phone.startsWith('0')) {
    phone = '0' + phone;
  }

  if (phone.startsWith('0') && phone.length === 10) {
    return '+' + countryPrefix + phone.slice(1);
  }

  return '+' + phone;
}

async function describeBulkSmsError(response) {
  const text = await response.text().catch(() => '');
  if (!text) return `HTTP ${response.status}: empty response body from BulkSMS`;
  try {
    const data = JSON.parse(text);
    const detail = data.detail || data.title || data.message || text;
    return `HTTP ${response.status}: ${detail}`;
  } catch {
    return `HTTP ${response.status}: ${text}`;
  }
}

/**
 * Sends one message at a time so one invalid record does not fail the batch.
 * Returns { results, errors } in the same shape the frontend already renders.
 */
export async function sendMessages(messages, { tokenId, tokenSecret }) {
  const authHeader = buildAuthHeader(tokenId, tokenSecret);
  const results = [], errors = [];

  for (const m of messages) {
    const to = String(m.to || '').trim();
    const body = String(m.body || '').trim();

    if (!to || !body) {
      errors.push({ to, body, error: 'Validation failed: missing recipient or message body.' });
      continue;
    }
    if (!E164_PATTERN.test(to)) {
      errors.push({ to, body, error: 'Validation failed: phone must be E.164 format, e.g. +27821234567.' });
      continue;
    }

    try {
      const response = await fetch(`${BULKSMS_API}/messages`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, body }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const error = await describeBulkSmsError(response);
        console.error(`[SEND ERR] ${to} -> ${error}`);
        errors.push({ to, body, error });
      } else {
        const data = await response.json().catch(() => null);
        const r = Array.isArray(data) ? data[0] : data;
        results.push({
          to,
          body,
          status: r?.status?.type || 'SUBMITTED',
          messageId: r?.id,
          creditCost: r?.creditCost,
        });
      }
    } catch (err) {
      console.error(`[SEND ERR] ${to} -> ${err.message}`);
      errors.push({ to, body, error: err.message });
    }

    await new Promise(resolve => setTimeout(resolve, SEND_DELAY_MS));
  }

  return { results, errors };
}

export async function getBalance({ tokenId, tokenSecret }) {
  const response = await fetch(`${BULKSMS_API}/profile`, {
    headers: { Authorization: buildAuthHeader(tokenId, tokenSecret) },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(await describeBulkSmsError(response));
  const data = await response.json();
  return data?.credits?.balance ?? 'N/A';
}
