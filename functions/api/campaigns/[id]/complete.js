import { getSql, getOwnedCampaign } from '../../../../server/db.js';
import { getUserEmail, sendReportEmail } from '../../../../server/email.js';
import { json, error, requireEnv } from '../../../../server/http.js';

function toCsv(messages) {
  const rows = [['To', 'Status', 'MessageId', 'CreditCost', 'Error', 'Message']];
  messages.forEach(m => rows.push([
    m.recipient, m.status, m.message_id || '', m.credit_cost ?? '', m.error || '', m.body,
  ]));
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * POST /api/campaigns/:id/complete — marks the campaign done, stores the
 * delivery report CSV in R2 and emails it to the user via Resend.
 */
export async function onRequestPost({ env, data, params }) {
  requireEnv(env, 'FILES');
  const sql = getSql(env);
  const campaign = await getOwnedCampaign(sql, params.id, data.userId);
  if (!campaign) return error('Campaign not found.', 404);

  const messages = await sql`
    SELECT recipient, body, status, message_id, credit_cost, error
    FROM campaign_messages WHERE campaign_id = ${campaign.id} ORDER BY id`;
  const csv = toCsv(messages);

  const reportKey = `reports/${data.userId}/${campaign.id}.csv`;
  await env.FILES.put(reportKey, csv, { httpMetadata: { contentType: 'text/csv' } });

  const [updated] = await sql`
    UPDATE campaigns
    SET status = 'completed', completed_at = COALESCE(completed_at, now()), report_key = ${reportKey}
    WHERE id = ${campaign.id}
    RETURNING *`;

  // Email is best-effort: a Resend problem must not hide a finished send.
  let emailedTo = null, emailError = null;
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    try {
      const to = await getUserEmail(env, data.userId);
      if (to) {
        await sendReportEmail(env, { to, campaign: updated, csv });
        emailedTo = to;
      } else {
        emailError = 'Your account has no email address.';
      }
    } catch (err) {
      console.error('[EMAIL ERR]', err);
      emailError = err.message;
    }
  } else {
    emailError = 'Email is not configured (RESEND_API_KEY / EMAIL_FROM).';
  }

  return json({ id: updated.id, emailedTo, emailError });
}
