import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { runBrowserSteps } from "@/lib/playwright-runner";
import type { StepResult } from "@/lib/step-executor";

export const Route = createFileRoute("/api/protected/run-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let sb: ReturnType<typeof createClient> | undefined;
        let runId: string | undefined;
        try {
          const { userId, token } = await requireUser(request);
          const { testId, resumeFromStep } = await request.json();
          if (!testId) return json({ error: "testId required" }, { status: 400 });

          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
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
          const startIdx = Math.max(0, Number(resumeFromStep) || 0);
          const isApi = test.type === "api";
          const items = (isApi ? test.spec?.requests : test.spec?.steps) ?? [];

          // Insert a "running" run up front so the UI can stream live progress.
          // Each step is seeded as queued/skipped, then patched as it executes.
          const initialSteps = (items as any[]).map((it, i) => ({
            idx: i,
            name: it.name,
            action: it.action,
            target: it.target ?? it.url,
            value: it.value,
            status: i < startIdx ? "skipped" : "queued",
            duration_ms: 0,
          }));
          const { data: created, error: cErr } = await sb
            .from("runs")
            .insert({
              test_id: testId,
              owner_id: userId,
              status: "running",
              started_at: startedAt,
              steps: initialSteps,
              summary: {
                type: test.type,
                total: initialSteps.length,
                passed: 0,
                failed: 0,
                resumed_from: startIdx || undefined,
              },
            })
            .select()
            .single();
          if (cErr || !created)
            return json({ error: cErr?.message || "Could not create run" }, { status: 500 });
          runId = created.id as string;

          // Persist a step snapshot to the running run row (drives the live view).
          const persistSteps = async (steps: any[]) => {
            await sb!.from("runs").update({ steps }).eq("id", runId!);
          };

          const stepResults: any[] = [];
          let status: "passed" | "failed" = "passed";

          if (isApi) {
            const requests = (test.spec?.requests || []) as any[];
            for (let i = 0; i < requests.length; i++) {
              if (i < startIdx) {
                stepResults.push({ idx: i, status: "skipped", name: requests[i].name });
                continue;
              }
              stepResults.push({
                idx: i,
                name: requests[i].name,
                status: "running",
                duration_ms: 0,
              });
              await persistSteps([...stepResults, ...initialSteps.slice(stepResults.length)]);
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
                stepResults[i] = {
                  idx: i,
                  name: req.name,
                  status: stepOk ? "passed" : "failed",
                  duration_ms: elapsed,
                  http_status: res.status,
                  checks,
                };
                await persistSteps([...stepResults, ...initialSteps.slice(stepResults.length)]);
                if (!stepOk) {
                  status = "failed";
                  break;
                }
              } catch (e: any) {
                stepResults[i] = {
                  idx: i,
                  name: req.name,
                  status: "failed",
                  error: e?.message || "Network error",
                };
                await persistSteps([...stepResults, ...initialSteps.slice(stepResults.length)]);
                status = "failed";
                break;
              }
            }
          } else {
            // Browser: real Playwright execution with hot-restart support + live streaming.
            const steps = (test.spec?.steps || []) as any[];
            const result = await runBrowserSteps(steps, {
              startIdx,
              screenshotOnFailure: true,
              screenshotEveryStep: false,
              headless: true,
              onProgress: (live: StepResult[]) => persistSteps(live),
            });
            status = result.status;
            stepResults.push(...result.stepResults);
          }

          const finishedAt = new Date().toISOString();
          const duration = Date.now() - t0;
          const { data: run, error: rErr } = await sb
            .from("runs")
            .update({
              status,
              finished_at: finishedAt,
              duration_ms: duration,
              steps: stepResults,
              summary: {
                type: test.type,
                total: stepResults.length,
                passed: stepResults.filter((s) => s.status === "passed").length,
                failed: stepResults.filter((s) => s.status === "failed").length,
                resumed_from: startIdx || undefined,
              },
            })
            .eq("id", runId)
            .select()
            .single();
          if (rErr) return json({ error: rErr.message }, { status: 500 });
          return json({ run });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          // Best-effort: flip the run to "error" so the live view stops spinning.
          if (sb && runId) {
            await sb
              .from("runs")
              .update({ status: "error", finished_at: new Date().toISOString() })
              .eq("id", runId)
              .then(
                () => {},
                () => {},
              );
          }
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
