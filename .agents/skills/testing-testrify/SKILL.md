---
name: testing-testrify
description: End-to-end testing of the Testrify app. Use when verifying UI changes, refactoring, or new features across authenticated pages.
---

# Testing Testrify

## Prerequisites

- Node.js and npm installed
- Dev server running: `npm run dev` (Vite, runs on localhost:8081)
- Build passing: `npm run build`
- Unit tests passing: `npx vitest run`

## Devin Secrets Needed

- **Test account credentials**: Email and password for a confirmed Supabase account (email confirmation is required — new signups won't work without confirming the email or using the SERVICE_ROLE_KEY)
- **LOVABLE_API_KEY** (optional): Required for AI features (Analyze, Generate test, Codegen, Heal, Generate API suite). Without it, AI features will show a "LOVABLE_API_KEY missing" error toast — this is expected behavior, not a bug.
- **SUPABASE_SERVICE_ROLE_KEY** (optional): Only needed if you need to auto-confirm new user signups via the Supabase admin API.

## Authentication

- Supabase email/password auth with **email confirmation required**
- All test-relevant pages are behind `/_authenticated` layout guard
- Login at `/login`, signup at `/signup`
- If you don't have confirmed credentials, you'll be blocked from testing authenticated pages
- The anon key is already in `.env` — no additional Supabase config needed for basic auth

## Key Pages to Test

| Page | URL | Key Components |
|------|-----|----------------|
| Dashboard | `/dashboard` | Test list, Run buttons, Recent runs, Seed demo, AI test authoring |
| Console | `/console` | Live run feed, Quick Run sidebar, stats (pass rate, runs, duration) |
| Test Detail | `/tests/:testId` | Steps list, Run button, Run history, Resume from failed, Analyze |
| API Tester | `/api-tester` | AI suite generation textarea |
| Schedules | `/schedules` | Cron schedule form, test dropdown, preset buttons |
| Codegen | `/codegen` | AI code generation |

## How to Exercise Key Code Paths

### Running Tests (exercises server-side pipeline)
1. Click "Run" on Dashboard or "Run test" on Test detail page
2. This calls `/api/protected/run-test` which uses:
   - `protectedHandler` (auth wrapper)
   - `createUserClient` (Supabase client factory)
   - `executeTest` (test execution engine)
3. Results appear in "Recent runs" (Dashboard) or "Run history" (Test detail)
4. Console page shows all runs in the live feed

### Seed Demo Project
- Click "Seed demo project" on Dashboard
- Exercises `protectedHandler` + `createUserClient` in seed-demo endpoint
- Creates a new "Demo — The Internet" project with 5 tests

### AI Features (require LOVABLE_API_KEY)
- "Analyze" button on failed runs → `ai-analyze-failure` endpoint
- "Generate test" on Dashboard → `ai-generate-test` endpoint  
- "Generate suite" on API Tester → `ai-generate-api-suite` endpoint
- "Heal" buttons on test steps → `ai-heal-selector` endpoint
- Without the key, these show a toast error — verify the error is graceful (no crash)

## Common Issues

- **Email confirmation block**: New signups require email confirmation. If you can't log in with a fresh account, you need either confirmed credentials or the SERVICE_ROLE_KEY to auto-confirm via admin API.
- **Hydration mismatch console errors**: These are pre-existing SSR/client mismatches, not related to code changes. Safe to ignore.
- **API test failures**: The seeded API test hits `reqres.in` — if the external service is down or slow, the test step may fail. The `executeTest` pipeline still works correctly in this case (run is created and saved).
- **No CI configured**: This repo has no CI pipeline. Verify changes locally with `npm run build` and `npx vitest run`.

## Test Verification Checklist

1. `npm run build` passes (validates imports/types)
2. `npx vitest run` passes (validates logic)
3. Login works with confirmed credentials
4. Dashboard loads with test list and Run buttons
5. Running a test produces a toast and updates Recent runs
6. StepStatusBar renders colored segments in run results
7. Console shows runs in live feed with correct stats
8. Test detail page shows steps and run history
9. Schedules page loads with form elements
10. Seed demo project creates a new project with tests
