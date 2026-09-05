import { cancelRun, getState } from '../../../../lib/runner.js';

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    // No body / invalid JSON — fall back to whichever run is in progress.
  }

  const { running, runs } = getState();
  const runId = body?.runId || (running ? runs[0]?.id : null);

  if (!runId) {
    return Response.json({ error: 'No run is currently in progress.' }, { status: 409 });
  }

  const result = await cancelRun(runId);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({ ok: true }, { status: 200 });
}
