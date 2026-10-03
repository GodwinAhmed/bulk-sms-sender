import { getSql, getOwnedCampaign } from '../../../../server/db.js';
import { error, requireEnv } from '../../../../server/http.js';

/** GET /api/campaigns/:id/report — streams the stored CSV report from R2. */
export async function onRequestGet({ env, data, params }) {
  requireEnv(env, 'FILES');
  const sql = getSql(env);
  const campaign = await getOwnedCampaign(sql, params.id, data.userId);
  if (!campaign?.report_key) return error('Report not found.', 404);

  const object = await env.FILES.get(campaign.report_key);
  if (!object) return error('Report file is missing from storage.', 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="bulksms-report-${campaign.id}.csv"`,
    },
  });
}
