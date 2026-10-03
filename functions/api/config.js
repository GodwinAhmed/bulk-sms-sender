import { json } from '../../server/http.js';

/** Public, non-secret config the frontend needs before sign-in. */
export function onRequestGet({ env }) {
  return json({ clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY || '' });
}
