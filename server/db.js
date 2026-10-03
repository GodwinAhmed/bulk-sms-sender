import { neon } from '@neondatabase/serverless';
import { requireEnv } from './http.js';

/** Neon's HTTP driver: one fetch per query, which suits Workers well. */
export function getSql(env) {
  requireEnv(env, 'DATABASE_URL');
  return neon(env.DATABASE_URL);
}

/** Loads a campaign only if it belongs to the signed-in user. */
export async function getOwnedCampaign(sql, id, userId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const rows = await sql`SELECT * FROM campaigns WHERE id = ${id} AND user_id = ${userId}`;
  return rows[0] || null;
}
