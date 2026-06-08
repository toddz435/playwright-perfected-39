import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft,
  Play,
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
  Wand2,
  ChevronRight,
  Clock,
  Circle,
  SkipForward,
  RotateCcw,
  Camera,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/tests/$testId")({
  head: () => ({ meta: [{ title: "Test — Testrify" }] }),
  component: TestDetail,
});

type LiveStep = {
  idx: number;
  name?: string;
  action?: string;
  target?: string;
  value?: string;
  status: "queued" | "running" | "passed" | "failed" | "skipped";
  duration_ms?: number;
  error?: string;
  screenshot?: string;
  http_status?: number;
  resolvedTarget?: string;
};

function TestDetail() {
  const { testId } = Route.useParams();
  const [test, setTest] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [healing, setHealing] = useState<number | null>(null);
  const [healed, setHealed] = useState<Record<number, any>>({});
  const [analysis, setAnalysis] = useState<{ runId: string; text: string } | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [liveRun, setLiveRun] = useState<any>(null);
  const pollRef = useRef<number | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  const refresh = async () => {
    const { data: t } = await supabase.from("tests").select("*").eq("id", testId).single();
    setTest(t);
    const { data: rs } = await supabase
      .from("runs")
      .select("*")
      .eq("test_id", testId)
      .order("created_at", { ascending: false })
      .limit(20);
    setRuns(rs || []);
    setLoading(false);
  };
  useEffect(() => {
    refresh();
  }, [testId]); // eslint-disable-line
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  const run = async (resumeFromStep?: number) => {
    setRunning(true);
    setLiveRun(null);
    setAnalysis(null);
    const startTs = Date.now();
    if (pollRef.current) clearInterval(pollRef.current);
    // Poll the latest run for this test so we can stream step-by-step progress
    // as the server drives Chromium against the target site.
    pollRef.current = window.setInterval(async () => {
      const { data } = await supabase
        .from("runs")
        .select("*")
        .eq("test_id", testId)
        .order("created_at", { ascending: false })
        .limit(1);
      const r = data?.[0];
      if (r && new Date(r.created_at).getTime() >= startTs - 3000) {
        setLiveRun(r);
        if (r.status !== "running" && r.status !== "queued" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    }, 600);
    try {
      const { run } = await apiCall<any>("/api/protected/run-test", { testId, resumeFromStep });
      setLiveRun(run);
      toast[run.status === "passed" ? "success" : "error"](`Run ${run.status}`);
      if (run.status === "failed") analyzeRun(run);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setRunning(false);
      refresh();
    }
  };

  const analyzeRun = async (r: any) => {
    setAnalysisBusy(true);
    setAnalysis({ runId: r.id, text: "" });
    try {
      const failed = (r.steps || []).find((s: any) => s.status === "failed");
      const { analysis } = await apiCall<any>("/api/protected/ai-analyze-failure", {
        test,
        failedStep: failed,
        error: failed?.error,
        allSteps: r.steps,
      });
      setAnalysis({ runId: r.id, text: analysis });
    } catch (e: any) {
      toast.error(e.message);
      setAnalysis(null);
    }
    setAnalysisBusy(false);
  };

  const healStep = async (idx: number) => {
    const step = test.spec.steps[idx];
    setHealing(idx);
    try {
      const result = await apiCall<any>("/api/protected/ai-heal-selector", {
        selector: step.target,
        context: `Action: ${step.action}. Test: ${test.name}. ${step.value ? `Value: ${step.value}` : ""}`,
      });
      setHealed((h) => ({ ...h, [idx]: result }));
    } catch (e: any) {
      toast.error(e.message);
    }
    setHealing(null);
  };

  const applyHeal = async (idx: number): Promise<boolean> => {
    const result = healed[idx];
    if (!result) return false;
    const newSpec = { ...test.spec };
    newSpec.steps = newSpec.steps.map((s: any, i: number) =>
      i === idx ? { ...s, target: result.resilient } : s,
    );
    const { error } = await supabase.from("tests").update({ spec: newSpec }).eq("id", testId);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success("Selector healed");
    setHealed((h) => {
      const { [idx]: _, ...rest } = h;
      return rest;
    });
    await refresh();
    return true;
  };

  // Heal-and-resume: apply the new locator, then resume the run from the failed step.
  const applyAndResume = async (idx: number) => {
    const ok = await applyHeal(idx);
    if (ok) run(idx);
  };

  if (loading)
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (!test) return <div className="p-12 text-center text-muted-foreground">Test not found.</div>;

  const isApi = test.type === "api";
  const items = isApi ? test.spec?.requests || [] : test.spec?.steps || [];
  const liveSteps: LiveStep[] = (liveRun?.steps || []) as LiveStep[];
  const livePassed = liveSteps.filter((s) => s.status === "passed").length;
  const liveFailedIdx = liveSteps.find((s) => s.status === "failed")?.idx;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <Link
          to="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>
        <div className="flex items-end justify-between gap-4 flex-wrap mt-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{test.name}</h1>
              <Badge variant="outline">{test.type}</Badge>
            </div>
            <p className="text-muted-foreground text-sm mt-1">{test.description}</p>
          </div>
          <Button
            disabled={running}
            onClick={() => run()}
            className="bg-gradient-primary border-0 shadow-glow"
          >
            {running ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}{" "}
            Run test
          </Button>
        </div>
      </div>

      {/* Live execution — streams each step as Testrify drives the target site */}
      {(running || liveRun) && (
        <section className="glass rounded-2xl p-6 shadow-card border border-primary/20">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-semibold flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${liveRun?.status === "running" || running ? "bg-primary animate-pulse" : liveRun?.status === "passed" ? "bg-success" : "bg-destructive"}`}
              />
              Live execution
              <span className="text-xs text-muted-foreground font-normal">
                {liveRun?.status === "running" || (running && !liveRun)
                  ? "Running…"
                  : liveRun?.status === "passed"
                    ? "Passed"
                    : liveRun?.status === "error"
                      ? "Errored"
                      : "Failed"}
                {liveSteps.length > 0 && ` · ${livePassed}/${liveSteps.length} passed`}
                {liveRun?.summary?.resumed_from
                  ? ` · resumed from step ${liveRun.summary.resumed_from + 1}`
                  : ""}
              </span>
            </h2>
            {!isApi && liveFailedIdx != null && !running && (
              <Button size="sm" variant="outline" onClick={() => run(liveFailedIdx)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Resume from step {liveFailedIdx + 1}
              </Button>
            )}
          </div>

          {/* Step map */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(liveSteps.length ? liveSteps : items).map((s: any, i: number) => {
              const st = liveSteps.length ? s.status : "queued";
              return (
                <div
                  key={i}
                  title={`${i + 1}. ${s.action || s.name} ${s.target || ""}`}
                  className={`h-2 flex-1 min-w-[10px] rounded-full transition-colors ${
                    st === "passed"
                      ? "bg-success"
                      : st === "failed"
                        ? "bg-destructive"
                        : st === "running"
                          ? "bg-primary animate-pulse"
                          : st === "skipped"
                            ? "bg-muted-foreground/30"
                            : "bg-muted"
                  }`}
                />
              );
            })}
          </div>

          <div className="space-y-2">
            {(liveSteps.length
              ? liveSteps
              : items.map((it: any, i: number) => ({ idx: i, ...it, status: "queued" }) as LiveStep)
            ).map((s: LiveStep, i: number) => {
              const idx = s.idx ?? i;
              const failed = s.status === "failed";
              const target = s.resolvedTarget || s.target;
              return (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 ${failed ? "border-destructive/40 bg-destructive/5" : "border-border bg-surface/40"}`}
                >
                  <div className="flex items-center gap-3 font-mono text-sm">
                    <StatusIcon status={s.status} />
                    <span className="text-xs text-muted-foreground w-6">{idx + 1}</span>
                    <Badge variant="secondary" className="text-xs">
                      {isApi
                        ? (s as any).http_status
                          ? `${(s as any).http_status}`
                          : s.name
                        : s.action}
                    </Badge>
                    <span className="flex-1 truncate">{isApi ? s.name : target}</span>
                    {s.resolvedTarget && s.resolvedTarget !== s.target && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-success border-success/40"
                      >
                        healed
                      </Badge>
                    )}
                    {!isApi && s.value && (
                      <span className="text-xs text-muted-foreground">"{s.value}"</span>
                    )}
                    {!!s.duration_ms && (
                      <span className="text-xs text-muted-foreground">{s.duration_ms}ms</span>
                    )}
                    {s.screenshot && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => setShot(s.screenshot!)}
                      >
                        <Camera className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {failed && (
                    <div className="mt-2 ml-9 space-y-2">
                      {s.error && (
                        <div className="text-xs text-destructive font-mono">{s.error}</div>
                      )}
                      {s.screenshot && (
                        <button onClick={() => setShot(s.screenshot!)} className="block">
                          <img
                            src={`data:image/png;base64,${s.screenshot}`}
                            alt="failure screenshot"
                            className="rounded-md border border-border max-h-48 hover:ring-2 hover:ring-primary/50"
                          />
                        </button>
                      )}
                      {!isApi && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={healing === idx}
                            onClick={() => healStep(idx)}
                          >
                            {healing === idx ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <Wand2 className="h-3.5 w-3.5 mr-1" />
                            )}{" "}
                            Heal locator
                          </Button>
                          {healed[idx] && (
                            <Button
                              size="sm"
                              className="bg-gradient-primary border-0"
                              disabled={running}
                              onClick={() => applyAndResume(idx)}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Apply &amp; resume from
                              here
                            </Button>
                          )}
                        </div>
                      )}
                      {healed[idx] && (
                        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                          <div className="text-xs text-primary-glow mb-1 flex items-center gap-1">
                            <Sparkles className="h-3 w-3" /> AI HEALED LOCATOR
                          </div>
                          <div className="font-mono text-xs mb-2">
                            <span className="text-muted-foreground line-through">{s.target}</span> →{" "}
                            <span className="text-success">{healed[idx].resilient}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {healed[idx].rationale}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Steps with inline healing */}
      <section className="glass rounded-2xl p-6 shadow-card">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <ChevronRight className="h-4 w-4" /> Steps ({items.length})
        </h2>
        <div className="space-y-2">
          {items.map((s: any, i: number) => (
            <div key={i} className="rounded-lg border border-border bg-surface/40 p-3">
              <div className="flex items-center gap-3 font-mono text-sm">
                <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
                <Badge variant="secondary" className="text-xs">
                  {isApi ? s.method : s.action}
                </Badge>
                <span className="flex-1 truncate">{isApi ? s.url : s.target}</span>
                {!isApi && s.value && (
                  <span className="text-xs text-muted-foreground">"{s.value}"</span>
                )}
                {!isApi && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={healing === i}
                    onClick={() => healStep(i)}
                  >
                    {healing === i ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Wand2 className="h-3.5 w-3.5 mr-1" /> Heal
                      </>
                    )}
                  </Button>
                )}
              </div>
              {!isApi && s.rationale && (
                <div className="text-xs text-muted-foreground mt-1 ml-9">{s.rationale}</div>
              )}
              {healed[i] && (
                <div className="mt-3 ml-9 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="text-xs text-primary-glow mb-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> AI HEALED LOCATOR
                  </div>
                  <div className="font-mono text-xs mb-2">
                    <span className="text-muted-foreground line-through">{s.target}</span> →{" "}
                    <span className="text-success">{healed[i].resilient}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">{healed[i].rationale}</div>
                  {healed[i].fallbacks?.length > 0 && (
                    <div className="text-xs text-muted-foreground mb-2">
                      Fallbacks:{" "}
                      {healed[i].fallbacks.map((f: string) => (
                        <code key={f} className="mx-1">
                          {f}
                        </code>
                      ))}
                    </div>
                  )}
                  <Button
                    size="sm"
                    className="bg-gradient-primary border-0"
                    onClick={() => applyHeal(i)}
                  >
                    Apply
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Run history */}
      <section>
        <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4" /> Run history
        </h2>
        {runs.length === 0 ? (
          <div className="text-sm text-muted-foreground glass rounded-xl p-6">No runs yet.</div>
        ) : (
          <div className="grid gap-3">
            {runs.map((r) => (
              <div key={r.id} className="glass rounded-xl p-4 shadow-card">
                <div className="flex items-center gap-3">
                  {r.status === "passed" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : r.status === "running" ? (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      {r.status === "passed"
                        ? "Passed"
                        : r.status === "running"
                          ? "Running…"
                          : "Failed"}{" "}
                      · {r.summary?.passed ?? 0}/{r.summary?.total ?? 0} steps
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.duration_ms}ms · {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                  {r.status === "failed" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const idx = (r.steps || []).findIndex((s: any) => s.status === "failed");
                          run(idx);
                        }}
                      >
                        <Play className="h-3.5 w-3.5 mr-1" /> Resume from failed
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => analyzeRun(r)}>
                        Analyze
                      </Button>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(r.steps || []).map((s: any, i: number) => (
                    <div
                      key={i}
                      title={`${s.action || s.name} ${s.target || ""}`}
                      className={`h-1.5 flex-1 min-w-[8px] rounded-full ${s.status === "passed" ? "bg-success" : s.status === "failed" ? "bg-destructive" : s.status === "skipped" ? "bg-muted-foreground/30" : s.status === "running" ? "bg-primary animate-pulse" : "bg-muted"}`}
                    />
                  ))}
                </div>
                {analysis?.runId === r.id && (
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="text-xs text-primary-glow mb-2 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> AI ROOT-CAUSE ANALYSIS
                    </div>
                    {analysisBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <div className="prose prose-sm prose-invert max-w-none text-sm">
                        <ReactMarkdown>{analysis?.text || ""}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Screenshot lightbox */}
      {shot && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
          onClick={() => setShot(null)}
        >
          <img
            src={`data:image/png;base64,${shot}`}
            alt="step screenshot"
            className="max-h-full max-w-full rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: LiveStep["status"] }) {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4 text-success shrink-0" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "running")
    return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />;
  if (status === "skipped")
    return <SkipForward className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
  return <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />;
}
