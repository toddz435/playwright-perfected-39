import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Play, Loader2, Sparkles, CheckCircle2, XCircle, Wand2, ChevronRight, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/tests/$testId")({
  head: () => ({ meta: [{ title: "Test — Testrify" }] }),
  component: TestDetail,
});

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

  const refresh = async () => {
    const { data: t } = await supabase.from("tests").select("*").eq("id", testId).single();
    setTest(t);
    const { data: rs } = await supabase.from("runs").select("*").eq("test_id", testId).order("created_at", { ascending: false }).limit(20);
    setRuns(rs || []);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [testId]); // eslint-disable-line

  const run = async (resumeFromStep?: number) => {
    setRunning(true);
    try {
      const { run } = await apiCall<any>("/api/protected/run-test", { testId, resumeFromStep });
      toast[run.status === "passed" ? "success" : "error"](`Run ${run.status}`);
      refresh();
      if (run.status === "failed") analyzeRun(run);
    } catch (e: any) { toast.error(e.message); }
    setRunning(false);
  };

  const analyzeRun = async (r: any) => {
    setAnalysisBusy(true); setAnalysis({ runId: r.id, text: "" });
    try {
      const failed = (r.steps || []).find((s: any) => s.status === "failed");
      const { analysis } = await apiCall<any>("/api/protected/ai-analyze-failure", {
        test, failedStep: failed, error: failed?.error, allSteps: r.steps,
      });
      setAnalysis({ runId: r.id, text: analysis });
    } catch (e: any) { toast.error(e.message); setAnalysis(null); }
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
    } catch (e: any) { toast.error(e.message); }
    setHealing(null);
  };

  const applyHeal = async (idx: number) => {
    const result = healed[idx];
    if (!result) return;
    const newSpec = { ...test.spec };
    newSpec.steps = newSpec.steps.map((s: any, i: number) => i === idx ? { ...s, target: result.resilient } : s);
    const { error } = await supabase.from("tests").update({ spec: newSpec }).eq("id", testId);
    if (error) return toast.error(error.message);
    toast.success("Selector healed");
    setHealed((h) => { const { [idx]: _, ...rest } = h; return rest; });
    refresh();
  };

  if (loading) return <div className="p-12 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!test) return <div className="p-12 text-center text-muted-foreground">Test not found.</div>;

  const isApi = test.type === "api";
  const items = isApi ? (test.spec?.requests || []) : (test.spec?.steps || []);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard</Link>
        <div className="flex items-end justify-between gap-4 flex-wrap mt-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{test.name}</h1>
              <Badge variant="outline">{test.type}</Badge>
            </div>
            <p className="text-muted-foreground text-sm mt-1">{test.description}</p>
          </div>
          <Button disabled={running} onClick={() => run()} className="bg-gradient-primary border-0 shadow-glow">
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />} Run test
          </Button>
        </div>
      </div>

      {/* Steps with inline healing */}
      <section className="glass rounded-2xl p-6 shadow-card">
        <h2 className="font-semibold mb-4 flex items-center gap-2"><ChevronRight className="h-4 w-4" /> Steps ({items.length})</h2>
        <div className="space-y-2">
          {items.map((s: any, i: number) => (
            <div key={i} className="rounded-lg border border-border bg-surface/40 p-3">
              <div className="flex items-center gap-3 font-mono text-sm">
                <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
                <Badge variant="secondary" className="text-xs">{isApi ? s.method : s.action}</Badge>
                <span className="flex-1 truncate">{isApi ? s.url : s.target}</span>
                {!isApi && s.value && <span className="text-xs text-muted-foreground">"{s.value}"</span>}
                {!isApi && (
                  <Button size="sm" variant="ghost" disabled={healing === i} onClick={() => healStep(i)}>
                    {healing === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Wand2 className="h-3.5 w-3.5 mr-1" /> Heal</>}
                  </Button>
                )}
              </div>
              {!isApi && s.rationale && <div className="text-xs text-muted-foreground mt-1 ml-9">{s.rationale}</div>}
              {healed[i] && (
                <div className="mt-3 ml-9 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="text-xs text-primary-glow mb-1 flex items-center gap-1"><Sparkles className="h-3 w-3" /> AI HEALED LOCATOR</div>
                  <div className="font-mono text-xs mb-2"><span className="text-muted-foreground line-through">{s.target}</span> → <span className="text-success">{healed[i].resilient}</span></div>
                  <div className="text-xs text-muted-foreground mb-2">{healed[i].rationale}</div>
                  {healed[i].fallbacks?.length > 0 && (
                    <div className="text-xs text-muted-foreground mb-2">Fallbacks: {healed[i].fallbacks.map((f: string) => <code key={f} className="mx-1">{f}</code>)}</div>
                  )}
                  <Button size="sm" className="bg-gradient-primary border-0" onClick={() => applyHeal(i)}>Apply</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Run history */}
      <section>
        <h2 className="font-semibold text-lg mb-3 flex items-center gap-2"><Clock className="h-4 w-4" /> Run history</h2>
        {runs.length === 0 ? (
          <div className="text-sm text-muted-foreground glass rounded-xl p-6">No runs yet.</div>
        ) : (
          <div className="grid gap-3">
            {runs.map((r) => (
              <div key={r.id} className="glass rounded-xl p-4 shadow-card">
                <div className="flex items-center gap-3">
                  {r.status === "passed" ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-destructive" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{r.status === "passed" ? "Passed" : "Failed"} · {r.summary?.passed ?? 0}/{r.summary?.total ?? 0} steps</div>
                    <div className="text-xs text-muted-foreground">{r.duration_ms}ms · {new Date(r.created_at).toLocaleString()}</div>
                  </div>
                  {r.status === "failed" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => {
                        const idx = (r.steps || []).findIndex((s: any) => s.status === "failed");
                        run(idx);
                      }}>
                        <Play className="h-3.5 w-3.5 mr-1" /> Resume from failed
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => analyzeRun(r)}>Analyze</Button>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(r.steps || []).map((s: any, i: number) => (
                    <div key={i} title={`${s.action || s.name} ${s.target || ""}`}
                      className={`h-1.5 flex-1 min-w-[8px] rounded-full ${s.status === "passed" ? "bg-success" : s.status === "failed" ? "bg-destructive" : s.status === "skipped" ? "bg-muted-foreground/30" : "bg-muted"}`} />
                  ))}
                </div>
                {analysis?.runId === r.id && (
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="text-xs text-primary-glow mb-2 flex items-center gap-1"><Sparkles className="h-3 w-3" /> AI ROOT-CAUSE ANALYSIS</div>
                    {analysisBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                      <div className="prose prose-sm prose-invert max-w-none text-sm"><ReactMarkdown>{analysis.text}</ReactMarkdown></div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
