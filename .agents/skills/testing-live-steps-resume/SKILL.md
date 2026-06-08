---
name: testing-live-steps-resume
description: Test Testrify's live step-streaming execution view and heal-and-resume-from-failed-step flow end-to-end against the real Heroku target site. Use when verifying changes to the test runner, run-test API, live progress UI, or resume logic.
---

# Testing live steps + heal-and-resume

Verifies that a browser test streams each step live (queued -> running -> passed/failed) against `https://the-internet.herokuapp.com`, fails mid-step with a screenshot, and can resume from the failed step (earlier steps fast-forwarded/skipped, NOT restarted from step one).

## Prerequisites / setup
- Build + run the Nitro server locally: `npm install`, `npx playwright install chromium`, `npm run build`, then `NITRO_PORT=3000 node .output/server/index.mjs`. App at `http://localhost:3000`.
- Log in through the UI with the test account (see Devin Secrets Needed). Supabase email confirmation may be on, so use a pre-confirmed account rather than self-signup (signup hits `over_email_send_rate_limit`).

## Seed a broken-locator scenario
The runner uses a test spec stored in the Supabase `tests` table (`spec.steps` JSONB; RLS requires `auth.uid() = owner_id`). To force a mid-step failure, PATCH one step's `target` to a selector that won't resolve (e.g. a click step -> `button#wrong-login-btn`). Get an access token via the password grant against `${SUPABASE_URL}/auth/v1/token?grant_type=password` using `SUPABASE_PUBLISHABLE_KEY` as `apikey`, then PATCH `${SUPABASE_URL}/rest/v1/tests?id=eq.<TESTID>`.

A good demo test is "Login — valid credentials" (6 steps): goto -> fill username -> fill password -> click submit -> expect_text -> expect_url_contains. Breaking the click step (index 3 / UI step 4) produces a clean Playwright `Timeout 5000ms exceeded` failure with a screenshot.

## Test 1 — live stream + fail
1. Open the test detail page, click "Run test".
2. Expect a "Live execution" panel showing all steps up front; they advance one-by-one with a running spinner and per-step durations.
3. The broken click step fails with `locator.click: Timeout 5000ms exceeded` and a failure screenshot; later steps go to `skipped`.
4. Header shows "Failed · N/M passed"; a "Resume from step N" button appears.

## Test 2 — resume from failed step (not from step one)
1. Repair the locator (PATCH the spec back to a valid selector, e.g. `button[type=submit]`), then refresh — the corrected selector should appear in the Steps list.
2. Click "Resume from failed" (run history) or "Resume from step N" (live panel).
3. Expect the resumed run to start at the failed step: earlier steps show skipped icons (fast-forwarded to rebuild state, not re-asserted), and from the failed step onward they pass.
4. Header shows "Passed · ... · resumed from step N".

## Gotchas
- The in-app **AI "Heal locator"** button requires `LOVABLE_API_KEY` (calls `https://ai.gateway.lovable.dev`). Without it the app shows a "LOVABLE_API_KEY missing" toast and AI healing won't work. The **resume** mechanism itself does NOT need the key — repair the spec manually and use the app's "Resume from failed" button to test resume independently.
- The client polls the latest run (~600ms) while status is `running`; per-step DB writes intentionally serialize execution to keep the live view accurate.
- After testing you may want to re-break the locator to leave the demo scenario reproducible, or leave it repaired (healthy) — note which state you left it in.

## Devin Secrets Needed
- Test login (Supabase, pre-confirmed account) — username/password for UI login. Stored as a permanent secret in this org.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` — present in repo `.env`; used to mint an access token and PATCH the test spec.
- `LOVABLE_API_KEY` — optional; only needed to exercise the AI "Heal locator" suggestion. Not required for live-steps or resume testing.
