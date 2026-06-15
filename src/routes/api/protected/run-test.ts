import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { runBrowserSteps } from "@/lib/playwright-runner.server";
import { healSelector } from "@/lib/heal.server";

export const Route = createFileRoute("/api/protected/run-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const { testId, resumeFromStep } = await request.json();
          if (!testId) return json({ error: "testId required" }, { status: 400 });

          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: test, error: tErr } = await sb
            .from("tests")
            .select("*")
            .eq("id", testId)
            .single();
          if (tErr || !test) return json({ error: "Test not found" }, { status: 404 });

          const startedAt = new Date().toISOString();
          const t0 = Date.now();
          const stepResults: any[] = [];
          let status: "passed" | "failed" = "passed";
          const startIdx = Math.max(0, Number(resumeFromStep) || 0);

          if (test.type === "api") {
            const requests = (test.spec?.requests || []) as any[];
            for (let i = 0; i < requests.length; i++) {
              if (i < startIdx) {
                stepResults.push({ idx: i, status: "skipped", name: requests[i].name });
                continue;
              }
              const req = requests[i];
              const sStart = Date.now();
              try {
                const headers: Record<string, string> = { ...(req.headers || {}) };
                const res = await fetch(req.url, {
                  method: req.method,
                  headers,
                  body: req.body && req.method !== "GET" ? req.body : undefined,
                });
                const elapsed = Date.now() - sStart;
                const text = await res.text();
                const checks: any[] = [];
                let stepOk = true;
                for (const a of req.assertions || []) {
                  let ok = false;
                  let actual = "";
                  try {
                    if (a.kind === "status_eq") {
                      ok = res.status === Number(a.expected);
                      actual = String(res.status);
                    } else if (a.kind === "status_lt") {
                      ok = res.status < Number(a.expected);
                      actual = String(res.status);
                    } else if (a.kind === "time_lt_ms") {
                      ok = elapsed < Number(a.expected);
                      actual = `${elapsed}ms`;
                    } else if (a.kind === "body_contains") {
                      ok = text.includes(String(a.expected));
                      actual = ok ? "found" : "missing";
                    } else if (a.kind === "header_present") {
                      ok = !!res.headers.get(String(a.expected));
                      actual = ok ? "present" : "absent";
                    } else if (a.kind === "json_path_eq") {
                      const [path, expected] = String(a.expected).split("::");
                      const j = JSON.parse(text);
                      const v = path.split(".").reduce((o: any, k: string) => o?.[k], j);
                      ok = String(v) === expected;
                      actual = String(v);
                    }
                  } catch (e: any) {
                    ok = false;
                    actual = e?.message || "error";
                  }
                  if (!ok) stepOk = false;
                  checks.push({ ...a, ok, actual });
                }
                stepResults.push({
                  idx: i,
                  name: req.name,
                  status: stepOk ? "passed" : "failed",
                  duration_ms: elapsed,
                  http_status: res.status,
                  checks,
                });
                if (!stepOk) {
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
            // Browser: real Playwright execution (runs in-process on the Node server).
            // AI healing is on by default; it sends (redacted) page HTML to an external
            // LLM on a locator failure. Disable per test by setting spec.aiHealing = false,
            // in which case a broken locator simply fails the run as before.
            const steps = (test.spec?.steps || []) as any[];
            const aiHealing = test.spec?.aiHealing !== false;
            const result = await runBrowserSteps(steps, {
              startIdx,
              heal: aiHealing ? healSelector : undefined,
            });
            stepResults.push(...result.steps);
            if (result.status === "failed") status = "failed";
          }

          const finishedAt = new Date().toISOString();
          const duration = Date.now() - t0;
          const { data: run, error: rErr } = await sb
            .from("runs")
            .insert({
              test_id: testId,
              owner_id: userId,
              status,
              started_at: startedAt,
              finished_at: finishedAt,
              duration_ms: duration,
              steps: stepResults,
              summary: {
                type: test.type,
                total: stepResults.length,
                passed: stepResults.filter((s) => s.status === "passed").length,
                healed: stepResults.filter((s) => s.status === "healed").length,
                failed: stepResults.filter((s) => s.status === "failed").length,
              },
            })
            .select()
            .single();
          if (rErr) return json({ error: rErr.message }, { status: 500 });
          return json({ run });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
