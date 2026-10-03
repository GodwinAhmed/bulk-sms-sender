import { verifyToken } from '@clerk/backend';
import { error, requireEnv, HttpError } from '../../server/http.js';

// Routes reachable without a Clerk session.
const PUBLIC_PATHS = new Set(['/api/config']);

export async function onRequest(context) {
  const { request, env, data, next } = context;
  try {
    const url = new URL(request.url);

    if (!PUBLIC_PATHS.has(url.pathname)) {
      requireEnv(env, 'CLERK_SECRET_KEY');
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!token) return error('Not signed in.', 401);

      try {
        const payload = await verifyToken(token, {
          secretKey: env.CLERK_SECRET_KEY,
          // Only accept session tokens minted for this site.
          authorizedParties: [url.origin],
        });
        data.userId = payload.sub;
      } catch {
        return error('Session expired or invalid. Please sign in again.', 401);
      }
    }

    return await next();
  } catch (err) {
    if (err instanceof HttpError) return error(err.message, err.status);
    console.error(err);
    return error(`Server error: ${err.message}`, 500);
  }
}
