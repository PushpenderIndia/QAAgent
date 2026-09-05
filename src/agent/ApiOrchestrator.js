import { createApiMcpServer } from './createApiMcpServer.js';
import { API_SYSTEM_PROMPT } from './apiSystemPrompt.js';
import { Logger } from './Logger.js';
import { runWithRetry, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RETRIES } from './runWithRetry.js';

const NO_TOOL_CALL_MESSAGE = 'Agent responded without calling any API testing tools. The step is considered failed.';
const STOP_HOOK_MESSAGE = 'CRITICAL: You MUST call an API testing tool (e.g. api_request, api_verify_status). You have not called any tool yet. Call one NOW.';

// Convenience shorthand for the most common auth schemes — spares callers from having to
// hand-encode Basic auth or remember header names. Anything else is just `options.headers`.
function buildAuthHeaders(auth) {
    if (!auth) return {};
    switch (auth.type) {
        case 'basic': {
            if (!auth.username && !auth.password) return {};
            const token = Buffer.from(`${auth.username ?? ''}:${auth.password ?? ''}`).toString('base64');
            return { Authorization: `Basic ${token}` };
        }
        case 'bearer':
            return auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
        case 'header':
            return auth.name && auth.value !== undefined ? { [auth.name]: auth.value } : {};
        default:
            return {};
    }
}

/**
 * Coordinates an API-testing agent run: wires up the API MCP server (no browser
 * involved) and calls provider.run(). Mirrors Orchestrator's shape/behavior for
 * browser testing, but browser/API tests have no shared long-lived object to key
 * session resumption off of — callers pass/receive `sessionId` explicitly instead
 * of it being tracked automatically (e.g. a Cucumber World stores it between steps).
 */
export class ApiOrchestrator {
    constructor(options = {}) {
        this.options = options;
        this.verbose = options.verbose !== false;
        this.logger = options.logger || new Logger(this.verbose);
    }

    async run(provider, prompt) {
        const baseUrl = this.options.baseUrl ?? process.env.BASE_URL;
        const { headers, auth, instructions, existingSessionId, abortController: externalAbortController } = this.options;
        // A dedicated `auth` shorthand takes priority over a same-named raw header, since
        // it's the more specific, more intentional of the two when both happen to be set.
        const resolvedHeaders = { ...headers, ...buildAuthHeaders(auth) };

        const finalPrompt = instructions?.trim()
            ? `${prompt}\n\n---\nAdditional instructions from the user:\n${instructions.trim()}`
            : prompt;

        if (this.verbose) {
            this.logger.log(`🤖 Running API Orchestrator with provider: ${provider.name}\n`);
            this.logger.log(`🌐 Base URL: ${baseUrl || '(none configured — agent must use absolute URLs)'}\n`);
            if (auth?.type) {
                this.logger.log(`🔑 Auth: ${auth.type} (sent as a default header on every request)\n`);
            }
            if (existingSessionId) {
                this.logger.log(`♻️  SESSION: Resuming session: ${existingSessionId}\n`);
            }
        }

        const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;

        const result = await runWithRetry({
            createMcp: () => createApiMcpServer({ baseUrl, headers: resolvedHeaders }),
            callProvider: ({ mcpUrl, abortController }) => provider.run(finalPrompt, {
                mcpUrl,
                existingSessionId,
                verbose: this.verbose,
                returnUsage: this.options.returnUsage,
                logger: this.logger,
                abortController,
                systemPrompt: API_SYSTEM_PROMPT,
                mcpServerName: 'apiTesting',
                assertionToolPattern: 'api_verify_',
                noToolCallMessage: NO_TOOL_CALL_MESSAGE,
                stopHookMessage: STOP_HOOK_MESSAGE,
            }),
            timeoutMs,
            maxRetries,
            logger: this.logger,
            verbose: this.verbose,
            signal: externalAbortController?.signal,
        });

        return this.options.returnUsage ? result : result.result;
    }
}
