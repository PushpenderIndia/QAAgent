export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 1000;

// Conservative allowlist of transient, network-level failure signatures. Assertion
// failures and "no tool calls" errors are legitimate test failures and must never
// match here — retrying them wastes API calls and hides real bugs.
const TRANSIENT_ERROR_PATTERNS = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'EPIPE',
    'socket hang up',
    'network error',
    'fetch failed',
];

function isTransientError(error) {
    const haystack = `${error?.code ?? ''} ${error?.message ?? ''}`;
    return TRANSIENT_ERROR_PATTERNS.some(pattern => haystack.includes(pattern));
}

/**
 * Runs a provider call with a fresh MCP server per attempt, a timeout, and
 * retry-on-transient-failure. Shared by Orchestrator (browser) and ApiOrchestrator (API).
 *
 * @param {object} params
 * @param {() => Promise<{ url: string, cleanup: () => Promise<void> }>} params.createMcp
 * @param {(ctx: { mcpUrl: string, abortController: AbortController }) => Promise<object>} params.callProvider
 * @param {number} params.timeoutMs
 * @param {number} params.maxRetries
 * @param {import('./Logger.js').Logger} params.logger
 * @param {boolean} params.verbose
 * @param {AbortSignal} [params.signal] - External cancellation (e.g. a "Stop" button). When it
 *   aborts, the current attempt's abortController is aborted too and no retry is attempted.
 */
export async function runWithRetry({ createMcp, callProvider, timeoutMs, maxRetries, logger, verbose, signal }) {
    const maxAttempts = maxRetries + 1;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) {
            throw new Error('Agent run was cancelled.');
        }

        // Recreate the MCP server on every attempt: a stuck/broken server is a plausible
        // cause of a transient failure, so reusing it across retries risks repeating it.
        const { url: mcpUrl, cleanup } = await createMcp();
        const abortController = new AbortController();
        let timer;
        let cancelled = false;
        const onExternalAbort = () => {
            cancelled = true;
            abortController.abort();
        };
        signal?.addEventListener('abort', onExternalAbort);

        try {
            const result = await new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    // Best-effort cancellation: providers that accept the abortController
                    // will stop their in-flight work; others just leave the caller unblocked.
                    abortController.abort();
                    reject(new Error(`Agent run timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                callProvider({ mcpUrl, abortController }).then(resolve, reject);
            });

            return result;
        } catch (error) {
            if (cancelled) {
                throw new Error('Agent run was cancelled.');
            }
            lastError = error;

            const willRetry = attempt < maxAttempts && isTransientError(error);
            if (!willRetry) {
                throw error;
            }

            if (verbose) {
                logger.log(`⚠️  Transient error, retrying (attempt ${attempt + 1}/${maxAttempts}): ${error.message}\n`);
            }
            await new Promise(resolve => setTimeout(resolve, RETRY_BACKOFF_MS * attempt));
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onExternalAbort);
            await cleanup();
        }
    }

    throw lastError;
}
