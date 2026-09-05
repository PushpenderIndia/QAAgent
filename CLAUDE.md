# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QAAgent is an agent harness for test automation — write tests in plain English, let the agent drive a real browser (`runAgent`) or call REST endpoints directly (`runApiAgent`). The same agent that builds your product can verify it, UI or backend. It integrates with Playwright-BDD, Cucumber.js, and YAML-based test definitions.

**Key architecture:** Uses a **unified SDK architecture** — both `claudeCode` and `openCode` providers expose an MCP server (Playwright for browser tests, a custom HTTP-testing server for API tests) over HTTP/SSE and implement a single `provider.run()` interface that's generic over which MCP server/system prompt/assertion-tool-name-pattern is wired in. `Orchestrator` (browser) and `ApiOrchestrator` (API) are thin coordinators that each wire their MCP server to the provider via the shared `runWithRetry` helper (timeout + retry-on-transient-failure), so the two modes stay structurally identical instead of diverging.

## Common Commands

### Development & Testing
```bash
# Install dependencies
npm install

# Run example tests
cd examples/playwright-bdd && npm test
cd examples/cucumberjs && npm test
cd examples/playwright-yaml && npm test

# Run CLI init wizard
node src/cli/bin.js init

# Generate Playwright tests from YAML
npx qa-agent generate [paths...]
npx qa-agent generate --watch  # Watch mode

# Launch the Studio web UI (standalone, no scaffolded project needed)
node src/cli/bin.js studio

# Test with local file link
cd .qa-agent && npm install file:..
```

### Playwright-BDD Specific
```bash
npm run bddgen        # Generate BDD test files from .feature files
npm run bddgen && npm test
```

## Architecture

```
runAgent(provider, prompt, page/context)              runApiAgent(provider, prompt, options)
  └─ Orchestrator.run()                                  └─ ApiOrchestrator.run()
       ├─ sessionManager.getSession(browserContext)            (session resumption via
       ├─ runWithRetry({ createMcp, callProvider, ... })         options.existingSessionId —
       │    ├─ createMcpHttpServer(browserContext)               caller stores it, e.g. a
       │    │    Playwright MCP over HTTP/SSE, random port       Cucumber World)
       │    ├─ provider.run(prompt, { mcpUrl, ... })        ├─ runWithRetry({ createMcp, callProvider, ... })
       │    │    ├─ claudeCode → claude-agent-sdk query()        ├─ createApiMcpServer({ baseUrl, headers })
       │    │    └─ openCode   → @opencode-ai/sdk               │    api_request/api_verify_*/api_run_code_unsafe
       │    │         createOpencode()                          │    over HTTP/SSE, random port — no browser
       │    └─ timeout + retry-on-transient-error               └─ provider.run(prompt, { mcpUrl,
       └─ sessionManager.setSession(browserContext,                   systemPrompt: API_SYSTEM_PROMPT,
             result.sessionId)                                        assertionToolPattern: 'api_verify_', ... })
```

`runWithRetry` (`src/agent/runWithRetry.js`) holds the timeout/retry/abort logic shared by both orchestrators: recreate the MCP server every attempt, race the provider call against a timeout, retry once on a transient network error (`ECONNRESET`, `fetch failed`, etc. — never on an assertion failure), and honor an optional external `AbortSignal` (used by Studio's Stop button in API mode, since there's no browser to force-close).

### Core Files

**`src/agent/Orchestrator.js`** — thin coordinator: resolves browser context, creates MCP server, calls `provider.run()`, stores session ID, runs cleanup.

**`src/agent/createMcpServer.js`** — creates a Playwright MCP server (`@playwright/mcp`) and exposes it over HTTP/SSE on a random `127.0.0.1` port. Wraps the browser context with a no-op `.close()` so MCP never disposes it. Returns `{ url, cleanup }`.

**`src/agent/systemPrompt.js`** — shared Playwright agent system prompt constant. Imported by both providers to ensure identical agent instructions regardless of backend.

**`src/agent/runWithRetry.js`** — shared timeout/retry/abort loop used by both `Orchestrator` and `ApiOrchestrator` (see architecture diagram above).

