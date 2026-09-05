import { spawn } from 'child_process';
import { getRunTraceFile } from '../../../lib/runner.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const tracePath = getRunTraceFile(body?.runId);
  if (!tracePath) {
    return Response.json({ error: 'Trace not found for this run.' }, { status: 404 });
  }

  spawn('npx', ['--yes', 'playwright', 'show-trace', tracePath], {
    stdio: 'ignore',
    detached: true,
  }).unref();

  return Response.json({ ok: true });
}
