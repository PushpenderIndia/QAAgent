import { startRun } from '../../../lib/runner.js';

const str = (v) => (typeof v === 'string' && v.trim() ? v : undefined);

// Only pass through a well-formed shape for the auth type given — anything else is dropped
// rather than forwarded as-is, since this becomes a default header on every outgoing request.
function parseAuth(auth) {
  if (!auth || typeof auth !== 'object') return undefined;
  switch (auth.type) {
    case 'basic':
      return (str(auth.username) || str(auth.password))
        ? { type: 'basic', username: str(auth.username) || '', password: str(auth.password) || '' }
        : undefined;
    case 'bearer':
      return str(auth.token) ? { type: 'bearer', token: str(auth.token) } : undefined;
    case 'header':
      return str(auth.name) && typeof auth.value === 'string' && auth.value
        ? { type: 'header', name: str(auth.name), value: auth.value }
        : undefined;
    default:
      return undefined;
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = startRun({
    prompt: body?.prompt,
    providerName: body?.provider === 'openCode' ? 'openCode' : 'claudeCode',
    model: body?.model,
    testType: body?.testType === 'api' ? 'api' : 'ui',
    baseUrl: body?.baseUrl,
    auth: parseAuth(body?.auth),
    instructions: str(body?.instructions),
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({ runId: result.runId }, { status: 202 });
}
