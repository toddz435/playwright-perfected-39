# Testrify

![Status](https://img.shields.io/badge/status-under%20active%20development-orange)
[![CI](https://github.com/toddz435/playwright-perfected-39/actions/workflows/ci.yml/badge.svg)](https://github.com/toddz435/playwright-perfected-39/actions/workflows/ci.yml)

AI-native test automation on a real Microsoft Playwright engine: when a step's locator
breaks, Testrify **auto-heals it and continues from that step** instead of failing the whole run.

## ⚠️ Status: under active development

This is a work in progress. The core engine and several subsystems work end-to-end; others
are planned. Expect rough edges and breaking changes.

**Working today**
- Real Playwright execution with **self-healing** locators (deterministic fallbacks → AI heal)
  that **continue from the failed step**; run-from-start or resume-from-failed
- In-app **recorder** (codegen) feeding a deterministic codegen → resilient-selector pipeline
- **Locator hardening** + `data-testid` advice
- **Variables** (`{{name}}`), including masked **secret** variables
- **Visual regression**: baseline / actual / diff with an image viewer, "update baseline",
  and capture retention
- **Test logic**: per-step conditions, **if/else** blocks, and **loops** (`repeat N` /
  `repeat while`) with hard safety caps
- Scheduling (24h-time cron) and run insights

**Planned**
- Reliability / performance (parallel runs, retries)
- In-app support chat
- Data-driven testing (dataset → run-per-row)
- Load testing (protocol-level, behind an ownership/consent gate)

## Tech

TanStack Start (React 19) · Vite · Cloudflare Workers · Supabase (Postgres / Auth / Storage)
· Anthropic Claude · Playwright. The browser runner executes on a Node server (it can't run
inside the Cloudflare Worker).

## Develop

```bash
npm install
npm run dev   # http://localhost:8080
```

Requires a `.env` (gitignored) with the Supabase keys and `ANTHROPIC_API_KEY` — see
[.env.example](.env.example).

```bash
npm test            # unit tests (vitest)
npx tsc --noEmit    # typecheck
```

CI runs the typecheck + unit tests on every pull request.
