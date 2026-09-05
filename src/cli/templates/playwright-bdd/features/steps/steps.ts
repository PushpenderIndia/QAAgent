import { runAgent, claudeCode } from 'qa-agent';
import { aistep } from './fixtures';

const verbose = process.env.QA_AGENT_VERBOSE !== 'false';

// Build context header from env vars so the agent knows the app URL and credentials
function buildEnvContext(): string {
    const lines: string[] = [];
    if (process.env.BASE_URL)     lines.push(`Application base URL: ${process.env.BASE_URL}`);
    if (process.env.APP_USERNAME) lines.push(`App username: ${process.env.APP_USERNAME}`);
    if (process.env.APP_PASSWORD) lines.push(`App password: ${process.env.APP_PASSWORD}`);
    return lines.length > 0 ? `[Context]\n${lines.join('\n')}\n\n` : '';
}

// Generic AI step - handles ALL Given/When/Then steps with natural language
aistep(/^(.*)$/, async ({ page }, action: string) => {
    await runAgent(claudeCode('claude-haiku-4-5'), `${buildEnvContext()}${action}`, page, { verbose });
});
