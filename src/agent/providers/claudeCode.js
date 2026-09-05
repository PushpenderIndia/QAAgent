import { query } from '@anthropic-ai/claude-agent-sdk';
import { PLAYWRIGHT_SYSTEM_PROMPT } from '../systemPrompt.js';

export const claudeCode = (model = 'claude-haiku-4-5', options = {}) => ({
    name: 'claude-code',

    async run(prompt, {
        mcpUrl,
        existingSessionId,
        verbose,
        logger,
        abortController,
        systemPrompt = PLAYWRIGHT_SYSTEM_PROMPT,
        mcpServerName = 'playwright',
        assertionToolPattern = 'browser_verify_',
        noToolCallMessage = 'Agent responded without calling any Playwright MCP tools. The step is considered failed.',
        stopHookMessage = 'CRITICAL: You MUST call a Playwright MCP tool (e.g. browser_snapshot, browser_navigate, browser_verify_text_visible). You have not called any tool yet. Call one NOW.',
    }) {
        let stepCount = 0;
        let finalResult = '';
        let assertionFailed = false;
        let assertionError = '';
        let currentSessionId = existingSessionId;

        // Map tool_use_id → tool name so we can identify which tool errored
        const toolNameById = new Map();

        // Stop hook: if the agent tries to respond without calling any Playwright tool,
        // force it to continue and call one. Allow up to 2 retries before giving up.
        let stopRetryCount = 0;
        const MAX_STOP_RETRIES = 2;

        const stopHook = async (_input) => {
            if (stepCount === 0 && stopRetryCount < MAX_STOP_RETRIES) {
                stopRetryCount++;
                if (verbose) logger.log(`⚠️  No Playwright tool called — forcing retry (${stopRetryCount}/${MAX_STOP_RETRIES})\n`);
                return {
                    continue: true,
                    systemMessage: stopHookMessage,
                };
            }
            return { continue: false };
        };

        const messages = query({
            prompt,
            options: {
                model,
                mcpServers: {
                    [mcpServerName]: { type: 'http', url: mcpUrl },
                },
                systemPrompt,
                permissionMode: 'bypassPermissions',
                resume: existingSessionId,
                hooks: {
                    Stop: [{ hooks: [stopHook] }],
                },
                cwd: process.cwd(),
                // Lets the Orchestrator cancel an in-flight query on timeout — the SDK stops
                // and cleans up its own resources when this controller aborts.
                abortController,
            },
        });

        for await (const message of messages) {
            if (message.type === 'system' && message.subtype === 'init') {
                currentSessionId = message.session_id;
                if (verbose && !existingSessionId) {
                    logger.log(`🆕 Started new session: ${currentSessionId}\n`);
                }
            }

            if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
                for (const block of message.message.content) {
                    if (block.type === 'tool_use') {
                        toolNameById.set(block.id, block.name);
                        stepCount++;
                        if (verbose) logger.log(`🔧 Tool Call: ${block.name}(${JSON.stringify(block.input ?? {})})`);
                    }
                    if (block.type === 'text' && block.text && verbose) {
                        logger.log(`💬 Assistant: ${block.text}`);
                    }
                }
            }

            // Detect tool errors from user messages (tool_result blocks with is_error:true)
            if (message.type === 'user' && Array.isArray(message.message?.content)) {
                for (const block of message.message.content) {
                    if (block.type === 'tool_result' && block.is_error) {
                        const toolName = toolNameById.get(block.tool_use_id) ?? '';
                        let errorText = typeof block.content === 'string'
                            ? block.content
                            : Array.isArray(block.content)
                                ? block.content.map(c => c.text ?? JSON.stringify(c)).join('\n')
                                : 'Unknown tool error';
                        errorText = errorText.replace(/^### (?:Error|Result)\n/, '').trim();

                        if (verbose) logger.log(`❌ Tool Error [${toolName}]: ${errorText}`);

                        if (toolName.includes(assertionToolPattern)) {
                            assertionFailed = true;
                            assertionError = errorText;
                        }
                    }
                }
            }

            if (message.type === 'result' && message.subtype === 'success') {
                finalResult = message.result ?? '';
                if (verbose) logger.log(`✅ Result: ${finalResult}`);
            }
        }

        if (assertionFailed) {
            const summary = finalResult.trim() || assertionError;
            throw new Error(summary);
        }

        if (stepCount === 0) {
            throw new Error(noToolCallMessage);
        }

        return {
            result: finalResult.trim(),
            steps: stepCount,
            sessionId: currentSessionId,
        };
    },
});
