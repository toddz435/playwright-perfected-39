#!/usr/bin/env -S npx tsx
// testrify CLI — local auto-heal for exported Playwright tests.
//
//   npx tsx cli/testrify.ts heal <spec.ts>        (or: npm run heal -- <spec.ts>)
//
// Runs the spec with Playwright; on a locator failure it asks Claude (your ANTHROPIC_API_KEY) for a
// more resilient locator and rewrites the .spec.ts in place — so you push already-healed code to CI.
// Pure parsing/rewriting lives in src/lib/cli-heal.ts (unit-tested); this file is just the I/O.
import { execFileSync, spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  parsePlaywrightFailures,
  rewriteLocatorCall,
  isPlausibleLocator,
  pageUrlForLocator,
} from "../src/lib/cli-heal";
import { redactHtml } from "../src/lib/redact";
import { parseCodegen } from "../src/lib/codegen-parse";

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

// ─── record: local Codegen → upload to the Testrify cloud account ───────────────
//
// Recording runs LOCALLY (a real browser opens via `playwright codegen`); on close we parse the
// script with the same parseCodegen the app uses and insert a `tests` row into the user's cloud
// account over Supabase (RLS-scoped, so it lands under their ownership). No cloud browser needed —
// this is the local-record-then-cloud-run model (Playwright/Checkly/BrowserStack all do it).

const CONFIG_DIR = join(homedir(), ".testrify");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
// Public Supabase config (publishable key is safe to read from env); app URL for the printed link.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const APP_URL = process.env.TESTRIFY_APP_URL || "https://testrify.toddz-b03.workers.dev";

function loadConfig(): any {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveConfig(cfg: any): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  // `mode` applies when the file is CREATED, so the session is owner-only from the first byte —
  // no world-readable window between write and chmod. Re-chmod covers the already-exists case.
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    chmodSync(CONFIG_FILE, 0o600); // tokens are sensitive — owner-only (POSIX)
  } catch {
    /* best-effort */
  }
  // POSIX perms are a no-op on Windows — be honest that the session file isn't ACL-protected there.
  if (process.platform === "win32") {
    console.warn(
      `  ⚠ On Windows this session file isn't permission-locked — protect ${CONFIG_FILE}; it holds a live login.`,
    );
  }
}

function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => (rl.close(), res(a.trim()))));
}
// Hidden input for the password — echoes nothing, handles Enter/Backspace/Ctrl-C.
function promptHidden(q: string): Promise<string> {
  return new Promise((res) => {
    process.stdout.write(q);
    const stdin: any = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    let val = "";
    const onData = (ch: Buffer) => {
      const c = ch.toString("utf8");
      if (c === "\n" || c === "\r" || c === "\u0004") {
        stdin.setRawMode?.(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        res(val);
      } else if (c === "\u0003") {
        process.exit(1); // Ctrl-C
      } else if (c === "\u007f" || c === "\b") {
        val = val.slice(0, -1);
      } else {
        val += c;
      }
    };
    stdin.on("data", onData);
  });
}

function requireSupabaseEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      "✗ Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (e.g. load your .env). These are the public project keys.",
    );
    process.exit(1);
  }
}

async function login(): Promise<void> {
  requireSupabaseEnv();
  // TESTRIFY_EMAIL / TESTRIFY_PASSWORD are a non-interactive fallback for CI ONLY. Setting the
  // password inline (or in a committed .env) lands it in shell history + `ps` output — on a
  // workstation, leave them unset and use the hidden interactive prompt below.
  const email = process.env.TESTRIFY_EMAIL || (await prompt("Email: "));
  const password = process.env.TESTRIFY_PASSWORD || (await promptHidden("Password: "));
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error("✗ Login failed:", error?.message || "no session returned");
    process.exit(1);
  }
  saveConfig({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    email,
  });
  console.log(`✓ Logged in as ${email}. Session saved to ${CONFIG_FILE}`);
}