**`src/agent/providers/claudeCode.js`** — uses `@anthropic-ai/claude-agent-sdk` `query()`. MCP config: `{ [mcpServerName]: { type: 'http', url: mcpUrl } }` (`mcpServerName` defaults to `'playwright'`; `ApiOrchestrator` passes `'apiTesting'`). Has a `Stop` hook to enforce at least one MCP tool call per step. Detects assertion failures from `tool_result` blocks with `is_error: true` where the tool name matches `assertionToolPattern` (defaults to `'browser_verify_'`; `ApiOrchestrator` passes `'api_verify_'`). `systemPrompt`, `noToolCallMessage`, and `stopHookMessage` are likewise overridable — this is what lets the same provider serve both browser and API modes.

**`src/agent/providers/openCode.js`** — uses `@opencode-ai/sdk` `createOpencode()`. MCP config: `{ [mcpServerName]: { type: 'remote', url: mcpUrl } }`. Calls `promptAsync()` (fire-and-forget) then iterates the SSE event stream, processing `message.part.updated`, `session.idle`, `session.error`. Auto-approves permission events. Detects assertion failures from both `ToolStateError` and `ToolStateCompleted` with `### Error` output (MCP `isError:true` maps to the latter), gated by the same `assertionToolPattern` override.

**`src/agent/SessionManager.js`** — `WeakMap<BrowserContext, sessionId>`. Enables session resumption across steps within the same scenario. API mode has no equivalent long-lived object to key off of, so `ApiOrchestrator` takes/returns `sessionId` explicitly instead (see below).

**`src/agent/createApiMcpServer.js`** — creates an API-testing MCP server (built directly on `@modelcontextprotocol/sdk`'s `McpServer`, no browser involved) exposed over HTTP/SSE on a random `127.0.0.1` port. Same `{ url, cleanup }` shape as `createMcpServer.js`. Tools: `api_request` (fetch a URL — absolute, or relative to the configured `baseUrl` — and store it as "the last response"), `api_verify_status`, `api_verify_header`, `api_verify_json_value` (dot/bracket path into the JSON body), `api_verify_schema` (minimal recursive type/required/enum validator, reports all violations), `api_run_code_unsafe` (soft assertions / custom flows, mirrors `browser_run_code_unsafe`, has access to `fetch`, `lastResponse`, `responses`). Verify tools return `isError: true` on failure — that's what `assertionToolPattern: 'api_verify_'` in the providers keys off of. State (`lastResponse`/`responses`) lives in the closure per server instance, so it's fresh every `runWithRetry` attempt.

**`src/agent/apiSystemPrompt.js`** — `API_SYSTEM_PROMPT`, the API-testing analogue of `systemPrompt.js`: call `api_request` then an `api_verify_*` tool (never just narrate the response), hard-vs-soft assertion guidance, and how to chain requests (pull IDs out of a prior JSON response rather than inventing them).

**`src/agent/ApiOrchestrator.js`** — the API-mode counterpart to `Orchestrator`. `runApiAgent(provider, prompt, { baseUrl, headers, auth, instructions, existingSessionId, abortController, ... })` (exported from `src/index.js`) wires `createApiMcpServer` + `API_SYSTEM_PROMPT` into the same provider used for browser tests. No browser/page argument — `baseUrl` falls back to the `BASE_URL` env var. `auth` is convenience shorthand (`{ type: 'basic', username, password }` / `{ type: 'bearer', token }` / `{ type: 'header', name, value }`) that `buildAuthHeaders()` turns into a default request header, merged with `headers` and passed to `createApiMcpServer` — never logged beyond its `type`, and Studio never attaches it to a persisted run record (see below), only to raw request headers sent to the API under test. `instructions` is optional free text appended to the prompt (e.g. a login flow to run first, or headers every endpoint needs) — the agent still has to act on it via a tool call; it's not itself a header. Pass an `AbortController` in `abortController` to support external cancellation (Studio's Stop button uses this, since there's no browser to force-close in API mode).

**`src/studio/web/`** — the `qa-agent studio` web UI, a Next.js (App Router, JavaScript) app. `lib/runner.js` is the server-only singleton that ports the original run logic: in-memory `{ running, runs }` state, a transport-agnostic pub/sub broadcaster (`subscribe`/`unsubscribe`), and `startRun({ prompt, providerName, model, testType, baseUrl, auth, instructions })`. `testType` (`'ui'` default, or `'api'`) picks the whole execution path in `executeRun`: for `'ui'` it launches its own `chromium` instance per run (via `@playwright/test`), records video + trace, and calls `runAgent()`; for `'api'` it skips the browser entirely and calls `runApiAgent()` with `baseUrl` (falls back to the `BASE_URL` env var), `auth`, and `instructions` — no video/trace, `ResultPanel` just doesn't render those buttons when absent. Both paths stream live progress by injecting a `Logger` with a `sink` callback. One run at a time. If the submitted prompt is a GitHub PR URL, `executeRun` fetches its diff/title/body via the `gh` CLI (`gh pr view`/`gh pr diff`, shelled out with `execFile`) and builds an augmented prompt from it instead of running the raw input verbatim — `buildPrTestPrompt` (browser) or `buildApiPrTestPrompt` (API) — the agent plans what to test from the diff either way. Requires `gh` installed and authenticated with access to that repo; failures surface as a normal failed run with a clear error. The Stop button calls `cancelRun()`, which aborts the run's `AbortController` and (UI mode only) force-closes the browser to unstick any in-flight Playwright call; API mode relies solely on the `AbortController` since `runWithRetry` honors it directly (see Architecture above) — there's no browser to close. Route handlers under `app/api/` (`run`, `runs`, `stream`, `open-trace`) and `app/videos/[id]/route.js` use the Web `Request`/`Response`/`ReadableStream` APIs (not Node's `http`) and just call into `lib/runner.js`; `app/api/stream/route.js` bridges `runner`'s broadcaster onto an SSE `ReadableStream` and sets `export const dynamic = 'force-dynamic'`. UI components live under `app/` and `components/` (React, no separate template string) — `PromptForm.jsx` has the scenario/PR mode toggle plus a `testType` (Target: UI/API) selector; API mode additionally shows Base URL, an Auth selector (none/basic/bearer/custom header, `route.js`'s `parseAuth()` validates the shape before it reaches `startRun`), and an optional free-text Instructions field. `auth` is passed straight through `startRun` → `executeRun` as a function argument and is deliberately never attached to the `state.runs` record (that record is broadcast over SSE to every connected client and returned by `GET /api/runs`, and persists in memory for up to `MAX_RUNS` past runs) — only `instructions` is persisted there, for restore-on-select convenience. Note this doesn't prevent a credential from showing up in `result`/`logLines` if the API under test itself echoes it back in a response body the agent then reports — same as any other response content. The `qa-agent studio` CLI command (`src/cli/bin.js`) installs `src/studio/web`'s dependencies on first run, runs `next build`, then `next start -p <port>` as a monitored child process and opens the browser.

