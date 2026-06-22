#!/usr/bin/env -S npx tsx
// testrify CLI — local auto-heal for exported Playwright tests.
//
//   npx tsx cli/testrify.ts heal <spec.ts>        (or: npm run heal -- <spec.ts>)
//
// Runs the spec with Playwright; on a locator failure it asks Claude (your ANTHROPIC_API_KEY) for a
// more resilient locator and rewrites the .spec.ts in place — so you push already-healed code to CI.
// Pure parsing/rewriting lives in src/lib/cli-heal.ts (unit-tested); this file is just the I/O.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import {
  parsePlaywrightFailures,
  rewriteLocatorCall,
  isPlausibleLocator,
  pageUrlForLocator,
} from "../src/lib/cli-heal";
import { redactHtml } from "../src/lib/redact";

const MAX_HTML = 14_000; // bound the prompt (same cap as the in-app healer)

// Capture a page's HTML for a DOM-grounded heal — SECURITY: the HTML is redacted (the SAME
// redactHtml the in-app healer uses: scripts/styles dropped, all input values neutralized) and
// truncated BEFORE it leaves the machine. Headless, time-bounded, browser always closed.
// Best-effort: returns null on any failure so we fall back to a blind heal.
async function captureHtml(url: string): Promise<string | null> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { timeout: 15_000, waitUntil: "domcontentloaded" });
    const redacted = redactHtml(await page.content());
    return redacted.length > MAX_HTML ? redacted.slice(0, MAX_HTML) : redacted;
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

// Parse a Playwright JSON report, tolerating leading stdout noise by falling back to the text
// between the outermost braces. Returns null if nothing parses.
function parseReportLoose(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {
      /* ignore */
    }
  }
  return null;
}

// Ask Claude for a resilient Playwright locator EXPRESSION to replace a failing one. Returns the
// bare expression (no `await`, no `page.`) so it slots straight into the existing `page.` call.
// When `html` (already redacted) is provided, the model picks a locator grounded in the real DOM.
async function healLocator(
  locator: string,
  errorMsg: string,
  html?: string | null,
): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("  ✗ ANTHROPIC_API_KEY is not set — can't heal. Export it and re-run.");
    return null;
  }
  const userContent =
    `Failing locator: ${locator}\n\nError:\n${errorMsg.slice(0, 1500)}` +
    (html ? `\n\nCurrent page HTML (redacted, possibly truncated):\n${html}` : "");
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system:
          "You are a Playwright locator expert. A locator in a test no longer matches its element. " +
          "Propose ONE more resilient Playwright locator expression to use in its place — e.g. " +
          "getByRole('button', { name: 'Save' }), getByLabel('Email'), getByTestId('submit'), " +
          "getByText('Welcome'), or locator('css'). When page HTML is provided, choose a locator " +
          "that UNIQUELY matches the element the test intended, preferring stable handles " +
          "(role+name, label, test id, text) over brittle css/nth-child. " +
          "Return ONLY the expression: no `await`, no leading `page.`, no markdown, no explanation.",
        messages: [{ role: "user", content: userContent }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.error(`  ✗ heal API error ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim()
      .replace(/^`+|`+$/g, "") // strip stray backticks
      .replace(/^await\s+/, "")
      .replace(/^page\./, "")
      .trim();
    // Never splice a non-locator/garbage response into the user's source file.
    return isPlausibleLocator(text) ? text : null;
  } catch (e: any) {
    console.error("  ✗ heal failed:", e?.message || e);
    return null;
  }
}

async function heal(file: string) {
  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  console.log(`▶ Running ${file} …`);
  let reportJson = "";
  try {
    reportJson = execFileSync("npx", ["playwright", "test", file, "--reporter=json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e: any) {
    // `playwright test` exits non-zero on failure but still writes the JSON report to stdout.
    reportJson = e?.stdout?.toString() || "";
  }
  // Tolerate leading stdout noise (a warning line before the JSON) by falling back to the
  // outermost braces.
  const report = parseReportLoose(reportJson);
  if (!report) {
    console.error("Could not parse the Playwright report. Is @playwright/test installed?");
    process.exit(1);
  }

  const failures = parsePlaywrightFailures(report);
  if (!failures.length) {
    console.log("✓ All passed — nothing to heal.");
    return;
  }
  console.log(`Found ${failures.length} failure(s); attempting to heal locators…\n`);

  const seen = new Map<string, string>(); // locator → error (first seen)
  for (const f of failures) if (f.locator && !seen.has(f.locator)) seen.set(f.locator, f.message);

  let src = readFileSync(file, "utf8");
  const lookupSrc = src; // immutable snapshot for resolving each locator's page URL
  let healed = 0;
  for (const [loc, msg] of seen) {
    // Slice 3b: capture the (redacted) HTML of the page this locator lives on for a sharper,
    // DOM-grounded heal. Falls back to a blind heal if the page URL can't be resolved/reached.
    const url = pageUrlForLocator(lookupSrc, loc);
    const html = url ? await captureHtml(url) : null;
    if (html) console.log(`  · grounding "${loc}" on ${url}`);
    const fix = await healLocator(loc, msg, html);
    if (!fix || fix === loc) {
      console.log(`  • ${loc} → (no change)`);
      continue;
    }
    const { source, count } = rewriteLocatorCall(src, loc, fix);
    if (count) {
      src = source;
      healed += count;
      console.log(`  ✦ ${loc}\n      → ${fix}   (${count}×)`);
    } else {
      console.log(`  • ${loc} → ${fix}  (couldn't locate it in the source to rewrite)`);
    }
  }

  if (healed) {
    writeFileSync(file, src);
    console.log(`\nHealed ${healed} locator(s) in ${file}. Re-run to verify, then commit.`);
  } else {
    console.log("\nNo locators could be healed automatically.");
  }
}

const [cmd, file] = process.argv.slice(2);
if (cmd === "heal" && file) {
  heal(file);
} else {
  console.log("testrify — local auto-heal for exported Playwright tests\n");
  console.log("Usage:\n  npx tsx cli/testrify.ts heal <spec.ts>\n  npm run heal -- <spec.ts>\n");
  console.log("Requires ANTHROPIC_API_KEY in your environment.");
  process.exit(cmd ? 1 : 0);
}
