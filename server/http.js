export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Fails fast with a readable message when a required binding/secret is missing. */
export function requireEnv(env, ...names) {
  const missing = names.filter(n => !env[n]);
  if (missing.length) {
    throw new HttpError(500, `Server is missing configuration: ${missing.join(', ')}`);
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
