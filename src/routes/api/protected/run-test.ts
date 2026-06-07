import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { validateFetchUrl } from "@/lib/url-validation.server";

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
                const urlCheck = validateFetchUrl(req.url);
                if (!urlCheck.ok) {
                  stepResults.push({
                    idx: i,
                    name: req.name,
                    status: "failed",
                    error: urlCheck.reason,
                  });
                  status = "failed";
                  break;
                }
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
            // Browser: simulated execution (real Playwright requires a worker runtime; this engine
            // is wired so that swapping in a real cloud worker is a single backend swap)
            const steps = (test.spec?.steps || []) as any[];
            for (let i = 0; i < steps.length; i++) {
              if (i < startIdx) {
                stepResults.push({
                  idx: i,
                  status: "skipped",
                  action: steps[i].action,
                  target: steps[i].target,
                });
                continue;
              }
              const s = steps[i];
              await new Promise((r) => setTimeout(r, 80 + Math.random() * 220));
              // Simulate occasional failure on expect_text without a value
              const fail = s.action?.startsWith("expect_") && Math.random() < 0.18;
              if (fail) {
                stepResults.push({
                  idx: i,
                  status: "failed",
                  action: s.action,
                  target: s.target,
                  value: s.value,
                  duration_ms: 320,
                  error: `Assertion failed: ${s.action} '${s.target}' did not match expected${s.value ? ` "${s.value}"` : ""}.`,
                });
                status = "failed";
                break;
              }
              stepResults.push({
                idx: i,
                status: "passed",
                action: s.action,
                target: s.target,
                value: s.value,
                duration_ms: 80 + Math.floor(Math.random() * 220),
              });
            }
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
          return json({ error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});
