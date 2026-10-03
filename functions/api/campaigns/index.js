import { getSql } from '../../../server/db.js';
import { json, error, requireEnv } from '../../../server/http.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // matches UI copy

/** GET /api/campaigns — the signed-in user's most recent campaigns. */
export async function onRequestGet({ env, data }) {
  const sql = getSql(env);
  const campaigns = await sql`
    SELECT id, created_at, completed_at, status, file_name, total_recipients,
           total_sent, total_errors, total_credits, report_key IS NOT NULL AS has_report
    FROM campaigns
    WHERE user_id = ${data.userId}
    ORDER BY created_at DESC
    LIMIT 100`;
  return json({ campaigns });
}

/**
 * POST /api/campaigns — multipart form:
 *   meta: JSON { template, phoneColumn, countryPrefix, totalRecipients }
 *   file: the original spreadsheet (optional, archived to R2)
 */
export async function onRequestPost({ request, env, data }) {
  requireEnv(env, 'FILES');
  const form = await request.formData().catch(() => null);
  if (!form) return error('Expected multipart form data.');

  let meta;
  try {
    meta = JSON.parse(form.get('meta') || '');
  } catch {
    return error('Invalid campaign details.');
  }

  const { template, phoneColumn, countryPrefix = '27', totalRecipients } = meta;
  if (!phoneColumn)                          return error('Phone column not selected.');
  if (!template?.trim())                     return error('Message template is empty.');
  if (!Number.isInteger(totalRecipients) || totalRecipients < 1) return error('No contacts to send to.');

  const file = form.get('file');
  if (file && typeof file !== 'string' && file.size > MAX_FILE_BYTES) {
    return error('File exceeds the 10 MB limit.');
  }

  const sql = getSql(env);
  const fileName = file && typeof file !== 'string' ? file.name : null;
  const [campaign] = await sql`
    INSERT INTO campaigns (user_id, template, phone_column, country_prefix, file_name, total_recipients)
    VALUES (${data.userId}, ${template}, ${phoneColumn}, ${String(countryPrefix)}, ${fileName}, ${totalRecipients})
    RETURNING id`;

  if (fileName) {
    const safeName = fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const fileKey = `uploads/${data.userId}/${campaign.id}/${safeName}`;
    await env.FILES.put(fileKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
    await sql`UPDATE campaigns SET file_key = ${fileKey} WHERE id = ${campaign.id}`;
  }

  return json({ id: campaign.id }, 201);
}
