// Server-only shared test runner used by BOTH the interactive route
// (api/protected/run-test) and the scheduled route (api/public/run-due-schedules), so
// their execution, assertions, healing, summary, and self-stabilization can't drift.
// Runs on the Node server only (Playwright isn't available in the Cloudflare Worker).
import {
  runBrowserSteps,
  DEFAULT_RUN_BUDGET_MS,
  type BrowserChoice,
} from "@/lib/playwright-runner.server";
import { healSelector } from "@/lib/heal.server";
import { applyRecoveries } from "@/lib/recovery";
import { interpolate, specVars, maskSecrets } from "@/lib/vars";
import { decryptSecret } from "@/lib/secrets.server";
import { assertPublicUrl } from "@/lib/ssrf.server";

// Allow private/internal fetch targets only on a trusted local machine (set in .env). Unset on
// shared/cloud runners → SSRF-protected. Read once at module load (env is set at boot).
const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === "true";
import { compareVisual, selectExpiredCaptures } from "@/lib/visual.server";
import type { SupabaseClient } from "@supabase/supabase-js";

// A screenshot step fails the run when more than this fraction of pixels differ.
const VISUAL_DIFF_THRESHOLD = 0.005; // 0.5%
// Keep only the most recent N runs' actual/diff captures per test (baselines are kept
// forever). Pruned after every run so the captures folder stays bounded.
const VISUAL_CAPTURE_RETENTION = 20;

