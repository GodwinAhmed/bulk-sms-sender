import { createClerkClient } from '@clerk/backend';

/** Primary email of the Clerk user, or null if they have none. */
export async function getUserEmail(env, userId) {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const user = await clerk.users.getUser(userId);
  return user.primaryEmailAddress?.emailAddress || null;
}

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunked so large reports don't overflow the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Emails the delivery report via Resend. Throws on failure. */
export async function sendReportEmail(env, { to, campaign, csv }) {
  const date = new Date(campaign.created_at).toISOString().slice(0, 16).replace('T', ' ');
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
      <h2 style="margin:0 0 12px">BulkSMS campaign report</h2>
      <p>Your campaign from <strong>${escapeHtml(date)} UTC</strong> has finished.</p>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td>File</td><td><strong>${escapeHtml(campaign.file_name || '—')}</strong></td></tr>
        <tr><td>Recipients</td><td><strong>${campaign.total_recipients}</strong></td></tr>
        <tr><td>Sent</td><td><strong>${campaign.total_sent}</strong></td></tr>
        <tr><td>Errors</td><td><strong>${campaign.total_errors}</strong></td></tr>
        <tr><td>Credits used</td><td><strong>${Number(campaign.total_credits).toFixed(2)}</strong></td></tr>
      </table>
      <p>The full delivery report is attached as a CSV.</p>
    </div>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: `BulkSMS report: ${campaign.total_sent} sent, ${campaign.total_errors} errors`,
      html,
      attachments: [{ filename: `bulksms-report-${campaign.id}.csv`, content: toBase64(csv) }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend HTTP ${response.status}: ${await response.text()}`);
  }
}