### Provider Interface

```js
{
  name: string,
  run(prompt, {
    mcpUrl, existingSessionId, verbose, returnUsage, logger, abortController,
    // Overridable per-mode — Orchestrator omits these (browser defaults apply);
    // ApiOrchestrator passes all of them:
    systemPrompt, mcpServerName, assertionToolPattern, noToolCallMessage, stopHookMessage,
  }) → Promise<{ result, usage?, steps, sessionId }>
}
```

### CLI System (`src/cli/`)

- `qa-agent init` — Interactive wizard: Agent → Model → Framework → Feature path. Scaffolds `.qa-agent/`, installs the chosen agent SDK + varlock, optionally installs Playwright browsers. Shows spinner progress during file creation.
- `qa-agent generate [paths...]` — Converts YAML test files to Playwright `.spec.js`.

Templates at `src/cli/templates/<framework>/`. Each template includes `.env.schema` (varlock schema, committed) and `.env.example` (copy-to-.env guide).

### Export Structure

```js
export { runAgent }       // browser E2E entry point
export { runApiAgent }    // API/backend entry point — no browser required
export { claudeCode }     // @anthropic-ai/claude-agent-sdk provider
export { openCode }       // @opencode-ai/sdk provider
export { Orchestrator }
export { ApiOrchestrator }
```

