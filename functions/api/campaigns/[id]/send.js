import { getSql, getOwnedCampaign } from '../../../../server/db.js';
import { interpolate, normalizePhone, sendMessages } from '../../../../server/bulksms.js';
import { json, error, readJson } from '../../../../server/http.js';

// Each request must stay under the Workers free-plan limit of 50 subrequests:
// 1 lookup + up to 20 BulkSMS calls + 1 insert transaction. The browser
// sends the contact list in chunks of this size.
const MAX_CHUNK = 20;

/** POST /api/campaigns/:id/send — { tokenId, tokenSecret, rows } (one chunk). */
export async function onRequestPost({ request, env, data, params }) {
  const { tokenId, tokenSecret, rows } = (await readJson(request)) || {};
  if (!tokenId || !tokenSecret) return error('API credentials required.');
  if (!Array.isArray(rows) || !rows.length) return error('No contacts to send to.');
  if (rows.length > MAX_CHUNK) return error(`Send at most ${MAX_CHUNK} contacts per request.`);

  const sql = getSql(env);
  const campaign = await getOwnedCampaign(sql, params.id, data.userId);
  if (!campaign) return error('Campaign not found.', 404);
  if (campaign.status !== 'sending') return error('Campaign is already completed.', 409);

  const messages = rows.map(row => ({
    to:   normalizePhone(String(row?.[campaign.phone_column] ?? ''), campaign.country_prefix),
    body: interpolate(campaign.template, row || {}),
  }));

  const { results, errors } = await sendMessages(messages, { tokenId, tokenSecret });

  const records = [
    ...results.map(r => ({
      recipient: r.to, body: r.body, status: r.status,
      message_id: r.messageId ?? null, credit_cost: r.creditCost ?? null, error: null,
    })),
    ...errors.map(e => ({
      recipient: e.to || '', body: e.body || '', status: 'ERROR',
      message_id: null, credit_cost: null, error: e.error,
    })),
  ];
  const credits = results.reduce((sum, r) => sum + (parseFloat(r.creditCost) || 0), 0);

  await sql.transaction([
    sql`
      INSERT INTO campaign_messages (campaign_id, recipient, body, status, message_id, credit_cost, error)
      SELECT ${campaign.id}, x.recipient, x.body, x.status, x.message_id, x.credit_cost, x.error
      FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb)
        AS x(recipient text, body text, status text, message_id text, credit_cost numeric, error text)`,
    sql`
      UPDATE campaigns
      SET total_sent    = total_sent + ${results.length},
          total_errors  = total_errors + ${errors.length},
          total_credits = total_credits + ${credits}
      WHERE id = ${campaign.id}`,
  ]);

  return json({ results, errors });
}
