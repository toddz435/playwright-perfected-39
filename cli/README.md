# testrify CLI — local auto-heal

Run your exported Playwright tests locally and let Claude repair broken locators **before** you push to CI.

## Use

```bash
export ANTHROPIC_API_KEY=sk-ant-…        # your own key (healing runs locally, on your machine)
npm run heal -- path/to/login.spec.ts
# equivalently:
npx tsx cli/testrify.ts heal path/to/login.spec.ts
```

No install step needed — both commands use `npx tsx`, which fetches `tsx` on first run.

To get a global `testrify` command, run `npm link` once in the repo, then `testrify heal <spec.ts>` from anywhere. (A standalone published npm package — bundled, no repo needed — comes with distribution.)

What it does:

1. Runs the spec with Playwright (`playwright test <file> --reporter=json`).
2. For each locator that failed, captures the **redacted** HTML of the page it lives on (headless) and asks Claude for a more resilient Playwright locator grounded in the real DOM.
3. Rewrites the `.spec.ts` in place.
4. You re-run to verify, then commit the healed test.

## Notes

- **Self-contained / local** — uses *your* `ANTHROPIC_API_KEY`; no Testrify account or cloud needed.
- **What's sent to Anthropic** (to your own account): the failing locator, the Playwright error text, and the page's **redacted** HTML — *before it leaves your machine* (the same `redactHtml` the in-app healer uses), then truncated to ~14 KB.
  - **Redacted:** `<script>`/`<style>` bodies, every input `value=` and `<textarea>` content, and the query string / `data:` payload of `href`/`src` (where tokens hide).
  - **NOT redacted (by design):** visible **text** content — the healer needs it to suggest text/role locators, so a page that *renders* sensitive data as text will include it. Heal against test data, not real production PII.
- The HTML capture runs **headless** against whatever URL your test navigates to (localhost is fine) — no extra network exposure.
- The pure parsing/rewriting logic lives in [`src/lib/cli-heal.ts`](../src/lib/cli-heal.ts) and is unit-tested in CI.
- **v1 heals from the locator + error text.** HTML-grounded healing (sharper fixes from the live DOM at the failure point) is the planned next slice.
- `tsx` is also listed in `devDependencies`, so after a `npm install`/`bun install` it runs from the local copy (faster, offline) — but it's not required.