**Peer Dependencies** (all optional except `@playwright/test`):
- `@anthropic-ai/claude-agent-sdk` >=0.2 — required for `claudeCode`
- `@opencode-ai/sdk` >=1.14 — required for `openCode`
- `@playwright/test` ^1.57.0 (required — even for `runApiAgent`, since it's still a peer of the package; API mode itself never launches a browser)
- `playwright-bdd` ^8.0.0, `@cucumber/cucumber` ^11.0.0 (optional)

`zod` is a regular (non-peer) dependency — used by `createApiMcpServer.js` to define the API-testing tools' input schemas via `@modelcontextprotocol/sdk`'s `McpServer.registerTool()`.

## Critical Implementation Details

### Parallel-Safe Execution

Each `runAgent()` call creates its own HTTP server on a random `127.0.0.1` port. Parallel test workers get separate ports — no shared state, no config files.

### Tool Enforcement

Both providers reject any step where the agent made **zero MCP tool calls** (Playwright tools in browser mode, `api_*` tools in API mode — see `noToolCallMessage`). Prevents hallucinated responses without actually interacting with the browser/API.

### Context Resolution

Both `Page` and `BrowserContext` are accepted:
```javascript
if (pageOrContext.context && typeof pageOrContext.context === 'function') {
  browserContext = pageOrContext.context();   // Page → extract context
} else {
  browserContext = pageOrContext;             // already a BrowserContext
}
```

### Environment Variable Loading

**Scaffolded `.qa-agent/` projects** use [varlock](https://varlock.dev) (Node.js 22+ required). `varlock run --` in npm scripts pre-injects validated env vars before the test process starts. The `.env.schema` file documents all variables with types and descriptions; secrets are redacted from logs automatically. Schema header format:
```
# @defaultSensitive=true @defaultRequired=false
# @generateTypes(lang=ts, path=env.d.ts)
# ---
```

**qa-agent library itself** (`src/index.js`) uses dotenv directly — no varlock dependency:
1. `.qa-agent/.env` — loaded by dotenv (cwd when tests run from `.qa-agent/`)
2. Parent project `.env` (`../.env`) — fallback for monorepo setups
3. Shell environment — `ANTHROPIC_API_KEY` (claudeCode) or the relevant provider key (openCode)

For local development, no `.env` is needed if already logged in:
- **Claude Code** — uses the existing `claude login` session automatically
- **OpenCode** — uses the existing `opencode auth login` session (e.g. GitLab Duo) automatically

### Feature File Step Syntax

The step definition uses `/^(.*)$/` to match any step text. Both `Given`/`When`/`Then` and `*` (asterisk) work identically.

## Examples Directory

- `playwright-bdd/` — Playwright-BDD with `.feature` files
- `playwright-yaml/` — YAML-based tests via `npx qa-agent generate`
- `cucumberjs/` — Cucumber.js integration

All examples use `"qa-agent": "file:../.."` for local development and require the relevant agent SDK installed alongside (e.g. `npm install @anthropic-ai/claude-agent-sdk`).

## Testing Strategy

Before any release:
1. `cd examples/playwright-bdd && npm test`
2. `node src/cli/bin.js init` in a temp directory
3. `cd .qa-agent && npm install file:..`

## Module System

**ES Modules only** (`"type": "module"`). All imports require `.js` extensions. No CommonJS.

## Anti-Patterns to Avoid

1. **Don't skip tool calls** — both providers enforce at least one MCP tool call per step, in either mode
2. **Don't break session continuity** — session reuse is critical for multi-step scenarios. Browser mode tracks it automatically via `SessionManager`'s `WeakMap<BrowserContext, sessionId>`; API mode has no equivalent object to key off of, so the caller must thread `existingSessionId`/the returned `sessionId` through manually (e.g. a Cucumber World)
3. **Don't dispose the browser context in MCP** — the no-op `.close()` wrapper in `createMcpServer.js` is critical
4. **Don't add a new provider without the uniform interface** — every provider must implement `run(prompt, options) → { result, steps, sessionId }`, honoring the `systemPrompt`/`mcpServerName`/`assertionToolPattern` overrides so it works for both `Orchestrator` and `ApiOrchestrator`
5. **Don't use `session.prompt()` in openCode** — use `promptAsync()`. `prompt()` blocks until the full response is ready; `session.idle` fires while you're blocked so the event is missed and the loop hangs indefinitely.
6. **Don't assume MCP `isError:true` maps to `ToolStateError`** — OpenCode maps it to `ToolStateCompleted` with the error text in `part.state.output` starting with `### Error`. Check both states when detecting assertion failures.
7. **Don't let `api_request` itself assert anything** — it only records the response; failures must come from an `api_verify_*` tool (or `api_run_code_unsafe` throwing). This mirrors `browser_snapshot` vs `browser_verify_*` and is what makes `assertionToolPattern` meaningful.
