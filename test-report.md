# Test Report — Live step view + heal-and-resume from failed step (PR #8)

**How tested:** Ran the app locally (`http://localhost:3000`, Nitro build) against the real target site `https://the-internet.herokuapp.com`. Logged in via the UI as `toddz@outlook.com`, opened the "Login — valid credentials" test (step 4 locator intentionally broken to `button#wrong-login-btn`), ran it live, then repaired the locator and resumed from the failed step — all through the UI.

## Result summary

Both critical flows passed against the real Heroku site. No failures or unexpected behavior.

- **Test 1 — live stream + fail at broken step:** PASSED
- **Test 2 — resume from failed step (not from step one):** PASSED

### Caveats / things to know
- **AI "Heal locator" button was NOT exercised** — it requires `LOVABLE_API_KEY`, which isn't configured (app shows a "LOVABLE_API_KEY missing" toast). To simulate the locator repair I patched the test spec directly (changed step 4 target `button#wrong-login-btn` → `button[type=submit]`), then used the app's own **"Resume from failed"** button, which does NOT depend on AI. The resume mechanism itself is fully proven; only the AI suggestion step is untested.

---

## Test 1 — It should stream steps live and fail at the broken step with a screenshot

Steps streamed live one-by-one (queued → running → passed) with per-step durations. Step 4 (`click button#wrong-login-btn`) failed after a 5s Playwright timeout, captured a failure screenshot, and steps 5–6 were marked skipped. Header showed **"Failed · 3/6 passed"** and a **"Resume from step 4"** button appeared.

- [PASS] Live panel shows all 6 steps; steps advance with running spinner and durations
- [PASS] Steps 1–3 passed (goto 962ms, fill, fill)
- [PASS] Step 4 failed with `locator.click: Timeout 5000ms exceeded` + failure screenshot
- [PASS] Steps 5–6 skipped
- [PASS] Header "Failed · 3/6 passed"; step-map bar green/green/green/red/gray/gray; "Resume from step 4" shown

| Failure state (full page) | Failure detail (zoom) |
|---|---|
| ![fail-full](https://app.devin.ai/attachments/5c389409-496f-4a05-831e-21cb00a31146/screenshot_1a267427de0145c19631642c6580b9ce.png) | ![fail-zoom](https://app.devin.ai/attachments/2bb563c1-6d14-4ee9-8b16-db4b39d58650/screenshot_zoom_d36de364e4244b27a3aeadf39429778c.png) |

---

## Test 2 — It should resume from the failed step after locator is repaired (not restart at step one)

After repairing the locator (step 4 → `button[type=submit]`) and refreshing, the corrected selector appeared in the Steps list. Clicking **"Resume from failed"** re-ran the test starting at step 4: steps 1–3 were skipped/fast-forwarded (NOT re-run from the top), and steps 4–6 passed. Header showed **"Passed · 3/6 passed · resumed from step 4"** with a "Run passed" toast.

- [PASS] Precondition: locator repaired to `button[type=submit]`; failed run present in history
- [PASS] Resume started at step 4 — steps 1–3 skipped (fast-forwarded to rebuild login state), not restarted from step one
- [PASS] Steps 4–6 passed (corrected selector clicked, assertions passed)
- [PASS] Final status "Passed · resumed from step 4"; step-map bar gray/gray/gray/green/green/green

| Repaired spec + failed run in history (before) | Resumed run passed (after) |
|---|---|
| ![repaired](https://app.devin.ai/attachments/9748a76e-7b36-48e6-9b5d-cd1ca015e8ef/screenshot_7fc7fb5ca24540158bfd614c0b3d8fe8.png) | ![resume-full](https://app.devin.ai/attachments/f7954c0f-0fd9-497b-8364-13046410fe1b/screenshot_f5ba6171cbfd48e6b827ca67f207b559.png) |

Resumed run detail (steps 1–3 skipped icons, steps 4–6 green):

![resume-zoom](https://app.devin.ai/attachments/8a59e2ac-cce6-4a46-b8ef-492034cd4e05/screenshot_zoom_a900019f93154d45922084c373d3ae14.png)

---

## Environment
- App: local Nitro build at `http://localhost:3000`
- Target site: `https://the-internet.herokuapp.com`
- Test: "Login — valid credentials" (`8d75da93-bd06-4a38-afef-064f71398b5a`), 6 steps
- Account: `toddz@outlook.com`
