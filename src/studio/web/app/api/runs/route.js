import { getState } from '../../../lib/runner.js';

export async function GET() {
  const { running, runs } = getState();
  return Response.json({ running, runs });
}
