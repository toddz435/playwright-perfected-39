# testrify CLI — for power users & internal sites

Most Testrify users never need this: recording, running and watching tests all happen in the
browser, with nothing to install. The CLI is for when the site you test **isn't reachable from
the internet**, or you want Testrify in your own terminal and CI. It runs on *your* machine, so
it can reach anything you can.

**Use the CLI when you're testing:**

- an internal or staging site on your company network / VPN
- an app running on your own computer (`localhost`)
- anything the cloud browser refuses as a private address (the cloud's SSRF guard blocks
  private/internal addresses by design)
- exported specs in your repo that you want healed before you push to CI

## Commands

```bash
testrify login                                         # sign in to your Testrify account (once)
testrify record <url> [--name "..."] [--project "..."] # record locally → upload to your account
testrify heal <spec.ts>                                # auto-heal locators in an exported spec
```

From the repo you can run any of them with `npx tsx cli/testrify.ts <command> …` (no install —
`npx tsx` fetches `tsx` on first run), or `npm run heal -- <spec.ts>` for healing. For a global
`testrify` command, run `npm link` once in the repo. (A standalone published npm package —
bundled, no repo needed — comes with distribution.)

Env: `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` for `login` / `record`; `ANTHROPIC_API_KEY`
(your own key) for `heal`.

### `testrify record`

Opens a Chromium window **on your machine** (Playwright codegen). Click through the flow, close
the window, and the test is converted with the same pipeline as the in-app recorder (resilient
locators; recorded passwords become `{{secret}}` variables with the literal dropped), uploaded to
your account, and opened in the browser. `--project` picks the project by name or id (defaults
to your oldest project).

Recorded tests run in the cloud like any other — as long as the cloud can reach the site. For
internal-only sites, use **Export TS** in the app and run the spec on your machine or in your CI
with Playwright (or `testrify heal` to run it and fix broken locators).

### `testrify heal`

Run your exported Playwright tests locally and let Claude repair broken locators **before** you
push to CI.

```bash
export ANTHROPIC_API_KEY=sk-ant-…        # your own key (healing runs locally, on your machine)
npm run heal -- path/to/login.spec.ts
# equivalently:
npx tsx cli/testrify.ts heal path/to/login.spec.ts
```

What it does:

1. Runs the spec with Playwright (`playwright test <file> --reporter=json`).
2. For each locator that failed, captures the **redacted** HTML of the page it lives on (headless)
   and asks Claude for a more resilient Playwright locator grounded in the real DOM.
3. Rewrites the `.spec.ts` in place.
4. You re-run to verify, then commit the healed test.

## Notes

- **Heal is self-contained / local** — uses *your* `ANTHROPIC_API_KEY`; no Testrify account or
  cloud needed.
- **What `heal` sends to Anthropic** (to your own account): the failing locator, the Playwright
  error text, and the page's **redacted** HTML — *before it leaves your machine* (the same
  `redactHtml` the in-app healer uses), then truncated to ~14 KB.
  - **Redacted:** `<script>`/`<style>` bodies, every input `value=` and `<textarea>` content, and
    the query string / `data:` payload of `href`/`src` (where tokens hide).
  - **NOT redacted (by design):** visible **text** content — the healer needs it to suggest
    text/role locators, so a page that *renders* sensitive data as text will include it. Heal
    against test data, not real production PII.
- The HTML capture runs **headless** against whatever URL your test navigates to (localhost is
  fine) — no extra network exposure.
- The pure parsing/rewriting logic lives in [`src/lib/cli-heal.ts`](../src/lib/cli-heal.ts) and is
  unit-tested in CI.
- `tsx` is also listed in `devDependencies`, so after a `npm install`/`bun install` it runs from
  the local copy (faster, offline) — but it's not required.
