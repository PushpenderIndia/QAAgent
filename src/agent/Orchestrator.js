import { createMcpHttpServer } from './createMcpServer.js';
import { sessionManager } from './SessionManager.js';
import { Logger } from './Logger.js';
import { runWithRetry, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RETRIES } from './runWithRetry.js';

export class Orchestrator {
    constructor(options = {}) {
        this.options = options;
        this.verbose = options.verbose !== false;
        this.logger = options.logger || new Logger(this.verbose);
    }

    async run(provider, prompt, pageOrContext) {
        let browserContext;
        let inputPage = null;

        if (pageOrContext.context && typeof pageOrContext.context === 'function') {
            inputPage = pageOrContext;
            browserContext = pageOrContext.context();
        } else {
            browserContext = pageOrContext;
        }

        if (this.verbose) {
            this.logger.log(`🤖 Running Orchestrator with provider: ${provider.name}\n`);
            this.logger.logContext(browserContext, inputPage);
        }

        const existingSessionId = sessionManager.getSession(browserContext);
        if (existingSessionId && this.verbose) {
            this.logger.log(`♻️  SESSION: Resuming session: ${existingSessionId}\n`);
        }

        const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;

        const result = await runWithRetry({
            createMcp: () => createMcpHttpServer(browserContext),
            callProvider: ({ mcpUrl, abortController }) => provider.run(prompt, {
                mcpUrl,
                existingSessionId,
                verbose: this.verbose,
                returnUsage: this.options.returnUsage,
                logger: this.logger,
                abortController,
            }),
            timeoutMs,
            maxRetries,
            logger: this.logger,
            verbose: this.verbose,
            signal: this.options.abortController?.signal,
        });

        if (result.sessionId) {
            sessionManager.setSession(browserContext, result.sessionId);
        }

        return this.options.returnUsage ? result : result.result;
    }
}
