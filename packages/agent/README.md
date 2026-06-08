# testrify-agent

Local Playwright test runner agent for [Testrify](https://github.com/toddz435/playwright-perfected-39).

Polls the Testrify server for pending browser test runs, executes them with real Playwright (Chromium), and reports results back — including screenshots on failure and hot-restart support (resume from a failed step).

## Quick Start

```bash
# Install globally
npm install -g testrify-agent

# Or run directly
npx testrify-agent start --api-key <your-api-key>
```

## Usage

```bash
testrify-agent start --api-key <key> [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--api-key <key>` | (required) | API key for server authentication |
| `--server <url>` | `http://localhost:3000` | Testrify server URL |
| `--poll-interval <ms>` | `3000` | How often to check for work (ms) |
| `--no-headless` | `false` | Show the browser window |

### Environment Variables

| Variable | Description |
|---|---|
| `TESTRIFY_API_KEY` | Alternative to `--api-key` |
| `TESTRIFY_SERVER` | Alternative to `--server` |

## How It Works

1. Agent connects to the Testrify server and authenticates with its API key
2. Polls `GET /api/agent/poll` every few seconds for pending test runs
3. When a run is assigned, downloads the test spec (steps + locators)
4. Launches Chromium via Playwright and executes each step
5. If resuming from a failed step (`resumeFromStep`), fast-forwards navigational actions to rebuild browser state, then executes remaining steps normally
6. Reports results (step statuses, screenshots, timing) via `POST /api/agent/report`
7. Sends periodic heartbeats so the server knows the agent is alive

## Prerequisites

Playwright's Chromium browser must be installed:

```bash
npx playwright install chromium
npx playwright install-deps chromium
```

## Development

```bash
cd packages/agent
npm install
npm run dev -- start --api-key test-key --server http://localhost:3000
```
