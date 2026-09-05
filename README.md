# QAAgent
**End-to-end and API testing, plain English in, a full report out.**

QAAgent is an agent harness for test automation. Describe a scenario in plain English — "log in", "add an item to the cart", "check out" — and an AI agent drives a real Playwright-controlled browser to do it, the way a person would. No selectors to write or maintain. Switch the Target to **API** and the same agent tests REST endpoints directly over HTTP instead — status codes, headers, JSON bodies — no browser involved.

## Quick Start

```bash
git clone https://github.com/pushpenderindia/QAAgent.git
cd QAAgent
npm install
node src/cli/bin.js studio        # add --port 5000 or --no-open if needed
```

This builds and opens QAAgent Studio, a local web panel, in your browser — everything else happens there. Log in with [Claude Code](https://claude.ai/code) or [opencode](https://opencode.ai) first; no API key needed locally.

## Using the Studio

Pick a mode: **Test a scenario** (type what to test) or **Test a PR** (paste a GitHub PR URL — Studio fetches its diff via `gh` and plans the test itself; requires `gh auth login`). Then pick a **Target**:

- **UI (browser)** — drives a real browser; every run gets a video replay and a Playwright trace.
- **API (backend)** — calls REST endpoints directly, e.g. *"POST /users with `{\"name\":\"Ada\"}` should return 201 with an id, then GET /users/:id should return it."* Set a Base URL in the panel (or `BASE_URL` in `.env`). No video/trace — no browser opens.

Each run streams live and ends with a pass/fail result. Past runs stay in the sidebar — click one to reload it.

## Features

- Real UI or API coverage — a real browser, or real HTTP requests against your running app
- Mimics real usage — navigates by intent, not hardcoded selectors; survives UI refactors
- Scenario or PR-driven — write the test yourself, or let Studio plan it from a diff
- No API key locally, no scaffolding — uses your `claude login`/`opencode auth login` session
- Dual-engine — [opencode](https://opencode.ai) (70+ providers) or [Claude Code SDK](https://claude.ai/code), per run

## How It Works

Studio spins up an in-process MCP server on a random localhost port — Playwright MCP for UI, a custom HTTP-testing MCP server for API — and the chosen provider SDK connects to it, then works the instruction using that server's tools (`browser_navigate`/`browser_click`… or `api_request`/`api_verify_status`…), streaming each step live. The run passes or fails based on what the agent reports; UI runs also save video + trace.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | — | App/API URL used when not set per-run in the panel |
| `HEADLESS` | `true` | UI mode — set `false` to watch the browser during a run |
| `ANTHROPIC_API_KEY` | — | Only needed if not using `claude login` |
| `OPENAI_API_KEY` / `GOOGLE_API_KEY` | — | Only needed for CI via OpenCode |

## Authentication

```bash
claude login          # Claude Code
opencode auth login   # OpenCode — GitLab Duo, GitHub Copilot, Anthropic, OpenAI, Google, …
```

For CI, set the relevant API key in `.env` instead.

## Requirements

Node.js 18+ • `@playwright/test` ^1.57.0 (required peer, auto-installed) • `gh` CLI (PR-based testing only)
