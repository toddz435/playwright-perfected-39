# Codegen → reliable, self-stabilizing selectors

Design for turning a recorded Playwright test into one whose locators are
**provably static** at record time and **self-healing** at replay time.

## Goal

Record a flow once → automatically produce stable locators that survive
refactors → on replay, fall back / heal when a locator drifts, and persist the
fix so the test gets *more* reliable over time.

## What already exists in the repo

- **Codegen page** (`src/routes/_authenticated/codegen.tsx`): paste a recorded
  Playwright script, get a "resilient" spec back, save it as a test.
- **`ai-codegen`** (`src/routes/api/protected/ai-codegen.ts`): LLM rewrites
  brittle CSS/XPath/dynamic-id locators into role/text/label/testid locators.
- **Real Playwright engine + runtime heal**
  (`src/lib/playwright-runner.server.ts`, `heal.server.ts`): executes steps;
  on a locator failure, asks Claude for a replacement and continues.

Three of the four legs of the pipeline exist. The new work is the locator
**resolver** (Phase A) and the record-time **snapshot + validation** (Phase C).

## The blocking gap (fixed in Phase A)

`ai-codegen` emits a custom locator DSL — `role:button[name=Submit]`,
`text:Sign in`, `testid:cart-total`. The engine runs `page.locator(target)`,
which only understands **CSS** and Playwright's native `text=`/`xpath=` syntax.
`page.locator('role:button[name=Submit]')` does **not** resolve, so a
Codegen-produced test fails on its first step — a format mismatch, not a
brittleness problem. This must be fixed before "make selectors reliable" work
has any value.

## Canonical locator model

One shape that Codegen output, the engine, and the healer all agree on:

```ts
type Locator =
  | { by: "testid"; value: string }
  | { by: "role"; role: string; name?: string }
  | { by: "label" | "placeholder" | "text"; value: string }
  | { by: "css" | "xpath"; value: string };
```

Engine resolution: `testid→getByTestId`, `role→getByRole(role,{name})`,
`label→getByLabel`, `placeholder→getByPlaceholder`, `text→getByText`,
`css/xpath→locator`. **Backward-compatible:** a legacy string `target` is
treated as `{ by: "css" }` (and still flows through `page.locator`, which also
accepts native `text=`/`xpath=`).

## Phases

### Phase A — Unified locator model + resolver (foundation)
Add the `Locator` type and a `resolveLocator(page, locOrString)` helper to the
engine; route all selector-based steps through it. Backward-compatible with
existing CSS-string tests. Also a latent-bug fix: makes Codegen output runnable.

### Phase B — Deterministic recording → spec
`playwright codegen` already prefers `getByRole`/`getByTestId`/`getByLabel`.
Parse those calls **directly** into the `Locator` model (no LLM for the
well-formed majority); send only leftover CSS/XPath to the LLM hardening pass.
Update `ai-codegen` to emit the structured model.

### Phase C — Record-time DOM snapshot + validation (the missing leg)
At record time, capture per step: the page's accessibility tree / target
subtree and the target element's attributes. A validation + ranking pass runs
each candidate locator against the captured DOM, keeping only those that
resolve to **exactly one** element that **is** the intended target. Rank by
stability:

> `testid` > `role`+`name` > `label` > `placeholder` > `text` > stable-attr CSS > structural/`nth-child`

Store the winner + 1–2 ranked fallbacks + a snapshot reference on the step.
This turns "looks resilient" into "provably resolves against the recorded page."

### Phase D — Replay with fallbacks + self-stabilization
Engine tries the primary locator → stored fallbacks (free, deterministic) →
then the LLM healer (live HTML). On a successful heal, **persist** the healed
locator back to the test (promote to primary, demote old to fallback). Tests
get more reliable each run. Record which locator actually resolved (telemetry)
to flag flaky ones.

### Phase E — `data-testid` advisor (optional, biggest lever)
When the app-under-test is owned, detect elements lacking stable handles and
suggest/inject `data-testid`s. Immune to layout/style churn. N/A for
third-party sites.

## Data-model evolution

`{ action, target: string, value }` →
`{ action, locator: Locator, fallbacks?: Locator[], value?, snapshotId? }`.
The resolver accepts both, so no breaking migration. Snapshots: store the
trimmed a11y tree (not full HTML), compressed, in run/test jsonb or a
`snapshots` table.

## Constraints

Recording, validation, and execution all need the Node runner — they run on the
Node dev/preview server, not inside the Cloudflare Worker. Production would use
a separate Node runner service (same constraint as the existing engine).