// Delete capture images older than the retention window. Pure selection lives in
// visual.server.ts (unit-tested); this just does the Storage list/remove. Best-effort:
// never let housekeeping fail a run.
async function pruneCaptures(bucket: any, ownerId: string, testId: string) {
  const dir = `${ownerId}/${testId}/captures`;
  // Steady-state this folder stays small (retention runs every run), so one page of 1000
  // newest-first entries is plenty; a pre-retention backlog larger than that drains over
  // subsequent runs as newer captures push older ones out of the window.
  const { data, error } = await bucket.list(dir, {
    limit: 1000,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error || !data?.length) return;
  const expired = selectExpiredCaptures(
    data.map((o: any) => o.name),
    VISUAL_CAPTURE_RETENTION,
  );
  if (expired.length) await bucket.remove(expired.map((n) => `${dir}/${n}`));
}

// For each `screenshot` step result (carrying a base64 capture), compare against the stored
// baseline in Storage (or create it on first run), upload actual/diff images, and write
// references + verdict onto the step. Degrades gracefully if Storage isn't set up yet.
async function runVisualDiffs(
  sb: SupabaseClient,
  ownerId: string,
  testId: string,
  steps: any[],
): Promise<boolean> {
  const shots = steps.filter((s) => s.action === "screenshot" && s.screenshot);
  if (!shots.length) return false;
  const pngBlob = (b: Buffer) => new Blob([new Uint8Array(b)], { type: "image/png" });
  const bucket = sb.storage.from("screenshots");
  const captureId = crypto.randomUUID();
  let anyFailed = false;

  // A null download means the baseline is missing OR the download errored transiently
  // (network / RLS / 5xx). Only the genuine "object not found" case may create a baseline;
  // anything else must NOT clobber a possibly-existing baseline.
  const isNotFound = (e: any) => {
    if (!e) return true; // no error AND no data → treat as missing
    const code = String(e.statusCode ?? e.status ?? e.originalError?.status ?? "");
    const msg = (e.message || "").toLowerCase();
    return code === "404" || msg.includes("not found") || msg.includes("does not exist");
  };

  for (const step of shots) {
    const actual = Buffer.from(step.screenshot, "base64");
    delete step.screenshot; // never persist the raw base64 on the run record
    // Key the baseline by the step's stable id so reordering/inserting steps doesn't
    // re-point it at another screenshot's baseline. Legacy steps (no sid) fall back to
    // the positional index, preserving any baseline already created under that key.
    const baselineKey = step.sid ? `sid-${step.sid}` : `baseline-${step.idx}`;
    const baselinePath = `${ownerId}/${testId}/${baselineKey}.png`;
    try {
      const { data: dl, error: dlErr } = await bucket.download(baselinePath);
      if (!dl) {
        // Surface transient/permission failures as an error instead of silently
        // re-baselining against this run's (possibly broken) capture.
        if (!isNotFound(dlErr)) throw dlErr ?? new Error("baseline download failed");
        // upsert:false so a baseline that exists but failed to download is never
        // overwritten — the upload fails and we fall through to the catch.
        const up = await bucket.upload(baselinePath, pngBlob(actual), {
          contentType: "image/png",
          upsert: false,
        });
        if (up.error) throw up.error;
        step.visual = "baseline_created";
        step.baseline_path = baselinePath;
        continue;
      }
      const baseline = Buffer.from(await dl.arrayBuffer());
      const diff = await compareVisual(baseline, actual);
      // Decide the pass/fail verdict BEFORE any upload, so a later upload failure
      // can never downgrade a real regression to a benign "storage error".
      step.baseline_path = baselinePath;
      step.diff_ratio = diff.diffRatio;
      step.dims_match = diff.dimsMatch;
      if (diff.diffRatio > VISUAL_DIFF_THRESHOLD) {
        step.visual = "diff";
        step.status = "failed";
        step.error = diff.dimsMatch
          ? `Visual diff ${(diff.diffRatio * 100).toFixed(2)}%`
          : "Screenshot dimensions changed";
        anyFailed = true;
      } else {
        step.visual = "match";
      }
      // Best-effort: persist actual/diff images for the viewer. A failure here records
      // capture_error but must not change the verdict already set above.
      try {
        // Include the loop iteration (when present) so a screenshot inside a `repeat` block
        // doesn't overwrite earlier iterations' captures at the same path.
        const iterSuffix = step.iteration ? `-i${step.iteration}` : "";
        const base = `${ownerId}/${testId}/captures/${captureId}-${step.idx}${iterSuffix}`;
        await bucket.upload(`${base}-actual.png`, pngBlob(actual), {
          contentType: "image/png",
          upsert: true,
        });
        step.actual_path = `${base}-actual.png`;
        if (diff.diffPng) {
          await bucket.upload(`${base}-diff.png`, pngBlob(diff.diffPng), {
            contentType: "image/png",
            upsert: true,
          });
          step.diff_path = `${base}-diff.png`;
        }
        // Snapshot the baseline THIS run compared against, so viewing an old run shows the
        // baseline-at-the-time rather than the current (possibly since-updated) baseline. It's a
        // capture, so it prunes with the run under the same retention window. Uploaded LAST (it's
        // the most expendable image) so a snapshot hiccup can't cost us the actual/diff captures.
        await bucket.upload(`${base}-baseline.png`, pngBlob(baseline), {
          contentType: "image/png",
          upsert: true,
        });
        step.baseline_snapshot_path = `${base}-baseline.png`;
      } catch (e: any) {
        step.capture_error = e?.message || "capture upload failed";
      }
    } catch (e: any) {
      // Storage not configured / RLS / network — don't fail the run on infra; flag it.
      step.visual = "error";
      step.visual_error = e?.message || "screenshot storage unavailable";
    }
  }
  // Housekeeping: drop captures beyond the retention window. Never fail a run on this.
  try {
    await pruneCaptures(bucket, ownerId, testId);
  } catch (e: any) {
    console.error("capture prune failed:", e?.message || e);
  }
  return anyFailed;
}

// Accepts either the token-scoped (RLS) client or the service-role admin client.
type SupabaseClientLike = SupabaseClient;

export type ExecuteResult = { run: any; status: "passed" | "failed" };

// Evaluates one API request's assertions against a fetch Response. Single source of truth
// for the assertion kinds (status_eq/status_lt/time_lt_ms/body_contains/header_present/
// json_path_eq).
function checkAssertions(assertions: any[], res: Response, text: string, elapsed: number) {
  const checks: any[] = [];
  let ok = true;
  for (const a of assertions || []) {
    let pass = false;
    let actual = "";
    try {
      if (a.kind === "status_eq") {
        pass = res.status === Number(a.expected);
        actual = String(res.status);
      } else if (a.kind === "status_lt") {
        pass = res.status < Number(a.expected);
        actual = String(res.status);
      } else if (a.kind === "time_lt_ms") {
        pass = elapsed < Number(a.expected);
        actual = `${elapsed}ms`;
      } else if (a.kind === "body_contains") {
        pass = text.includes(String(a.expected));
        actual = pass ? "found" : "missing";
      } else if (a.kind === "header_present") {
        pass = !!res.headers.get(String(a.expected));
        actual = pass ? "present" : "absent";
      } else if (a.kind === "json_path_eq") {
        const [path, expected] = String(a.expected).split("::");
        const j = JSON.parse(text);
        const v = path.split(".").reduce((o: any, k: string) => o?.[k], j);
        pass = String(v) === expected;
        actual = String(v);
      }
    } catch (e: any) {
      pass = false;
      actual = e?.message || "error";
    }
    if (!pass) ok = false;
    checks.push({ ...a, ok: pass, actual });
  }
  return { ok, checks };
}

export async function executeTest(
  sb: SupabaseClientLike,
  test: any,
  ownerId: string,
  opts: {
    startIdx?: number;
    scheduled?: boolean;
    varsOverride?: Record<string, string>;
    noStabilize?: boolean;
    headless?: boolean; // false → headed "watch" run (local runner only)
    browser?: BrowserChoice;
  } = {},
): Promise<ExecuteResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const startIdx = Math.max(0, opts.startIdx ?? 0);
  const stepResults: any[] = [];
  let status: "passed" | "failed" = "passed";
  let stabilizedSteps: any[] | null = null;
  // Reliability: retry a failed browser run up to `retries` times (fresh browser each attempt);
  // pass if any attempt passes. Capped 0–3.
  const retries = Math.min(3, Math.max(0, Math.floor(Number(test.spec?.retries) || 0)));
  let attempts = 1;

  // Substitute {{variables}} into a working copy for execution. The ORIGINAL spec is kept
  // for self-stabilization persistence so {{vars}} stay in the saved test.
  // Secret values are encrypted at rest — decrypt them (server-side) before interpolation;
  // non-secret/legacy-plaintext values pass through decryptSecret unchanged.
  const vars = specVars(test.spec);
  const secretNames: string[] = Array.isArray(test.spec?.secrets) ? test.spec.secrets : [];
  for (const n of secretNames) {
    if (typeof vars[n] === "string") vars[n] = decryptSecret(vars[n]);
  }
  // Data-driven testing: a dataset row's columns override the static variables for this run, so
  // {{column}} resolves to that row's value. Apply BEFORE deriving the mask list so a row value
  // overriding a secret-named variable is still masked in run records / LLM payloads.
  if (opts.varsOverride) Object.assign(vars, opts.varsOverride);
  // Derive the concrete secret values from the FINAL vars (for run-record masking).
  const secrets = secretNames
    .map((n) => vars[n])
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  if (test.type === "api") {
    const requests = interpolate((test.spec?.requests || []) as any[], vars);
    for (let i = 0; i < requests.length; i++) {
      if (i < startIdx) {
        stepResults.push({ idx: i, status: "skipped", name: requests[i].name });
        continue;
      }
      const req = requests[i];
      const sStart = Date.now();
      try {
        // SSRF guard: this fetch hits a fully user-controlled URL server-side (and runs
        // unattended via the public scheduled-runs route), so block private/internal targets
        // unless explicitly allowed on a trusted local machine.
        await assertPublicUrl(req.url, ALLOW_PRIVATE_HOSTS);
        const res = await fetch(req.url, {
          method: req.method,
          headers: { ...(req.headers || {}) },
          body: req.body && req.method !== "GET" ? req.body : undefined,
        });
        const elapsed = Date.now() - sStart;
        const text = await res.text();
        const { ok, checks } = checkAssertions(req.assertions, res, text, elapsed);
        stepResults.push({
          idx: i,
          name: req.name,
          status: ok ? "passed" : "failed",
          duration_ms: elapsed,
          http_status: res.status,
          checks,
        });
        if (!ok) {
          status = "failed";
          break;
        }
      } catch (e: any) {
        stepResults.push({
          idx: i,
          name: req.name,
          status: "failed",
          error: e?.message || "Network error",
        });
        status = "failed";
        break;
      }
    }
  } else {
    // Browser: real Playwright execution. AI healing is on unless the test opts out via
    // spec.aiHealing = false (it sends redacted page HTML to the LLM on a locator failure).
    const steps = (test.spec?.steps || []) as any[]; // original (keeps {{vars}})
    const runSteps = interpolate(steps, vars); // substituted copy for this run
    const aiHealing = test.spec?.aiHealing !== false;
    // Mask secret values out of everything sent to the LLM healer (the substituted value,
    // the page HTML, and the selector) so secrets never leave for an external model.
    const heal = aiHealing
      ? (a: any) =>
          healSelector({
            selector: maskSecrets(a.selector, secrets),
            action: a.action,
            value: maskSecrets(a.value, secrets),
            html: maskSecrets(a.html, secrets),
          })
      : undefined;
    // Retry the whole run (fresh browser each attempt) up to `retries` times; keep the first
    // passing attempt, else the last. Self-heal/fallbacks still happen within each attempt.
    // The time budget is shared ACROSS attempts (a single deadline) so retries can't multiply
    // wall-clock / hold a run slot for budget × (retries+1).
    const runDeadline = Date.now() + DEFAULT_RUN_BUDGET_MS;
    const runOnce = () =>
      runBrowserSteps(runSteps, {
        startIdx,
        heal,
        headless: opts.headless,
        browser: opts.browser,
        maxRunMs: Math.max(0, runDeadline - Date.now()),
      });
    let result = await runOnce();
    for (let attempt = 2; result.status === "failed" && attempt <= retries + 1; attempt++) {
      attempts = attempt;
      result = await runOnce();
    }
    stepResults.push(...result.steps);
    if (result.status === "failed") status = "failed";
    // Visual regression: diff any screenshot steps against their stored baselines.
    const visualFailed = await runVisualDiffs(sb, ownerId, test.id, result.steps);
    if (visualFailed) status = "failed";
    // Recover against the ORIGINAL steps so persisted locators retain any {{vars}}.
    const { steps: stabilized, changed } = applyRecoveries(steps, result.steps);
    if (changed > 0) stabilizedSteps = stabilized;
  }

  // Mask secret-variable values so substituted secrets are never stored in the run record.
  const safeSteps = maskSecrets(stepResults, secrets);

  const { data: run, error: rErr } = await sb
    .from("runs")
    .insert({
      test_id: test.id,
      owner_id: ownerId,
      status,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      steps: safeSteps,
      summary: {
        type: test.type,
        total: safeSteps.length,
        passed: safeSteps.filter((s: any) => s.status === "passed").length,
        healed: safeSteps.filter((s: any) => s.status === "healed").length,
        failed: safeSteps.filter((s: any) => s.status === "failed").length,
        ...(attempts > 1 ? { attempts, maxAttempts: retries + 1 } : {}),
        ...(opts.scheduled ? { scheduled: true } : {}),
      },
    })
    .select()
    .single();
  if (rErr) throw new Error(rErr.message);

  // Persist self-stabilized locators AFTER the run is recorded; never let this lose the run.
  // Skipped for data-driven runs: many rows execute the SAME test in parallel, so concurrent
  // spec writes would clobber each other (last-write-wins). Stabilize via a normal single run.
  if (stabilizedSteps && !opts.noStabilize) {
    try {
      const { error: sErr } = await sb
        .from("tests")
        .update({ spec: { ...test.spec, steps: stabilizedSteps } })
        .eq("id", test.id);
      if (sErr) console.error("self-stabilize persist failed:", sErr.message);
    } catch (e: any) {
      console.error("self-stabilize persist threw:", e?.message || e);
    }
  }

  return { run, status };
}
