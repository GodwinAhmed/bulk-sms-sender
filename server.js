/**
 * BulkSMS Sender — Server
 * Ultrand.Tech / AutomataCore
 * ---
 * FIX v1.1:
 *   - interpolate() regex changed from \w+ to [^}]+ so column names
 *     with spaces (e.g. "Patient Name", "Centre Phone") resolve correctly
 *   - normalizePhone() made more robust for 9-digit numbers missing leading 0
 */

require('dotenv').config();
const express  = require('express');
const multer   = require('multer');
const XLSX     = require('xlsx');
const axios    = require('axios');
const cors     = require('cors');
const path     = require('path');

const app    = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB, matches UI copy
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAuthHeader(tokenId, tokenSecret) {
  return `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`;
}

/**
 * FIX: was /\{\{(\w+)\}\}/g — \w+ does NOT match spaces, so
 * "{{Patient Name}}" and "{{Centre Phone}}" were never replaced.
 * Changed to [^}]+ which matches any character except } including spaces.
 */
function interpolate(template, row) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmedKey = key.trim();
    // Case-insensitive match
    const match = Object.keys(row).find(
      k => k.trim().toLowerCase() === trimmedKey.toLowerCase()
    );
    return match !== undefined ? String(row[match] ?? '') : `{{${key}}}`;
  });
}

/**
 * FIX: handle numbers that arrive as 9-digit strings (leading 0 stripped by Excel).
 * Also handles full E.164, +27, 27-prefix, and standard 0XXXXXXXXX formats.
 */
function normalizePhone(raw, countryPrefix = '27') {
  if (!raw) return raw;
  let phone = String(raw).replace(/\s+/g, '').replace(/[^\d+]/g, '');

  // Already E.164
  if (phone.startsWith('+')) return phone;

  // Strip leading country code without +
  if (phone.startsWith(countryPrefix) && phone.length === 2 + 9) {
    phone = '0' + phone.slice(countryPrefix.length);
  }

  // 9 digits — missing leading 0 (Excel ate it)
  if (phone.length === 9 && !phone.startsWith('0')) {
    phone = '0' + phone;
  }

  // Now should be 10 digits starting with 0
  if (phone.startsWith('0') && phone.length === 10) {
    return '+' + countryPrefix + phone.slice(1);
  }

  // Fallback: just prefix with +
  return '+' + phone;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post('/api/parse', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'File exceeds the 10 MB limit.'
        : err.message;
      return res.status(400).json({ error: message });
    }
    handleParse(req, res);
  });
});

function handleParse(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const workbook  = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet     = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: '',
      raw:    false,  // All values as strings — preserves leading zeros on phone numbers
    });

    if (!rows.length) return res.status(400).json({ error: 'Spreadsheet is empty or unreadable.' });

    const columns = Object.keys(rows[0]);

    res.json({
      sheetName,
      totalRows: rows.length,
      columns,
      preview:   rows.slice(0, 5),
      rows,
    });
  } catch (err) {
    res.status(500).json({ error: `Parse error: ${err.message}` });
  }
}

app.post('/api/send', async (req, res) => {
  const {
    tokenId,
    tokenSecret,
    phoneColumn,
    messageTemplate,
    rows,
    testMode = false,
    countryPrefix = '27',
  } = req.body;

  if (!tokenId || !tokenSecret) return res.status(400).json({ error: 'API credentials required.' });
  if (!phoneColumn)              return res.status(400).json({ error: 'Phone column not selected.' });
  if (!messageTemplate?.trim())  return res.status(400).json({ error: 'Message template is empty.' });
  if (!rows?.length)             return res.status(400).json({ error: 'No contacts to send to.' });

  const authHeader = buildAuthHeader(tokenId, tokenSecret);

  const messages = rows.map(row => ({
    to:   normalizePhone(String(row[phoneColumn] ?? ''), countryPrefix),
    body: interpolate(messageTemplate, row),
  }));

  if (testMode) {
    return res.json({
      mode:    'test',
      count:   messages.length,
      preview: messages.map(m => ({ to: m.to, body: m.body })),
    });
  }

  const results = [], errors = [];
  const e164Pattern = /^\+\d{10,15}$/;

  function extractBulkSmsError(err) {
    const status = err.response?.status;
    const data = err.response?.data;

    if (!status) return err.message; // no HTTP response at all (network/timeout error)
    if (!data) return `HTTP ${status}: ${err.message} (empty response body from BulkSMS)`;
    if (typeof data === 'string') return `HTTP ${status}: ${data}`;

    const detail = data.detail || data.title || data.message || JSON.stringify(data);
    return `HTTP ${status}: ${detail}`;
  }

  // 60ms between sequential sends — sending BulkSMS requests back-to-back with
  // no gap has been observed to trigger bare, empty-bodied 400s from their API.
  const SEND_DELAY_MS = 60;

  // Send one message at a time so one invalid record does not fail the full file.
  for (const m of messages) {
    const to = String(m.to || '').trim();
    const body = String(m.body || '').trim();

    if (!to || !body) {
      errors.push({ to, body, error: 'Validation failed: missing recipient or message body.' });
      continue;
    }

    if (!e164Pattern.test(to)) {
      errors.push({ to, body, error: 'Validation failed: phone must be E.164 format, e.g. +27821234567.' });
      continue;
    }

    try {
      const response = await axios.post(
        'https://api.bulksms.com/v1/messages',
        { to, body },
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type':  'application/json',
          },
          timeout: 30000,
        }
      );

      const r = Array.isArray(response.data) ? response.data[0] : response.data;
      results.push({
        to,
        body,
        status: r?.status?.type || 'SUBMITTED',
        messageId: r?.id,
        creditCost: r?.creditCost,
      });
      console.log(`[SEND OK] ${to} -> ${r?.status?.type || 'SUBMITTED'} (${r?.id || 'no-id'})`);
    } catch (err) {
      const error = extractBulkSmsError(err);
      console.error(`[SEND ERR] ${to} -> ${error}`);
      if (err.response) {
        console.error(
          `  status=${err.response.status} content-type=${err.response.headers?.['content-type']} ` +
          `raw-body=${JSON.stringify(err.response.data)}`
        );
      } else {
        console.error(`  no HTTP response received — ${err.code || err.message}`);
      }
      errors.push({ to, body, error });
    }

    await new Promise(resolve => setTimeout(resolve, SEND_DELAY_MS));
  }

  res.json({
    mode:        'live',
    totalSent:   results.length,
    totalErrors: errors.length,
    results,
    errors,
  });
});

app.post('/api/balance', async (req, res) => {
  const { tokenId, tokenSecret } = req.body;
  if (!tokenId || !tokenSecret) return res.status(400).json({ error: 'Credentials required.' });
  try {
    const response = await axios.get('https://api.bulksms.com/v1/profile', {
      headers: { Authorization: buildAuthHeader(tokenId, tokenSecret) },
      timeout: 10000,
    });
    res.json({ credits: response.data?.credits?.balance ?? 'N/A' });
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

const PORT = process.env.PORT || 3500;
app.listen(PORT, () => console.log(`\n🚀 BulkSMS Sender v1.1 → http://localhost:${PORT}\n`));
