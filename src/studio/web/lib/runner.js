/**
 * QAAgent Studio — run orchestration (server-only)
 *
 * Ported from the original `src/studio/server.js` hand-rolled implementation.
 * Next.js `next start` runs one long-lived Node process, so this module's
 * top-level state persists across requests exactly like the old raw `http`
 * server did — it's a singleton by virtue of Node's ES module cache.
 *
 * Exposes a transport-agnostic pub/sub broadcaster so both the SSE route
 * handler (`app/api/stream/route.js`) and anything else can subscribe to
 * 'run-start' | 'log' | 'run-complete' events without depending on Node's
 * `http` module.
 */

import { randomUUID } from 'crypto';
import { mkdirSync, existsSync, statSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { chromium } from '@playwright/test';
import { runAgent, runApiAgent, claudeCode, openCode } from '../../../index.js';
import { Logger } from '../../../agent/Logger.js';

const execFileAsync = promisify(execFile);

const RUNS_DIR = join(tmpdir(), 'qa-agent-studio', 'runs');

mkdirSync(RUNS_DIR, { recursive: true });

// --- PR-diff-driven testing ------------------------------------------------
// If the submitted prompt is just a GitHub PR URL, we fetch its diff via the
// `gh` CLI and hand the agent a prompt built from that diff instead of a
// hand-written scenario — the agent plans what to test from the change itself.

const PR_URL_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i;
const MAX_DIFF_CHARS = 60000;
const GH_TIMEOUT_MS = 30000;

function isPrUrl(text) {
  return PR_URL_RE.test((text || '').trim());
}

function formatGhError(err, prUrl) {
  if (err.code === 'ENOENT') {
    return `The GitHub CLI ("gh") is not installed. Install it from https://cli.github.com, run "gh auth login", and make sure it has access to ${prUrl}.`;
  }
  if (err.name === 'AbortError') {
    return `Cancelled while fetching ${prUrl} via the "gh" CLI.`;
  }
  if (err.killed && err.signal === 'SIGTERM') {
    return `gh CLI timed out after ${GH_TIMEOUT_MS / 1000}s fetching PR info for ${prUrl} — check network/auth.`;
  }
  const stderr = (err.stderr || err.message || '').toString().trim();
  return `Could not read ${prUrl} via the "gh" CLI: ${stderr}\nMake sure "gh" is authenticated ("gh auth login") and the logged-in account has access to this PR/repository.`;
}

async function fetchPrContext(prUrl, signal) {
  let viewResult, diffResult;
  try {
    viewResult = await execFileAsync('gh', ['pr', 'view', prUrl, '--json', 'title,body,number'], { maxBuffer: 20 * 1024 * 1024, timeout: GH_TIMEOUT_MS, signal });
    diffResult = await execFileAsync('gh', ['pr', 'diff', prUrl], { maxBuffer: 20 * 1024 * 1024, timeout: GH_TIMEOUT_MS, signal });
  } catch (err) {
    throw new Error(formatGhError(err, prUrl));
  }

  const info = JSON.parse(viewResult.stdout);
  let diff = diffResult.stdout;
  let truncated = false;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }

  return { number: info.number, title: info.title, body: info.body || '', diff, truncated };
}

function buildPrTestPrompt({ prUrl, number, title, body, diff, truncated, baseUrl }) {
  const whereToTest = baseUrl
    ? `The application under test is running at ${baseUrl} — navigate there.`
    : `No base URL is configured for this Studio session — infer the right URL to test from the diff and PR description below.`;

  return `You are testing pull request #${number} by exercising its changes in a real browser.

PR: ${prUrl}
Title: ${title}
Description: ${body || '(no description provided)'}

${whereToTest}

Plan what to test based on the diff below — figure out what user-facing behavior changed — then navigate the app and verify it works as intended. Report clearly what you tested and whether it passed.

Diff${truncated ? ' (truncated to the first 60,000 characters)' : ''}:
\`\`\`diff
${diff}
\`\`\``;
}

// --- API-testing mode --------------------------------------------------------
// For backend-only PRs (or a plain scenario describing endpoint behavior), skip
// the browser entirely and drive the API under test directly over HTTP.

function buildApiPrTestPrompt({ prUrl, number, title, body, diff, truncated, baseUrl }) {
  const whereToTest = baseUrl
    ? `The API under test is running at ${baseUrl} — use it as the base URL for requests (relative paths resolve against it).`
    : `No base URL is configured for this Studio session — infer the right base URL from the diff/PR description below, or use absolute URLs.`;

  return `You are testing pull request #${number} by exercising its changes against the running API directly — no browser, just HTTP requests.

PR: ${prUrl}
Title: ${title}
Description: ${body || '(no description provided)'}

${whereToTest}

Plan what to test based on the diff below — figure out which endpoints/handlers changed and what
backend behavior changed (new/changed routes, status codes, request validation, response shape,
auth, error handling) — then call those endpoints and verify the responses. Cover the happy path
and at least one edge/error case per changed endpoint. Report clearly what you tested and whether
it passed.

Diff${truncated ? ' (truncated to the first 60,000 characters)' : ''}:
\`\`\`diff
${diff}
\`\`\``;
}

