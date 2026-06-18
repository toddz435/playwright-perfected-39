import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { locatorLabel } from "@/lib/locator";
import { advisoriesToMarkdown } from "@/lib/advisory-format";
import { specVars } from "@/lib/vars";
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
  Trash2,
  Pencil,
  ArrowUp,
  ArrowDown,
  Plus,
  Save,
  X,
  Braces,
  Eye,
  EyeOff,
  Image as ImageIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/tests/$testId")({
  head: () => ({ meta: [{ title: "Test — Testrify" }] }),
  component: TestDetail,
});

// Browser step actions the engine supports (see playwright-runner.server.ts).
const STEP_ACTIONS = [
  "goto",
  "click",
  "fill",
  "press",
  "screenshot",
  "expect_visible",
  "expect_text",
  "expect_value",
  "expect_count",
  "expect_url_contains",
];
// Actions whose "target" is a URL/substring rather than a locator.
const URL_ACTIONS = new Set(["goto", "expect_url_contains"]);
// Actions that take a value.
const VALUE_ACTIONS = new Set(["fill", "press", "expect_text", "expect_value", "expect_count"]);

function TestDetail() {
  const { testId } = Route.useParams();
  const nav = useNavigate();
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any[]>([]);
  const [savingSteps, setSavingSteps] = useState(false);
  const [varRows, setVarRows] = useState<
    { name: string; value: string; secret: boolean; _k: string }[]
  >([]);
  const [savingVars, setSavingVars] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

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
  // Load variables into editable rows whenever the test loads/changes.
  useEffect(() => {
    if (test) {
      const secretNames = new Set<string>(
        Array.isArray(test.spec?.secrets) ? test.spec.secrets : [],
      );
      setVarRows(
        Object.entries(specVars(test.spec)).map(([name, value]) => ({
          name,
          value,
          secret: secretNames.has(name),
          _k: crypto.randomUUID(),
        })),
      );
    }
  }, [test]);

  const addVar = () =>
    setVarRows((r) => [...r, { name: "", value: "", secret: false, _k: crypto.randomUUID() }]);
  const removeVar = (i: number) => setVarRows((r) => r.filter((_, idx) => idx !== i));
  const setVar = (i: number, patch: Partial<{ name: string; value: string; secret: boolean }>) =>
    setVarRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const saveVars = async () => {
    const variables: Record<string, string> = {};
    const secrets: string[] = [];
    const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
    for (const { name, value, secret } of varRows) {
      const n = name.trim();
      if (!n) continue;
      if (!/^[\w.-]+$/.test(n) || RESERVED.has(n))
        return toast.error(
          `Invalid variable name "${n}" — use letters, numbers, . _ - (no spaces).`,
        );
      variables[n] = value;
      if (secret) secrets.push(n);
    }
    setSavingVars(true);
    const { error } = await supabase
      .from("tests")
      .update({ spec: { ...test.spec, variables, secrets } })
      .eq("id", testId);
    setSavingVars(false);
    if (error) return toast.error(error.message);
    toast.success("Variables saved");
    refresh();
  };

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

  // --- Step editor --- (draft rows carry a transient _k for stable React keys)
  const startEdit = () => {
    setDraft((test.spec?.steps || []).map((s: any) => ({ ...s, _k: crypto.randomUUID() })));
    setHealed({}); // index-keyed heal state would point at the wrong steps after edits
    setEditing(true);
  };
  const patchStep = (i: number, patch: any) =>
    setDraft((d) => d.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  // Editing a locator stores a raw target string and drops the structured locator +
  // fallbacks for that step (a manual override).
  const setStepTarget = (i: number, value: string) =>
    patchStep(i, { target: value, locator: undefined, fallbacks: undefined });
  // Changing the action reconciles fields: drop a now-irrelevant value, and when switching
  // to a URL action drop any structured locator so the field is treated as the URL/target.
  const onActionChange = (i: number, action: string) =>
    setDraft((d) =>
      d.map((s, idx) => {
        if (idx !== i) return s;
        const next: any = { ...s, action };
        if (!VALUE_ACTIONS.has(action)) delete next.value;
        if (URL_ACTIONS.has(action)) {
          delete next.locator;
          delete next.fallbacks;
        }
        return next;
      }),
    );
  const moveStep = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const copy = [...d];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const removeStep = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));
  const addStep = () =>
    setDraft((d) => [...d, { action: "click", target: "", _k: crypto.randomUUID() }]);
  const saveSteps = async () => {
    // Validate before persisting so a broken step can't be saved and fail mid-run.
    if (draft.length === 0) return toast.error("Add at least one step.");
    for (let i = 0; i < draft.length; i++) {
      const s = draft[i];
      const hasTarget = !!(s.locator || (s.target ?? "").trim());
      // screenshot is valid with no locator (captures the viewport).
      if (s.action !== "screenshot" && !hasTarget)
        return toast.error(
          `Step ${i + 1}: add a ${URL_ACTIONS.has(s.action) ? "URL" : "locator"}.`,
        );
      if (s.action === "expect_count" && !Number.isFinite(Number(s.value)))
        return toast.error(`Step ${i + 1}: expect_count needs a number.`);
      if ((s.action === "expect_text" || s.action === "expect_value") && !(s.value ?? "").trim())
        return toast.error(`Step ${i + 1}: ${s.action} needs a value.`);
    }
    setSavingSteps(true);
    const steps = draft.map(({ _k, ...s }: any) => s); // strip the transient key
    const { error } = await supabase
      .from("tests")
      .update({ spec: { ...test.spec, steps } })
      .eq("id", testId);
    setSavingSteps(false);
    if (error) return toast.error(error.message);
    toast.success("Steps saved");
    setEditing(false);
    refresh();
  };

  const deleteTest = async () => {
    if (!window.confirm(`Delete test "${test.name}" and all its runs? This cannot be undone.`))
      return;
    // schedules have no FK to tests, so remove them explicitly; runs cascade.
    await supabase.from("schedules").delete().eq("test_id", testId);
    const { error } = await supabase.from("tests").delete().eq("id", testId);
    if (error) return toast.error(error.message);
    toast.success("Test deleted");
    nav({ to: "/dashboard" });
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
            <Button
              variant="ghost"
              size="icon"
              onClick={deleteTest}
              title="Delete this test and its runs"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
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
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="font-semibold flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" /> data-testid advice
            </h2>
            {advisories.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(advisoriesToMarkdown(test.name, advisories));
                  toast.success("Copied a Markdown checklist — paste it into a GitHub issue/PR");
                }}
              >
                Copy as Markdown
              </Button>
            )}
          </div>
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

      {/* Variables */}
      <section className="glass rounded-2xl p-6 shadow-card">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <Braces className="h-4 w-4" /> Variables
          </h2>
          <Button
            size="sm"
            variant="ghost"
            disabled={savingVars}
            onClick={saveVars}
            className="bg-gradient-primary border-0"
          >
            {savingVars ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1" />
            )}{" "}
            Save variables
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Reference these as <span className="font-mono">{"{{name}}"}</span> in any locator, value,
          or URL — substituted at run time (e.g.{" "}
          <span className="font-mono">{"{{baseUrl}}/login"}</span>). Mark a variable{" "}
          <strong>secret</strong> to mask it here and keep its value out of run records.
        </p>
        <div className="space-y-2">
          {varRows.length === 0 && (
            <div className="text-xs text-muted-foreground">No variables yet.</div>
          )}
          {varRows.map((row, i) => (
            <div key={row._k} className="flex items-center gap-2">
              <Input
                value={row.name}
                onChange={(e) => setVar(i, { name: e.target.value })}
                placeholder="name"
                className="bg-input/50 text-xs font-mono w-40"
              />
              <span className="text-muted-foreground text-xs">=</span>
              <Input
                type={row.secret && !showSecrets ? "password" : "text"}
                autoComplete="off"
                value={row.value}
                onChange={(e) => setVar(i, { value: e.target.value })}
                placeholder="value"
                className="bg-input/50 text-xs font-mono flex-1 min-w-[160px]"
              />
              <label
                className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none"
                title="Secret: masked here and never stored in run records"
              >
                <input
                  type="checkbox"
                  checked={row.secret}
                  onChange={(e) => setVar(i, { secret: e.target.checked })}
                />
                secret
              </label>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeVar(i)}
                title="Remove variable"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={addVar}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add variable
            </Button>
            {varRows.some((r) => r.secret) && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showSecrets}
                  onChange={(e) => setShowSecrets(e.target.checked)}
                />
                {showSecrets ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{" "}
                Show secret values
              </label>
            )}
          </div>
        </div>
      </section>

      {/* Steps with inline healing */}
      <section className="glass rounded-2xl p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <ChevronRight className="h-4 w-4" /> Steps ({editing ? draft.length : items.length})
          </h2>
          {!isApi &&
            (editing ? (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  <X className="h-3.5 w-3.5 mr-1" /> Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={savingSteps}
                  onClick={saveSteps}
                  className="bg-gradient-primary border-0"
                >
                  {savingSteps ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1" />
                  )}{" "}
                  Save steps
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit steps
              </Button>
            ))}
        </div>
        {editing && !isApi ? (
          <div className="space-y-2">
            {draft.map((s: any, i: number) => (
              <div
                key={s._k ?? i}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/40 p-2"
              >
                <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
                <select
                  value={s.action}
                  onChange={(e) => onActionChange(i, e.target.value)}
                  className="bg-input/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                >
                  {STEP_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <Input
                  value={s.locator ? locatorLabel(s.locator) : (s.target ?? "")}
                  onChange={(e) => setStepTarget(i, e.target.value)}
                  placeholder={
                    URL_ACTIONS.has(s.action)
                      ? "https://… or /path"
                      : "locator (css, text=…, role=…)"
                  }
                  className="bg-input/50 text-xs font-mono flex-1 min-w-[180px]"
                />
                {VALUE_ACTIONS.has(s.action) && (
                  <Input
                    value={s.value ?? ""}
                    onChange={(e) => patchStep(i, { value: e.target.value })}
                    placeholder="value"
                    className="bg-input/50 text-xs font-mono w-32"
                  />
                )}
                <div className="flex items-center">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={i === 0}
                    onClick={() => moveStep(i, -1)}
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={i === draft.length - 1}
                    onClick={() => moveStep(i, 1)}
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeStep(i)}
                    title="Remove step"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addStep}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add step
            </Button>
          </div>
        ) : (
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
        )}
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
                {(r.steps || []).some((s: any) => s.action === "screenshot") && (
                  <div className="mt-3 rounded-md border border-border bg-surface/40 p-3 text-sm">
                    <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                      <ImageIcon className="h-3 w-3" /> VISUAL REGRESSION
                    </div>
                    {(r.steps || [])
                      .filter((s: any) => s.action === "screenshot")
                      .map((s: any) => (
                        <div key={s.idx} className="font-mono text-xs mb-1">
                          <span className="text-muted-foreground">
                            step {s.idx + 1} ({s.target}):
                          </span>{" "}
                          {s.visual === "baseline_created" ? (
                            <span className="text-primary-glow">baseline created</span>
                          ) : s.visual === "match" ? (
                            <span className="text-success">
                              match ({((s.diff_ratio ?? 0) * 100).toFixed(2)}%)
                            </span>
                          ) : s.visual === "diff" ? (
                            <span className="text-destructive">
                              {s.dims_match === false
                                ? "size changed"
                                : `changed ${((s.diff_ratio ?? 0) * 100).toFixed(2)}%`}
                            </span>
                          ) : s.visual === "error" ? (
                            <span className="text-amber-500">
                              storage not set up{s.visual_error ? ` — ${s.visual_error}` : ""}
                            </span>
                          ) : s.status === "failed" ? (
                            <span className="text-destructive">
                              capture failed{s.error ? ` — ${s.error}` : ""}
                            </span>
                          ) : (
                            <span className="text-amber-500">storage not set up</span>
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
