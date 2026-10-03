import { getBalance } from '../../server/bulksms.js';
import { json, error, readJson } from '../../server/http.js';

export async function onRequestPost({ request }) {
  const { tokenId, tokenSecret } = (await readJson(request)) || {};
  if (!tokenId || !tokenSecret) return error('Credentials required.');
  try {
    return json({ credits: await getBalance({ tokenId, tokenSecret }) });
  } catch (err) {
    return error(err.message);
  }
}