const MAX_RUNS = 20;

const state = { running: false, runs: [], currentRun: null };
const subscribers = new Set();

function broadcast(event, data) {
  for (const callback of subscribers) {
    try {
      callback(event, data);
    } catch {
      // A misbehaving subscriber must never break the run.
    }
  }
}

async function cleanupRunDir(id) {
  if (state.currentRun?.id === id) return;
  try {
    await rm(join(RUNS_DIR, id), { recursive: true, force: true });
  } catch {
    // Best-effort — disk cleanup must never crash a run.
  }
}

function broadcastLog(runId, line) {
  const record = state.runs.find((r) => r.id === runId);
  if (record) record.logLines.push(line);
  broadcast('log', { runId, line });
}

/**
 * Subscribe to run lifecycle events.
 * @param {(event: 'run-start'|'log'|'run-complete', data: any) => void} callback
 */
export function subscribe(callback) {
  subscribers.add(callback);
}

export function unsubscribe(callback) {
  subscribers.delete(callback);
}

/** @returns {{ running: boolean, runs: object[] }} */
export function getState() {
  return state;
}

async function executeRun({ id, prompt, providerName, model, testType, baseUrl, auth, instructions }) {
  const record = state.runs.find((r) => r.id === id);
  const runDir = join(RUNS_DIR, id);
  mkdirSync(runDir, { recursive: true });

  const headless = process.env.HEADLESS !== 'false';
  let browser, context, page;

  const abortController = new AbortController();
  state.currentRun = { id, browser: null, abortController };

  try {
    let agentPrompt = prompt;
    const isApi = testType === 'api';
    const resolvedBaseUrl = baseUrl || process.env.BASE_URL;

    if (isPrUrl(prompt)) {
      const prUrl = prompt.trim();
      broadcastLog(id, `🤖 Reading PR diff via gh CLI: ${prUrl}`);
      let prContext;
      try {
        prContext = await fetchPrContext(prUrl, abortController.signal);
      } catch (err) {
        broadcastLog(id, `❌ ${err.message}`);
        throw err;
      }
      broadcastLog(id, `✅ Fetched PR #${prContext.number} — "${prContext.title}"${prContext.truncated ? ' (diff truncated)' : ''}`);
      agentPrompt = isApi
        ? buildApiPrTestPrompt({ prUrl, ...prContext, baseUrl: resolvedBaseUrl })
        : buildPrTestPrompt({ prUrl, ...prContext, baseUrl: resolvedBaseUrl });
    } else if (!isApi && resolvedBaseUrl) {
      // Plain UI scenario (not a PR diff) — the app may be deployed to a PR's
      // staging environment or a local dev server rather than a well-known URL.
      agentPrompt = `The application under test is running at ${resolvedBaseUrl} — navigate there for any relative paths mentioned below.\n\n${prompt}`;
    }

    const logger = new Logger(true, { sink: (line) => broadcastLog(id, line) });
    const provider = providerName === 'openCode' ? openCode(model) : claudeCode(model);

    let resultText;
    if (isApi) {
      broadcastLog(id, `🌐 API mode — testing against ${resolvedBaseUrl || '(no base URL configured; agent must use absolute URLs)'}`);
      resultText = await runApiAgent(provider, agentPrompt, {
        baseUrl: resolvedBaseUrl,
        auth,
        instructions,
        verbose: true,
        logger,
        abortController,
      });
    } else {
      if (resolvedBaseUrl) {
        broadcastLog(id, `🌐 UI mode — testing against ${resolvedBaseUrl}`);
      }
      browser = await chromium.launch({ headless });
      state.currentRun.browser = browser;
      context = await browser.newContext({ recordVideo: { dir: runDir } });
      await context.tracing.start({ screenshots: true, snapshots: true });
      page = await context.newPage();

      resultText = await runAgent(provider, agentPrompt, page, { verbose: true, logger });
    }

    record.status = 'passed';
    record.result = resultText;
  } catch (err) {
    record.status = record.cancelRequested ? 'cancelled' : 'failed';
    record.error = record.cancelRequested ? 'Run cancelled by user.' : err.message;
  } finally {
    const tracePath = join(runDir, 'trace.zip');
    try {
      if (context) await context.tracing.stop({ path: tracePath });
      record.tracePath = existsSync(tracePath) ? tracePath : null;
    } catch {
      record.tracePath = null;
    }

    try {
      const video = page?.video();
      if (context) await context.close();
      const videoPath = video ? await video.path() : null;
      record.videoFile = videoPath && existsSync(videoPath) ? videoPath : null;
      record.videoUrl = record.videoFile ? `/videos/${id}` : null;
    } catch {
      record.videoFile = null;
      record.videoUrl = null;
    }

    try {
      if (browser) await browser.close();
    } catch {
      // already gone
    }

    record.finishedAt = Date.now();
    state.running = false;
    if (state.currentRun?.id === id) state.currentRun = null;
    broadcast('run-complete', record);
  }
}

