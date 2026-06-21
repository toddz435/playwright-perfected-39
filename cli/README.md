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

What it does:

1. Runs the spec with Playwright (`playwright test <file> --reporter=json`).
2. For each locator that failed, asks Claude for a more resilient Playwright locator.
3. Rewrites the `.spec.ts` in place.
4. You re-run to verify, then commit the healed test.

## Notes

- **Self-contained / local** — uses *your* `ANTHROPIC_API_KEY`; no Testrify account or cloud needed.
- **What's sent to Anthropic:** the failing locator expression + the Playwright error text (which may include expected/received values) — to your own Anthropic account. The page HTML is *not* sent in v1.
- The pure parsing/rewriting logic lives in [`src/lib/cli-heal.ts`](../src/lib/cli-heal.ts) and is unit-tested in CI.
- **v1 heals from the locator + error text.** HTML-grounded healing (sharper fixes from the live DOM at the failure point) is the planned next slice.
- `tsx` is also listed in `devDependencies`, so after a `npm install`/`bun install` it runs from the local copy (faster, offline) — but it's not required.
