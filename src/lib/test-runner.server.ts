// Server-only shared test runner used by BOTH the interactive route
// (api/protected/run-test) and the scheduled route (api/public/run-due-schedules), so
// their execution, assertions, healing, summary, and self-stabilization can't drift.
// Runs on the Node server only (Playwright isn't available in the Cloudflare Worker).
import { runBrowserSteps } from "@/lib/playwright-runner.server";
import { healSelector } from "@/lib/heal.server";
import { applyRecoveries } from "@/lib/recovery";
import { interpolate, specVars, secretValues, maskSecrets } from "@/lib/vars";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  opts: { startIdx?: number; scheduled?: boolean } = {},
): Promise<ExecuteResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const startIdx = Math.max(0, opts.startIdx ?? 0);
  const stepResults: any[] = [];
  let status: "passed" | "failed" = "passed";
  let stabilizedSteps: any[] | null = null;

  // Substitute {{variables}} into a working copy for execution. The ORIGINAL spec is kept
  // for self-stabilization persistence so {{vars}} stay in the saved test.
  const vars = specVars(test.spec);
  const secrets = secretValues(test.spec);

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
    const result = await runBrowserSteps(runSteps, { startIdx, heal });
    stepResults.push(...result.steps);
    if (result.status === "failed") status = "failed";
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
        ...(opts.scheduled ? { scheduled: true } : {}),
      },
    })
    .select()
    .single();
  if (rErr) throw new Error(rErr.message);

  // Persist self-stabilized locators AFTER the run is recorded; never let this lose the run.
  if (stabilizedSteps) {
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
