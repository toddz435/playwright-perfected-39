# Testrify roadmap

Where the product is going beyond record→heal→harden. Grouped into subsystems with the
honest engineering realities and the security gates that apply to each.

## Subsystems

1. **Recording loop** — launch a recorder on a URL, capture clicks as steps, review the
   script, save it as a replayable test.
2. **Rich test logic** — assertions, variables (`{{var}}`), conditionals, loops, groups.
3. **Reliability & performance** — never stop mid-run (heal/continue, fallbacks, retries),
   parallel execution, fast headless runs.
4. **Visual regression** — baseline screenshots + pixel-diff on replay, with a diff viewer.
5. **Load / performance testing** — protocol-level load (concurrency, latency percentiles,
   throughput). NOT browser-based.
6. **Data-Driven Testing (DDT)** — drive a test from a dataset (CSV/sheet), one run per row.
7. **Support chat** — in-app help (Claude-backed).
8. **Security** — cross-cutting; see gates below.

## Hard realities (don't pretend these are free)

- **Recording can't be embedded in the web page.** Third-party sites block being framed
  (CSP / X-Frame-Options), and Playwright's recorder is its own Chromium + Inspector. The
  achievable approach: the Node runner spawns `playwright codegen <url>`, the user records
  in the popped browser, and on close we parse the generated script (reusing
  `src/lib/codegen-parse.ts`) into a replayable spec. **Local/Node-runner only** — not the
  Cloudflare Worker. Reinforces the "local/desktop runner + cloud orchestration" split.
- **Load testing is a different discipline AND an abuse vector.** Browsers are too heavy to
  simulate many users; load testing is protocol-level (k6/autocannon-style). Load-testing an
  arbitrary third-party site is effectively a DoS. **Gate:** only targets the user can prove
  they own/control, explicit consent, hard caps on concurrency/duration, and audit logging.
- **Conditionals/loops** require evolving the spec from a flat step list into a small
  control-flow model the engine interprets; pairs with **variables** (which also unlock DDT).
- **Visual regression** is straightforward with Playwright screenshots + a stored baseline
  (Supabase Storage) + pixel diff + threshold.

## Sequence (value × dependency × risk)

1. **In-app recorder** (spawn codegen → parse → save) ← starting here
2. **Step editor + assertions + variables**
3. **Visual regression**
4. **Conditionals & loops**
5. **Reliability/perf hardening** (parallel runs, per-step retries, run budgets)
6. **Support chat** (Claude-backed)
7. **Load testing** (protocol-level, behind the ownership gate)
8. **DDT** (dataset → run-per-row)

## Security gates (apply continuously)

- **Recording / DOM capture** → reuse `redactHtml`/`redactValues`; never log raw credentials.
- **Server-side URL handling** (codegen launch, API-test fetch) → validate scheme, consider
  SSRF for any *server-side fetch* of user URLs.
- **Screenshots / artifacts** → access-controlled storage scoped to the owner (RLS).
- **Load testing** → ownership verification + consent + concurrency/duration caps (above).
- **Secrets** → already: `.env` ignored, anon key behind RLS, no service-role in the repo.

### Recorder hardening still owed before a cloud runner
The in-app recorder (`record-codegen`) is gated to authenticated users and kills its
process group on timeout/disconnect, but these remain TODO before it runs anywhere but a
trusted local machine:
- **SSRF / private-IP block** on the recorded URL (currently allowed, because pointing at
  your own `localhost` is a legitimate local-recording use).
- **Per-user concurrency cap** (each recording spawns a headed browser + holds a request).
- **Secret variables** (done): a variable can be flagged secret — masked in the UI, stripped
  from run records, and scrubbed from anything sent to the LLM (heal + failure analysis) via
  `maskSecrets`. Still owed: (a) the value is stored in
  the test spec jsonb in plaintext — **encryption-at-rest** is a later item; (b) the recorder
  still emits literal `fill()` values — **auto-converting recorded passwords to `{{secret}}`**
  is not built yet. **Until those land, don't record real production credentials.**
