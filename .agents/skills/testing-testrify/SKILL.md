---
name: testing-testrify
description: Test the Testrify app end-to-end — server startup, browser test execution via dashboard, agent CLI verification. Use when verifying Testrify UI or Playwright engine changes.
---

# Testing Testrify

## Prerequisites

### Devin Secrets Needed
- Test account credentials for Supabase auth (email + password)
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env` (should already exist in repo)
- `SUPABASE_SERVICE_ROLE_KEY` — needed for agent polling tests and direct DB verification; not available by default

### Environment Setup
1. `npm install` at repo root (installs all workspaces including `packages/agent`)
2. `npm run build` — builds the Nitro server output to `.output/`
3. Agent CLI: `node packages/agent/build.mjs` to build the agent package

## Starting the Server

**Critical**: Environment variables must be exported inline with the node command, not via `source .env` in a separate step. Background processes don't inherit shell-sourced env vars.

```bash
cd /path/to/repo
export $(grep -v '^#' .env | xargs) && NITRO_PORT=3000 node .output/server/index.mjs
```

Verify with: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` (should return 200)

## Test Flows

### 1. Landing Page (SSR Verification)
- Navigate to `http://localhost:3000`
- Verify title contains "Testrify"
- Verify hero text "Quality is our Priority" is visible
- Click "Sign in" → verify `/login` page loads with form

### 2. Browser Test Execution (Playwright Engine)
- Log in with test account
- On the Console page, use "Quick run" sidebar to run browser tests
- Good test cases already seeded:
  - **"Login — valid credentials"** (6 steps) — tests goto, fill, click, expect_text, expect_url_contains against the-internet.herokuapp.com
  - **"Dynamic loading — wait for element"** (4 steps) — tests async DOM waiting
- **Key discriminator**: Real Playwright takes 2-10s per test. The old mock returned in ~500ms with random 18% failure.
- After running, click into the test to see Run History with pass/fail status and timing

### 3. Agent CLI
- `node packages/agent/dist/cli.mjs --help` — should print usage with `--api-key`, `--server`, `--poll-interval` options
- Live polling requires `TESTRIFY_AGENT_KEY` env var on server + matching key passed to agent

## Known Issues & Pitfalls

### Dynamic imports fail in Nitro bundle
`await import("playwright/test")` works in raw Node.js but may fail silently in Nitro's bundled output. If `expect_text`/`expect_value`/`expect_count` steps fail while navigation/click/fill steps pass, this is likely the cause. The fix is to use native Playwright locator methods (`.textContent()`, `.inputValue()`, `.count()`) instead of the `expect()` API from `playwright/test`.

### Server exits immediately with no output
If `node .output/server/index.mjs` exits with code 0 and no output, check:
- Port conflict (`lsof -i :3000`)
- Missing env vars (especially `SUPABASE_URL`)
- Rebuild with `npm run build` if source changed

### Screenshots on failure
The step-executor captures screenshots on failure and stores them in the run's `step_results` JSONB. However, the dashboard UI might not expose per-step screenshots — verify via direct DB query if needed.

### Seed data
Demo test cases are seeded via a "Seed demo data" button on the dashboard. If no tests appear, click this first. Tests target `the-internet.herokuapp.com` which has tricky DOM elements good for testing resilient locators.

## What to Record
- Landing page rendering (SSR proof)
- Login flow
- Running a browser test from the Console and seeing results
- The timing comparison (2-10s for real Playwright vs ~500ms for mock)
- Agent CLI --help output (shell only, no recording needed)
