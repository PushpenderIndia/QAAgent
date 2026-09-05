import { Orchestrator } from './agent/Orchestrator.js';
import { ApiOrchestrator } from './agent/ApiOrchestrator.js';
import { claudeCode } from './agent/providers/claudeCode.js';
import { config } from 'dotenv';
import { sessionManager } from './agent/SessionManager.js';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from project's .env file (where the user runs the tests)
config();

// Fallback for monorepo/examples: load from package root if not found in cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

/**
 * Run browser agent with configurable backend
 * 
 * @param {object} provider - Agent Provider (e.g. claudeCode('claude-haiku-4-5'))
 * @param {string} prompt - Natural language instruction
 * @param {Page|BrowserContext} pageOrContext - Playwright page or browser context from test
 * @param {object} options - Optional configuration
 */
export async function runAgent(provider, prompt, pageOrContext, options = {}) {
  const orchestrator = new Orchestrator(options);
  return orchestrator.run(provider, prompt, pageOrContext);
}

/**
 * Reset the session for a specific browser context
 * @param {BrowserContext} browserContext - The browser context to reset
 * @returns {string|null} - The session ID that was reset, or null if none existed
 */
runAgent.resetSession = function (browserContext) {
  return sessionManager.resetSession(browserContext);
};

/**
 * Run an API-testing agent — exercises REST/HTTP endpoints directly, no browser
 * involved. Useful when the change under test is backend-only (e.g. a PR that
 * only touches API routes/handlers).
 *
 * @param {object} provider - Agent Provider (e.g. claudeCode('claude-haiku-4-5'))
 * @param {string} prompt - Natural language instruction (what to call and verify)
 * @param {object} [options] - Optional configuration
 * @param {string} [options.baseUrl] - Base URL relative request paths resolve against
 *   (falls back to the BASE_URL env var). Absolute URLs in the prompt/tool calls don't need it.
 * @param {Record<string,string>} [options.headers] - Headers sent with every request
 * @param {object} [options.auth] - Convenience shorthand for a common auth scheme, merged into
 *   `headers` as a default `Authorization` (or custom) header on every request. One of:
 *   `{ type: 'basic', username, password }`, `{ type: 'bearer', token }`, or
 *   `{ type: 'header', name, value }` for anything else (e.g. an API key header).
 * @param {string} [options.instructions] - Optional extra guidance appended to the prompt, e.g.
 *   how to authenticate ("first POST /login with these creds to get a token") or endpoint-specific
 *   context the agent wouldn't otherwise know.
 * @param {string} [options.existingSessionId] - Resume a prior session (e.g. across BDD steps);
 *   the caller is responsible for storing the returned sessionId between calls.
 * @param {AbortController} [options.abortController] - Abort to cancel an in-flight run.
 */
export async function runApiAgent(provider, prompt, options = {}) {
  const orchestrator = new ApiOrchestrator(options);
  return orchestrator.run(provider, prompt);
}

export { Orchestrator };
export { ApiOrchestrator };
export { claudeCode } from './agent/providers/claudeCode.js';
export { openCode } from './agent/providers/openCode.js';
