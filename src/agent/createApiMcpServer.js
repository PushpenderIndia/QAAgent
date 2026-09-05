import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import http from 'http';
import { z } from 'zod';

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_REQUEST_TIMEOUT_MS = 60000;
const BODY_PREVIEW_CHARS = 4000;

function textResult(text, isError = false) {
    const result = { content: [{ type: 'text', text }] };
    if (isError) result.isError = true;
    return result;
}

function errorResult(text) {
    return textResult(text, true);
}

function resolveUrl(rawUrl, baseUrl, query) {
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        if (!baseUrl) {
            throw new Error(`"${rawUrl}" is not an absolute URL and no base URL is configured. Pass an absolute URL or configure a base URL.`);
        }
        const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        url = new URL(rawUrl.replace(/^\//, ''), normalizedBase);
    }
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            url.searchParams.set(key, value);
        }
    }
    return url;
}

// Parses a dot/bracket path like "data.items[0].name" ("" means the root value).
function getPath(value, path) {
    if (!path) return value;
    const parts = path.match(/[^.[\]]+/g) || [];
    let current = value;
    for (const part of parts) {
        if (current == null) return undefined;
        current = current[/^\d+$/.test(part) ? Number(part) : part];
    }
    return current;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a && b && typeof a === 'object') {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
}

function jsonType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

