import { query } from '@anthropic-ai/claude-agent-sdk';
import { createOpencode } from '@opencode-ai/sdk';

// Both SDKs have to spin up a real CLI subprocess / local server to report their model
// catalog, so cache each engine's result briefly rather than paying that cost on every
// Settings-modal open.
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;
const cache = new Map();

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// supportedModels() resolves from the CLI's initial `system:init` handshake message —
// the same one src/agent/providers/claudeCode.js reads the session id from — which
// arrives before the prompt is ever sent for a real model turn, so this costs no API usage.
async function listClaudeCodeModels() {
  const q = query({
    prompt: ' ',
    options: { permissionMode: 'bypassPermissions', cwd: process.cwd() },
  });
  try {
    const models = await q.supportedModels();
    return models.map((m) => ({ value: m.value, label: m.displayName || m.value }));
  } finally {
    q.close();
  }
}

async function listOpenCodeModels() {
  const { client, server } = await createOpencode();
  try {
    const { data } = await client.config.providers();
    const models = [];
    for (const provider of data?.providers ?? []) {
      for (const model of Object.values(provider.models ?? {})) {
        models.push({ value: `${provider.id}/${model.id}`, label: `${provider.name} — ${model.name}` });
      }
    }
    return models;
  } finally {
    server.close();
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const engine = searchParams.get('engine') === 'openCode' ? 'openCode' : 'claudeCode';

  const cached = cache.get(engine);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Response.json({ models: cached.models });
  }

  try {
    const models = await withTimeout(
      engine === 'openCode' ? listOpenCodeModels() : listClaudeCodeModels(),
      FETCH_TIMEOUT_MS
    );
    if (!models.length) throw new Error(`No models reported for ${engine}.`);
    cache.set(engine, { models, at: Date.now() });
    return Response.json({ models });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to load models.' }, { status: 502 });
  }
}
