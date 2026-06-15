# Test Plan — Live step execution + resume-from-failed-step (PR #8)

## What changed (user-visible)
On a test's detail page, when you click **Run test**, a **Live execution** panel now streams each step in real time as Testrify drives Chromium against `the-internet.herokuapp.com` (queued → running → passed/failed). On a failure it shows the failing step + a screenshot, and a **Resume from step N** control re-runs from that step (fast-forwarding earlier steps) instead of restarting at step one.

## Environment
- Local Nitro prod build at `http://localhost:3000` (real Playwright engine from PR #6).
- Logged in as `toddz@outlook.com`.
- Test under test: **"Login — valid credentials"** (id `8d75da93…`), 6 steps. Step 3 (`click`) target has been set to a broken locator `button#wrong-login-btn` to force a deterministic mid-step failure.
- Note: the in-app **AI "Heal locator"** button calls the Lovable AI gateway (`LOVABLE_API_KEY`), which is not configured here. The **locator repair** is therefore performed by writing the corrected selector to the test spec directly (simulating what the Heal button does), then the UI's own **Resume** button is used. This is called out on-camera.

## Primary flow (the proof)

### Test 1 — It should stream steps live and fail at the broken step with a screenshot
1. From the dashboard, click the **"Login — valid credentials"** test to open `/tests/<id>`.
2. Click **Run test**.
3. Observe the **Live execution** panel.

**Pass/fail criteria (must all hold):**
- The panel appears with status **"Running…"** and shows **all 6 steps** up front (step rows 1–6), not an empty/!post-hoc list. (If broken: no live panel, or steps only appear after completion.)
- Steps advance visibly: step 1 `goto`, step 2 `fill`, step 3 `fill`… each turning green (passed) **one at a time**, with a spinner on the in-flight step. (If broken: all steps flip at once at the end.)
- Step 4 (`click button#wrong-login-btn`) turns **red (failed)** — the index of the failing step is **4** (1-based), i.e. the click step.
- The failed step shows an **error containing `Timeout`** and `button#wrong-login-btn`, AND a **failure screenshot** thumbnail of the Heroku login page is rendered.
- Steps 5 (`expect_text`) and 6 (`expect_url_contains`) are shown as **skipped** (greyed), not passed and not failed.
- Header summary reads failed with **"2/6 passed"** is NOT shown; expected counts: 3 passed (goto+fill+fill), 1 failed, 2 skipped → header shows status **Failed · 3/6 passed**.

### Test 2 — It should resume from the failed step after the locator is repaired (not restart at step one)
4. Repair the locator (set step 3 target back to `button[type=submit]`) — done via spec update; on-camera I then refresh so the **Steps** section shows the corrected `button[type=submit]`.
5. In the failed run (Run history → **Resume from failed**, or live panel **Resume from step N**), click to resume.

**Pass/fail criteria (must all hold):**
- A new Live execution begins with header noting **"resumed from step 4"**.
- Steps 1–3 render as **skipped** (fast-forwarded) — they are NOT re-asserted/among the green "passed" newly-run set, proving it did not restart at step one. (If broken: steps 1–3 run as fresh passed steps from the top.)
- Step 4 (`click`, now healed) turns **green (passed)** — proving the rebuilt browser state (logged-in form) was carried via fast-forward and the corrected locator works.
- Steps 5 and 6 turn **green (passed)**: `expect_text` "You logged into a secure area!" and `expect_url_contains` `/secure`.
- Final header status: **Passed · 6/6** (summary passed count = 3 newly run; total 6; status passed). Run history shows a Passed run.

## Why these distinguish working vs broken
- A broken live-stream would show no incremental updates (steps appear only after the run finishes) — Test 1 checks steps advance one-by-one with a spinner.
- A broken resume would re-run steps 1–3 as fresh passed steps (restart at step one) — Test 2 explicitly checks 1–3 are **skipped/fast-forwarded** and only 4–6 execute.
- A simulated (non-real) engine would not produce a real screenshot of the Heroku page nor a real Playwright `Timeout` error on the bad selector — Test 1 checks both.
