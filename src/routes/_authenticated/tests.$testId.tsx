import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { locatorLabel } from "@/lib/locator";
import { toast } from "sonner";
import {
  ArrowLeft,
  Play,
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
  Wand2,
  ShieldCheck,
  Lightbulb,
  ChevronRight,
  Clock,
} from "lucide-react";
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
  const [hardening, setHardening] = useState(false);
  const [hardenReport, setHardenReport] = useState<any[] | null>(null);
  const [advising, setAdvising] = useState(false);
  const [advisories, setAdvisories] = useState<any[] | null>(null);

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

  const run = async (resumeFromStep?: number) => {
    setRunning(true);
    try {
      const { run } = await apiCall<any>("/api/protected/run-test", { testId, resumeFromStep });
      toast[run.status === "passed" ? "success" : "error"](`Run ${run.status}`);
      refresh();
      if (run.status === "failed") analyzeRun(run);
    } catch (e: any) {
      toast.error(e.message);
    }
    setRunning(false);
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
        selector: step.locator ? locatorLabel(step.locator) : step.target,
        context: `Action: ${step.action}. Test: ${test.name}. ${step.value ? `Value: ${step.value}` : ""}`,
      });
      setHealed((h) => ({ ...h, [idx]: result }));
    } catch (e: any) {
      toast.error(e.message);
    }
    setHealing(null);
  };

  const applyHeal = async (idx: number) => {
    const result = healed[idx];
    if (!result) return;
    const newSpec = { ...test.spec };
    // Write the healed selector as the legacy `target` string and clear any structured
    // `locator`, since the runner resolves `locator ?? target` — otherwise the heal is ignored.
    newSpec.steps = newSpec.steps.map((s: any, i: number) =>
      i === idx ? { ...s, target: result.resilient, locator: undefined } : s,
    );
    const { error } = await supabase.from("tests").update({ spec: newSpec }).eq("id", testId);
    if (error) return toast.error(error.message);
    toast.success("Selector healed");
    setHealed((h) => {
      const { [idx]: _, ...rest } = h;
      return rest;
    });
    refresh();
  };

  const adviseLocators = async () => {
    setAdvising(true);
    setAdvisories(null);
    try {
      const { advisories } = await apiCall<any>("/api/protected/advise-locators", { testId });
      setAdvisories(advisories);
      toast.success(
        advisories.length === 0
          ? "No brittle locators — every element has a stable handle 🎉"
          : `${advisories.length} element${advisories.length === 1 ? "" : "s"} could use a data-testid`,
      );
    } catch (e: any) {
      toast.error(e.message);
    }
    setAdvising(false);
  };

  const hardenLocators = async () => {
    setHardening(true);
    setHardenReport(null);
    try {
      const { report } = await apiCall<any>("/api/protected/harden-test", { testId });
      setHardenReport(report);
      const improved = (report || []).filter((r: any) => r.status === "improved").length;
      toast.success(`Hardened ${improved} locator${improved === 1 ? "" : "s"}`);
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
    setHardening(false);
  };

  const toggleHealing = async (on: boolean) => {
    const newSpec = { ...test.spec, aiHealing: on };
    const { error } = await supabase.from("tests").update({ spec: newSpec }).eq("id", testId);
    if (error) return toast.error(error.message);
    setTest((t: any) => ({ ...t, spec: newSpec }));
    toast.success(on ? "AI auto-heal enabled for this test" : "AI auto-heal disabled");
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
          <div className="flex items-center gap-4">
            {test.type === "browser" && (
              <label
                className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer"
                title="When on, a failed selector is sent (with sensitive data redacted) to the AI healer to recover it and continue the run."
              >
                <Wand2 className="h-3.5 w-3.5" />
                AI auto-heal
                <Switch checked={test.spec?.aiHealing !== false} onCheckedChange={toggleHealing} />
              </label>
            )}
            {test.type === "browser" && (
              <Button
                variant="outline"
                disabled={hardening || running}
                onClick={hardenLocators}
                title="Run the test against the live page and replace each locator with a validated, resilient one (+ fallbacks)."
              >
                {hardening ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-1" />
                )}{" "}
                Harden locators
              </Button>
            )}
            {test.type === "browser" && (
              <Button
                variant="outline"
                disabled={advising || running}
                onClick={adviseLocators}
                title="Find elements with no stable handle and get data-testid suggestions for your developers to add to the app."
              >
                {advising ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Lightbulb className="h-4 w-4 mr-1" />
                )}{" "}
                data-testid advice
              </Button>
            )}
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
              Run from start
            </Button>
          </div>
        </div>
      </div>

      {/* Locator hardening report */}
      {hardenReport && (
        <section className="glass rounded-2xl p-6 shadow-card">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" /> Locator hardening
          </h2>
          <div className="space-y-2">
            {hardenReport.map((r: any) => (
              <div
                key={r.idx}
                className="rounded-lg border border-border bg-surface/40 p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-6">{r.idx + 1}</span>
                  <Badge variant="secondary" className="text-xs">
                    {r.action}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      r.status === "improved"
                        ? "border-success/40 text-success"
                        : r.status === "unresolved"
                          ? "border-destructive/40 text-destructive"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {r.status}
                  </Badge>
                </div>
                <div className="font-mono text-xs mt-2 ml-8">
                  <span className="text-muted-foreground line-through">{r.original}</span>
                  {r.hardened && r.status === "improved" && (
                    <>
                      {" → "}
                      <span className="text-success">{r.hardened}</span>
                    </>
                  )}
                </div>
                {r.fallbacks?.length > 0 && (
                  <div className="font-mono text-[11px] mt-1 ml-8 text-muted-foreground">
                    fallbacks: {r.fallbacks.join("  |  ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* data-testid advice (developer-facing) */}
      {advisories && (
        <section className="glass rounded-2xl p-6 shadow-card">
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" /> data-testid advice
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Add these stable handles in your app's DOM so locators stop being brittle for everyone.
            Testrify sees the rendered page, so it points at the element — your devs place the
            attribute in source.
          </p>
          {advisories.length === 0 ? (
            <div className="text-sm text-success">
              Every element your test touches already has a stable handle. Nothing to do. 🎉
            </div>
          ) : (
            <div className="space-y-3">
              {advisories.map((a: any) => (
                <div
                  key={a.idx}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-xs text-muted-foreground w-6">{a.idx + 1}</span>
                    <Badge variant="secondary" className="text-xs">
                      {a.action}
                    </Badge>
                    <span className="text-muted-foreground text-xs">{a.reason}</span>
                  </div>
                  <div className="mt-2 ml-8 space-y-1 text-xs">
                    <div className="text-muted-foreground">
                      where: <span className="font-mono">{a.domPath}</span>
                    </div>
                    <pre className="font-mono text-[11px] bg-surface/60 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                      {a.elementHtml}
                    </pre>
                    <div className="font-mono">
                      add <span className="text-success">data-testid="{a.suggestedTestId}"</span> →
                      then <span className="text-primary-glow">{a.suggestedLocator}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                <span className="flex-1 truncate">
                  {isApi ? s.url : s.locator ? locatorLabel(s.locator) : s.target}
                </span>
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
                    <span className="text-muted-foreground line-through">
                      {s.locator ? locatorLabel(s.locator) : s.target}
                    </span>{" "}
                    → <span className="text-success">{healed[i].resilient}</span>
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
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium flex items-center gap-2">
                      <span>
                        {r.status === "passed" ? "Passed" : "Failed"} · {r.summary?.passed ?? 0}/
                        {r.summary?.total ?? 0} steps
                      </span>
                      {(r.summary?.healed ?? 0) > 0 && (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 text-amber-500 gap-1"
                        >
                          <Wand2 className="h-3 w-3" /> {r.summary.healed} auto-healed
                        </Badge>
                      )}
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
                      title={`${s.action || s.name} ${s.target || ""}${s.status === "healed" ? ` (healed from ${s.healed_from})` : ""}`}
                      className={`h-1.5 flex-1 min-w-[8px] rounded-full ${s.status === "passed" ? "bg-success" : s.status === "healed" ? "bg-amber-500" : s.status === "failed" ? "bg-destructive" : s.status === "skipped" ? "bg-muted-foreground/30" : "bg-muted"}`}
                    />
                  ))}
                </div>
                {(r.steps || []).some((s: any) => s.status === "healed") && (
                  <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                    <div className="text-xs text-amber-500 mb-2 flex items-center gap-1">
                      <Wand2 className="h-3 w-3" /> AUTO-HEALED & CONTINUED
                    </div>
                    {(r.steps || [])
                      .filter((s: any) => s.status === "healed")
                      .map((s: any) => (
                        <div key={s.idx} className="font-mono text-xs mb-1">
                          <span className="text-muted-foreground">
                            step {s.idx + 1} ({s.action}):
                          </span>{" "}
                          <span className="text-muted-foreground line-through">
                            {s.healed_from}
                          </span>{" "}
                          → <span className="text-success">{s.healed_to}</span>
                          {s.recovery && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {s.recovery === "fallback" ? "via fallback" : "AI"}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                )}
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
    </div>
  );
}