/**
 * Cancel the currently in-progress run, if its id matches.
 * Aborts any in-flight `gh` CLI calls and force-closes the browser, which
 * makes any in-flight Playwright/MCP tool call fail — that failure flows
 * through `executeRun`'s existing catch block and marks the run 'cancelled'.
 * @param {string} id
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
export async function cancelRun(id) {
  if (!id || !state.currentRun || state.currentRun.id !== id) {
    return { ok: false, status: 404, error: 'No matching in-progress run to cancel.' };
  }

  const { browser, abortController } = state.currentRun;
  const record = state.runs.find((r) => r.id === id);
  if (record) record.cancelRequested = true;

  try {
    abortController.abort();
  } catch {
    // ignore
  }

  try {
    if (browser) await browser.close();
  } catch {
    // already gone — executeRun's catch/finally will still run
  }

  return { ok: true };
}

/**
 * Start a new run.
 * @param {{ prompt: string, providerName?: string, model?: string, testType?: 'ui'|'api', baseUrl?: string,
 *   auth?: { type: 'basic'|'bearer'|'header', ... }, instructions?: string }} params
 * @returns {{ ok: true, runId: string } | { ok: false, status: number, error: string }}
 */
export function startRun({ prompt, providerName, model, testType, baseUrl, auth, instructions }) {
  if (state.running) {
    return { ok: false, status: 409, error: 'A run is already in progress.' };
  }

  const trimmedPrompt = (prompt || '').trim();
  if (!trimmedPrompt) {
    return { ok: false, status: 400, error: 'Prompt is required.' };
  }

  const resolvedProviderName = providerName === 'openCode' ? 'openCode' : 'claudeCode';
  const resolvedModel = (model || '').trim() ||
    (resolvedProviderName === 'openCode' ? 'anthropic/claude-haiku-4-5' : 'claude-haiku-4-5');
  const resolvedTestType = testType === 'api' ? 'api' : 'ui';
  const resolvedBaseUrl = (baseUrl || '').trim() || null;
  const resolvedInstructions = (instructions || '').trim() || null;

  const id = randomUUID();
  const record = {
    id,
    prompt: trimmedPrompt,
    provider: resolvedProviderName,
    model: resolvedModel,
    testType: resolvedTestType,
    baseUrl: resolvedBaseUrl,
    instructions: resolvedInstructions,
    // Deliberately NOT storing `auth` here: this record is broadcast to every connected
    // Studio client and returned by GET /api/runs, and stays around (in-memory) for the
    // life of the process across up to MAX_RUNS past runs — credentials don't belong in it.
    status: 'running',
    result: null,
    error: null,
    videoUrl: null,
    videoFile: null,
    tracePath: null,
    logLines: [],
    startedAt: Date.now(),
    finishedAt: null,
  };
  state.runs.unshift(record);
  if (state.runs.length > MAX_RUNS) {
    const evicted = state.runs.splice(MAX_RUNS);
    for (const run of evicted) {
      if (run.status === 'running') continue;
      cleanupRunDir(run.id);
    }
  }
  state.running = true;

  broadcast('run-start', record);

  executeRun({
    id,
    prompt: trimmedPrompt,
    providerName: resolvedProviderName,
    model: resolvedModel,
    testType: resolvedTestType,
    baseUrl: resolvedBaseUrl,
    auth,
    instructions: resolvedInstructions,
  }).catch((err) => {
    record.status = 'failed';
    record.error = err.message;
    state.running = false;
    broadcast('run-complete', record);
  });

  return { ok: true, runId: id };
}

export function getRunVideoFile(id) {
  const record = state.runs.find((r) => r.id === id);
  if (!record?.videoFile || !existsSync(record.videoFile)) return null;
  return { path: record.videoFile, size: statSync(record.videoFile).size };
}

export function getRunTraceFile(id) {
  const record = state.runs.find((r) => r.id === id);
  if (!record?.tracePath || !existsSync(record.tracePath)) return null;
  return record.tracePath;
}