// Minimal recursive JSON-Schema-like validator: type, required, properties, items, enum.
function validateSchema(value, schema, path, violations) {
    if (schema.enum && !schema.enum.some(v => deepEqual(v, value))) {
        violations.push(`${path}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
        return;
    }
    if (schema.type) {
        const actual = jsonType(value);
        const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!expected.includes(actual)) {
            violations.push(`${path}: expected type ${expected.join(' or ')}, got ${actual}`);
            return;
        }
    }
    if (schema.type === 'object' || (schema.properties && jsonType(value) === 'object')) {
        for (const key of schema.required || []) {
            if (!(key in (value || {}))) {
                violations.push(`${path}.${key}: required property missing`);
            }
        }
        for (const [key, subSchema] of Object.entries(schema.properties || {})) {
            if (value && key in value) {
                validateSchema(value[key], subSchema, `${path}.${key}`, violations);
            }
        }
    }
    if (schema.type === 'array' && schema.items && Array.isArray(value)) {
        value.forEach((item, i) => validateSchema(item, schema.items, `${path}[${i}]`, violations));
    }
}

/**
 * Creates an in-process API-testing MCP server exposed over StreamableHTTP on a random
 * localhost port. No browser required — for testing backend/REST endpoints directly.
 * Compatible with both Claude Code SDK (type:'http') and OpenCode SDK (type:'remote').
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Base URL relative request paths are resolved against.
 * @param {Record<string,string>} [options.headers] - Headers sent with every request (e.g. auth).
 * @returns {Promise<{ url: string, cleanup: () => Promise<void> }>}
 */
export async function createApiMcpServer({ baseUrl, headers: defaultHeaders } = {}) {
    // Per-server run state: the most recent response and full history, so verify tools
    // and api_run_code_unsafe can inspect results across a multi-request scenario.
    let lastResponse = null;
    const responses = [];

    const mcpServer = new McpServer({ name: 'qa-agent-api-testing', version: '1.0.0' });

    mcpServer.registerTool('api_request', {
        title: 'Make an HTTP API request',
        description: 'Sends an HTTP request to the API under test and stores the response for verification with api_verify_* tools. Accepts an absolute URL or a path resolved against the configured base URL. Does NOT assert anything by itself — follow up with an api_verify_* tool.',
        inputSchema: {
            method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).describe('HTTP method'),
            url: z.string().describe('Absolute URL, or a path (e.g. "/api/users") resolved against the base URL'),
            headers: z.record(z.string(), z.string()).optional().describe('Additional request headers'),
            query: z.record(z.string(), z.string()).optional().describe('Query string parameters to append to the URL'),
            body: z.union([z.string(), z.record(z.string(), z.any()), z.array(z.any())]).optional().describe('Request body. Objects/arrays are sent as JSON (Content-Type set automatically); strings are sent as-is.'),
            timeoutMs: z.number().int().positive().max(MAX_REQUEST_TIMEOUT_MS).optional().describe(`Request timeout in ms (default ${DEFAULT_REQUEST_TIMEOUT_MS})`),
        },
    }, async ({ method, url, headers, query, body, timeoutMs }) => {
        let target;
        try {
            target = resolveUrl(url, baseUrl, query);
        } catch (err) {
            return errorResult(err.message);
        }

        const reqHeaders = { ...defaultHeaders, ...headers };
        let reqBody;
        if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
            if (typeof body === 'string') {
                reqBody = body;
            } else {
                reqBody = JSON.stringify(body);
                reqHeaders['content-type'] ??= 'application/json';
            }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
        const started = Date.now();

        let res, text;
        try {
            res = await fetch(target, { method, headers: reqHeaders, body: reqBody, signal: controller.signal });
            text = await res.text();
        } catch (err) {
            return errorResult(`Request failed: ${method} ${target} — ${err.name === 'AbortError' ? 'timed out' : err.message}`);
        } finally {
            clearTimeout(timer);
        }

        const durationMs = Date.now() - started;
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = undefined;
        }

        lastResponse = {
            method,
            url: target.toString(),
            status: res.status,
            statusText: res.statusText,
            ok: res.ok,
            headers: Object.fromEntries(res.headers.entries()),
            bodyText: text,
            bodyJson: json,
            durationMs,
        };
        responses.push(lastResponse);

        const preview = text.length > BODY_PREVIEW_CHARS
            ? `${text.slice(0, BODY_PREVIEW_CHARS)}\n...[truncated ${text.length - BODY_PREVIEW_CHARS} more characters]`
            : text;

        return textResult(
            `${method} ${target} → ${res.status} ${res.statusText} (${durationMs}ms)\n` +
            `Headers: ${JSON.stringify(lastResponse.headers)}\n` +
            `Body:\n${preview || '(empty body)'}`
        );
    });

    mcpServer.registerTool('api_verify_status', {
        title: 'Verify the last response status code',
        description: 'Hard assertion: fails the step if the most recent api_request response status does not match.',
        inputSchema: {
            expected: z.union([z.number(), z.array(z.number())]).describe('Expected status code, or an array of acceptable codes'),
        },
    }, async ({ expected }) => {
        if (!lastResponse) return errorResult('No API request has been made yet. Call api_request first.');
        const ok = Array.isArray(expected) ? expected.includes(lastResponse.status) : lastResponse.status === expected;
        if (!ok) {
            return errorResult(`Expected status ${Array.isArray(expected) ? expected.join(' or ') : expected}, got ${lastResponse.status} ${lastResponse.statusText} for ${lastResponse.method} ${lastResponse.url}`);
        }
        return textResult(`✓ Status ${lastResponse.status} matches expected.`);
    });

    mcpServer.registerTool('api_verify_header', {
        title: 'Verify a response header',
        description: 'Hard assertion: fails the step if the named header on the last response does not match.',
        inputSchema: {
            name: z.string().describe('Header name (case-insensitive)'),
            expected: z.string().describe('Expected header value'),
            mode: z.enum(['equals', 'contains']).optional().describe('Comparison mode (default "equals")'),
        },
    }, async ({ name, expected, mode = 'equals' }) => {
        if (!lastResponse) return errorResult('No API request has been made yet. Call api_request first.');
        const actual = lastResponse.headers[name.toLowerCase()];
        if (actual === undefined) {
            return errorResult(`Header "${name}" is not present on the last response. Headers: ${JSON.stringify(lastResponse.headers)}`);
        }
        const ok = mode === 'contains' ? actual.includes(expected) : actual === expected;
        if (!ok) {
            return errorResult(`Header "${name}": expected ${mode === 'contains' ? 'to contain' : 'to equal'} "${expected}", got "${actual}"`);
        }
        return textResult(`✓ Header "${name}" matches expected.`);
    });

    mcpServer.registerTool('api_verify_json_value', {
        title: 'Verify a value in the last JSON response body',
        description: 'Hard assertion against the most recent api_request response body (must be valid JSON). Use path "" for the root value, and dot/bracket notation otherwise, e.g. "data.items[0].name".',
        inputSchema: {
            path: z.string().describe('Dot/bracket path into the JSON body, e.g. "data.items[0].name". Use "" for the root value.'),
            mode: z.enum(['equals', 'contains', 'exists', 'not_exists', 'type', 'matches']).describe('Comparison mode'),
            expected: z.any().optional().describe('Expected value (for equals/contains/matches modes)'),
            type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null']).optional().describe('Expected type (for the "type" mode)'),
        },
    }, async ({ path, mode, expected, type }) => {
        if (!lastResponse) return errorResult('No API request has been made yet. Call api_request first.');
        if (lastResponse.bodyJson === undefined) {
            return errorResult(`The last response body is not valid JSON. Body: ${lastResponse.bodyText.slice(0, 500)}`);
        }

        const actual = getPath(lastResponse.bodyJson, path);
        const label = path || '(root)';

        switch (mode) {
            case 'exists':
                if (actual === undefined) return errorResult(`Expected "${label}" to exist, but it was undefined.`);
                return textResult(`✓ "${label}" exists.`);
            case 'not_exists':
                if (actual !== undefined) return errorResult(`Expected "${label}" to not exist, got ${JSON.stringify(actual)}.`);
                return textResult(`✓ "${label}" does not exist.`);
            case 'type': {
                const actualType = jsonType(actual);
                if (actualType !== type) return errorResult(`Expected "${label}" to have type "${type}", got "${actualType}" (${JSON.stringify(actual)}).`);
                return textResult(`✓ "${label}" has type "${type}".`);
            }
            case 'equals':
                if (!deepEqual(actual, expected)) return errorResult(`Expected "${label}" to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
                return textResult(`✓ "${label}" equals expected value.`);
            case 'contains': {
                let ok = false;
                if (typeof actual === 'string') ok = actual.includes(String(expected));
                else if (Array.isArray(actual)) ok = actual.some(v => deepEqual(v, expected));
                else if (actual && typeof actual === 'object') ok = Object.entries(expected ?? {}).every(([k, v]) => deepEqual(actual[k], v));
                if (!ok) return errorResult(`Expected "${label}" (${JSON.stringify(actual)}) to contain ${JSON.stringify(expected)}.`);
                return textResult(`✓ "${label}" contains expected value.`);
            }
            case 'matches': {
                const re = new RegExp(expected);
                if (!re.test(String(actual))) return errorResult(`Expected "${label}" (${JSON.stringify(actual)}) to match /${expected}/.`);
                return textResult(`✓ "${label}" matches /${expected}/.`);
            }
            default:
                return errorResult(`Unknown mode "${mode}".`);
        }
    });

    mcpServer.registerTool('api_verify_schema', {
        title: 'Verify the last JSON response body against a schema',
        description: 'Hard assertion: validates the most recent response body against a JSON-Schema-like subset (type, required, properties, items, enum). Reports ALL violations found.',
        inputSchema: {
            schema: z.record(z.string(), z.any()).describe('A JSON-Schema-like object, e.g. { type: "object", required: ["id"], properties: { id: { type: "number" } } }'),
        },
    }, async ({ schema }) => {
        if (!lastResponse) return errorResult('No API request has been made yet. Call api_request first.');
        if (lastResponse.bodyJson === undefined) {
            return errorResult(`The last response body is not valid JSON. Body: ${lastResponse.bodyText.slice(0, 500)}`);
        }
        const violations = [];
        validateSchema(lastResponse.bodyJson, schema, '$', violations);
        if (violations.length) {
            return errorResult(`Schema validation failed:\n${violations.join('\n')}`);
        }
        return textResult('✓ Response body matches the schema.');
    });

    mcpServer.registerTool('api_run_code_unsafe', {
        title: 'Run custom JS to make requests or assert on responses',
        description: 'Runs an async JS function with access to fetch, lastResponse, and responses (all responses made this run). Use for soft assertions (collect multiple failures) or checks the other tools cannot express. Throw an Error to fail; return a value/string to pass.',
        inputSchema: {
            code: z.string().describe('An async arrow function body, e.g. "async () => { ...; return \'ok\'; }"'),
        },
    }, async ({ code }) => {
        try {
            // eslint-disable-next-line no-new-func -- intentional: lets the agent express arbitrary assertions/requests, same trust level as a Bash tool call in this agent's own harness.
            const build = new Function('fetch', 'lastResponse', 'responses', `return (${code})`);
            const fnOrValue = build(fetch, lastResponse, responses.slice());
            const result = typeof fnOrValue === 'function' ? await fnOrValue() : await fnOrValue;
            return textResult(typeof result === 'string' ? result : JSON.stringify(result ?? null));
        } catch (err) {
            return errorResult(err?.message || String(err));
        }
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });

    try {
        await mcpServer.connect(transport);
    } catch (error) {
        await mcpServer.close().catch(() => {});
        throw error;
    }

    const httpServer = http.createServer(async (req, res) => {
        await transport.handleRequest(req, res);
    });

    httpServer.on('error', (error) => {
        console.error('API MCP HTTP server error:', error);
    });

    let port;
    try {
        port = await new Promise((resolve, reject) => {
            httpServer.once('error', reject);
            httpServer.listen(0, '127.0.0.1', () => {
                httpServer.removeListener('error', reject);
                resolve(httpServer.address().port);
            });
        });
    } catch (error) {
        await transport.close().catch(() => {});
        await mcpServer.close().catch(() => {});
        throw error;
    }

    return {
        url: `http://127.0.0.1:${port}/mcp`,
        cleanup: async () => {
            httpServer.close();
            await transport.close().catch(() => {});
            await mcpServer.close().catch(() => {});
        },
    };
}