// Build an authenticated Supabase client from the saved session (refreshing if needed).
async function authedClient(): Promise<{ sb: any; userId: string }> {
  requireSupabaseEnv();
  const cfg = loadConfig();
  if (!cfg.access_token || !cfg.refresh_token) {
    console.error("✗ Not logged in. Run: testrify login");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.setSession({
    access_token: cfg.access_token,
    refresh_token: cfg.refresh_token,
  });
  if (error || !data.session) {
    console.error("✗ Session expired. Run: testrify login");
    process.exit(1);
  }
  if (data.session.access_token !== cfg.access_token) {
    saveConfig({
      ...cfg,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  }
  return { sb, userId: data.session.user.id };
}

// Generous backstop so a forgotten/abandoned recorder can't pin a headed browser forever. This is
// not a hard cap on real work — 30 min is far longer than a normal recording.
const RECORD_TIMEOUT_MS = 30 * 60 * 1000;

// Launch Playwright Codegen locally; resolve with the generated script when the user closes it.
// Ctrl-C kills the recorder cleanly (no orphaned browser, no partial upload); a 30-min timeout is
// a safety backstop.
function runCodegen(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outFile = join(tmpdir(), `testrify-codegen-${Date.now()}.spec.ts`);
    const bin = join(process.cwd(), "node_modules/.bin/playwright");
    const useLocal = existsSync(bin);
    const codegenArgs = [
      "codegen",
      "--target",
      "playwright-test",
      "--test-id-attribute",
      "data-testid",
      "-o",
      outFile,
      "--", // end of options: the URL is positional, never a flag
      url,
    ];
    const child = useLocal
      ? spawn(bin, codegenArgs, { stdio: "inherit" })
      : spawn("npx", ["playwright", ...codegenArgs], { stdio: "inherit" });

    let settled = false;
    let cancelled = false;
    const kill = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    };
    const onSigint = () => {
      cancelled = true; // Ctrl-C → abort, never upload a partial recording
      kill();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      kill();
      process.off("SIGINT", onSigint);
      reject(new Error("Recording timed out after 30 minutes."));
    }, RECORD_TIMEOUT_MS);
    process.on("SIGINT", onSigint);
    const cleanup = () => {
      clearTimeout(timer);
      process.off("SIGINT", onSigint);
    };

    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Couldn't launch the recorder (${e.message}). Is Playwright installed?`));
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (cancelled) {
        try {
          unlinkSync(outFile);
        } catch {
          /* best-effort */
        }
        reject(new Error("Recording cancelled."));
        return;
      }
      try {
        const s = readFileSync(outFile, "utf8");
        try {
          unlinkSync(outFile);
        } catch {
          /* temp file cleanup is best-effort */
        }
        resolve(s);
      } catch {
        reject(new Error("No script captured — did the recording have any actions?"));
      }
    });
  });
}

async function record(url: string, name?: string): Promise<void> {
  // (URL is validated position-independently by the dispatch before we get here.)
  const { sb, userId } = await authedClient();
  const { data: projects, error: pErr } = await sb
    .from("projects")
    .select("id,name")
    .order("created_at", { ascending: true });
  if (pErr) {
    console.error("✗ Couldn't load your projects:", pErr.message);
    process.exit(1);
  }
  if (!projects?.length) {
    console.error("✗ No projects yet — create one in Testrify first, then re-run.");
    process.exit(1);
  }
  const project = projects[0]; // MVP: first project (a --project flag can come later)
  console.log(
    `Recording → project "${project.name}". A browser will open — click through your flow, then close the window.\n`,
  );

  const script = await runCodegen(url);
  const parsed = parseCodegen(script);
  if (!parsed.steps.length) {
    console.error("✗ No runnable steps found in the recording.");
    process.exit(1);
  }

  // A recording can outlive the access token. Refresh right before the insert so a long session
  // doesn't lose the upload to an expired token (and persist the rotated refresh token).
  const { data: refreshed, error: rErr } = await sb.auth.refreshSession();
  if (rErr || !refreshed.session) {
    console.error("✗ Session expired during recording. Run: testrify login");
    process.exit(1);
  }
  saveConfig({
    ...loadConfig(),
    access_token: refreshed.session.access_token,
    refresh_token: refreshed.session.refresh_token,
  });

  const testName = name || `Recorded ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const spec = { name: testName, description: "Recorded via testrify CLI", steps: parsed.steps };
  const { data: inserted, error } = await sb
    .from("tests")
    .insert({
      project_id: project.id,
      owner_id: userId,
      name: testName,
      description: spec.description,
      type: "browser",
      spec,
    })
    .select("id")
    .single();
  if (error) {
    console.error("✗ Upload failed:", error.message);
    process.exit(1);
  }
  // Brittle css/xpath locators are saved as-is; the user hardens them in the app (the CLI doesn't
  // run the AI hardening pass the in-app recorder does). Be honest about that, don't imply auto-fix.
  const brittleNote = parsed.brittle.length
    ? ` (${parsed.brittle.length} brittle locator${parsed.brittle.length > 1 ? "s" : ""} — open it in Testrify to harden)`
    : "";
  console.log(`\n✓ Uploaded "${testName}" — ${parsed.steps.length} steps${brittleNote}.`);
  console.log(`  Open in Testrify:  ${APP_URL}/tests/${inserted.id}`);
}

// ─── command dispatch ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const [cmd, arg2] = argv;
const flagValue = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const die = (e: any) => {
  console.error("✗", e?.message || e);
  process.exit(1);
};

if (cmd === "heal" && arg2) {
  heal(arg2);
} else if (cmd === "login") {
  login().catch(die);
} else if (cmd === "record") {
  // URL can appear anywhere after `record` (e.g. `record --name "X" https://…` works).
  const url = argv.slice(1).find((a) => /^https?:\/\//i.test(a));
  if (!url) {
    console.error('✗ Provide an http(s) URL:  testrify record <url> [--name "..."]');
    process.exit(1);
  }
  record(url, flagValue("--name")).catch(die);
} else {
  console.log("testrify — local-first test tooling for Testrify\n");
  console.log(
    "Usage:\n" +
      "  testrify login                          Sign in to your Testrify cloud account\n" +
      '  testrify record <url> [--name "..."]    Record a flow locally → upload to your account\n' +
      "  testrify heal <spec.ts>                 Auto-heal locators in an exported Playwright spec\n",
  );
  console.log("Env: SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (login/record), ANTHROPIC_API_KEY (heal).");
  process.exit(cmd ? 1 : 0);
}
