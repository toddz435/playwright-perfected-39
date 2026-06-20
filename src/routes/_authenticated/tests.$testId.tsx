import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { locatorLabel } from "@/lib/locator";
import { suggestColumnForStep, uniquifyColumns } from "@/lib/dataset";
import {
  CONDITION_KINDS,
  URL_CONDITION_KINDS,
  conditionLabel,
  type ConditionKind,
} from "@/lib/conditions";
import { isBlockMarker, validateBlocks, computeDepths, blockBounds, loopBounds } from "@/lib/blocks";
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
  GitBranch,
  Repeat,
  Database,
  ArrowDown,
  Plus,
  Save,
  X,
  Braces,
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
// Field/column names that look like they hold a credential. Dataset rows are stored unencrypted,
// so the wizard flags these so the user can use a write-only test secret instead.
const SENSITIVE_RE = /pass|secret|token|api.?key|otp|cvv|ssn|credit|card|\bpin\b/i;
// A name usable as a {{variable}} / dataset column: interpolation-safe charset, no prototype-
// pollution keys. Shared by the variables editor and the data-drive wizard.
const RESERVED_VAR_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const isValidVarName = (n: string) => /^[\w.-]+$/.test(n) && !RESERVED_VAR_NAMES.has(n);

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
    { name: string; value: string; secret: boolean; stored?: boolean; _k: string }[]
  >([]);
  const [savingVars, setSavingVars] = useState(false);
  // Visual-regression image viewer: signed URLs per screenshot step, keyed `${runId}:${sid|idx}`.
  const [imgState, setImgState] = useState<
    Record<string, { busy?: boolean; updating?: boolean; urls?: Record<string, string> }>
  >({});
  // Data-Driven Testing: the user's datasets (for the attach dropdown) + per-row run results.
  const [datasets, setDatasets] = useState<any[]>([]);
  const [datasetRunBusy, setDatasetRunBusy] = useState(false);
  const [datasetResults, setDatasetResults] = useState<any | null>(null);
  // DDT parameterize-from-recording wizard: turn recorded literal values into {{columns}},
  // seed a dataset with them as row 1, and attach it. `paramRows` is one entry per value-bearing
  // step (idx into the spec's steps), each with an editable column name + include toggle.
  const [paramOpen, setParamOpen] = useState(false);
  const [paramRows, setParamRows] = useState<
    {
      idx: number;
      action: string;
      field: string;
      literal: string;
      kind: "value" | "url";
      column: string;
      include: boolean;
      sensitive: boolean;
    }[]
  >([]);
  const [paramName, setParamName] = useState("");
  const [paramBusy, setParamBusy] = useState(false);

  const refresh = async () => {
    const { data: t } = await supabase.from("tests").select("*").eq("id", testId).single();
    setTest(t);
    // `datasets` isn't in the generated Supabase types yet — query via a loose handle.
    const { data: ds } = await (supabase as any)
      .from("datasets")
      .select("id,name,columns,rows")
      .order("created_at", { ascending: false });
    setDatasets(ds || []);
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
        Object.entries(specVars(test.spec)).map(([name, value]) => {
          const secret = secretNames.has(name);
          return {
            name,
            // Secrets are write-only: never load the stored (encrypted) value into the client.
            value: secret ? "" : value,
            secret,
            stored: secret && value.length > 0, // a value is already saved server-side
            _k: crypto.randomUUID(),
          };
        }),
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
    const keep: string[] = []; // secrets left blank → keep the stored (encrypted) value
    for (const { name, value, secret, stored } of varRows) {
      const n = name.trim();
      if (!n) continue;
      if (!isValidVarName(n))
        return toast.error(
          `Invalid variable name "${n}" — use letters, numbers, . _ - (no spaces).`,
        );
      if (secret) {
        secrets.push(n);
        if (value.trim() === "" && stored) keep.push(n); // unchanged → keep existing
      }
      variables[n] = value; // for kept secrets this is "", server uses the stored value
    }
    setSavingVars(true);
    try {
      // Server encrypts secret values at rest before they touch the DB (write-only client).
      await apiCall("/api/protected/save-variables", { testId, variables, secrets, keep });
      toast.success("Variables saved");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingVars(false);
    }
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

  // --- Visual-regression viewer ---
  const stepKey = (r: any, s: any) => `${r.id}:${s.sid ?? s.idx}`;
  const stepImagePaths = (s: any): string[] =>
    [s.baseline_path, s.actual_path, s.diff_path].filter(Boolean);

  const loadImages = async (r: any, s: any) => {
    const key = stepKey(r, s);
    const paths = stepImagePaths(s);
    if (!paths.length) return;
    setImgState((m) => ({ ...m, [key]: { ...m[key], busy: true } }));
    try {
      const { urls } = await apiCall<{ urls: Record<string, string> }>(
        "/api/protected/screenshot-url",
        { paths },
      );
      setImgState((m) => ({ ...m, [key]: { busy: false, urls } }));
    } catch (e: any) {
      toast.error(e.message);
      setImgState((m) => ({ ...m, [key]: { ...m[key], busy: false } }));
    }
  };

  // Promote a run's captured "actual" to the new baseline (for an intentional UI change).
  const updateBaseline = async (r: any, s: any) => {
    if (!s.actual_path) return;
    const key = stepKey(r, s);
    setImgState((m) => ({ ...m, [key]: { ...m[key], updating: true } }));
    try {
      await apiCall("/api/protected/update-baseline", {
        testId,
        sid: s.sid ?? null,
        idx: s.idx,
        actualPath: s.actual_path,
      });
      toast.success("Baseline updated — next run compares against this image.");
      // Re-fetch so the baseline tile shows the just-promoted image (fresh signed URL
      // busts the browser cache); loadImages clears `updating` via a full state replace.
      await loadImages(r, s);
    } catch (e: any) {
      toast.error(e.message);
      setImgState((m) => ({ ...m, [key]: { ...m[key], updating: false } }));
    }
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
        // A condition is evaluated against the page BEFORE the step runs, so it can't guard a
        // `goto` (there's no destination page yet) — drop it when switching to goto.
        if (action === "goto") delete next.condition;
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
  // Removing a block marker removes the whole block's markers (if/else/endif or
  // repeat/endrepeat) but keeps the body steps (they become top-level), so the list never
  // ends up unbalanced.
  const removeStep = (i: number) =>
    setDraft((d) => {
      const a = d[i]?.action;
      if (a === "if" || a === "else" || a === "endif") {
        const b = blockBounds(d, i);
        if (b) {
          const drop = new Set<number>([
            b.ifIndex,
            b.endifIndex,
            ...(b.elseIndex !== null ? [b.elseIndex] : []),
          ]);
          return d.filter((_, idx) => !drop.has(idx));
        }
      } else if (a === "repeat" || a === "endrepeat") {
        const b = loopBounds(d, i);
        if (b) {
          const drop = new Set<number>([b.repeatIndex, b.endrepeatIndex]);
          return d.filter((_, idx) => !drop.has(idx));
        }
      }
      return d.filter((_, idx) => idx !== i);
    });
  const addStep = () =>
    setDraft((d) => [...d, { action: "click", target: "", _k: crypto.randomUUID() }]);
  // Adds a balanced if-block (if … endif) the user fills in by moving steps between them.
  const addIfBlock = () =>
    setDraft((d) => [
      ...d,
      { action: "if", condition: { kind: "visible", target: "" }, _k: crypto.randomUUID() },
      { action: "endif", _k: crypto.randomUUID() },
    ]);
  // Adds a balanced repeat-block (repeat … endrepeat), defaulting to "3 times".
  const addRepeatBlock = () =>
    setDraft((d) => [
      ...d,
      { action: "repeat", loop: { mode: "times", count: 3 }, _k: crypto.randomUUID() },
      { action: "endrepeat", _k: crypto.randomUUID() },
    ]);
  const patchLoop = (i: number, patch: any) =>
    setDraft((d) =>
      d.map((s, idx) => (idx === i ? { ...s, loop: { ...s.loop, ...patch } } : s)),
    );
  // Inserts an `else` before the matching endif of the block containing marker i (once only).
  const addElse = (i: number) =>
    setDraft((d) => {
      const b = blockBounds(d, i);
      if (!b || b.elseIndex !== null) return d;
      const copy = [...d];
      copy.splice(b.endifIndex, 0, { action: "else", _k: crypto.randomUUID() });
      return copy;
    });
  // Inserts a new blank step immediately after a marker (if/else) so it lands INSIDE the
  // block without arrow-shuffling.
  const addStepInside = (i: number) =>
    setDraft((d) => {
      const copy = [...d];
      copy.splice(i + 1, 0, { action: "click", target: "", _k: crypto.randomUUID() });
      return copy;
    });
  // --- per-step condition guard ("run only if …") ---
  const addCondition = (i: number) => patchStep(i, { condition: { kind: "visible", target: "" } });
  const removeCondition = (i: number) => {
    setDraft((d) =>
      d.map((s, idx) => {
        if (idx !== i) return s;
        const { condition, ...rest } = s;
        return rest;
      }),
    );
  };
  const patchCondition = (i: number, patch: any) =>
    setDraft((d) =>
      d.map((s, idx) => (idx === i ? { ...s, condition: { ...s.condition, ...patch } } : s)),
    );
  // Changing the condition kind across the element↔URL boundary clears the input, since an
  // element selector and a URL substring aren't interchangeable.
  const setConditionKind = (i: number, kind: ConditionKind) =>
    setDraft((d) =>
      d.map((s, idx) => {
        if (idx !== i) return s;
        const crossed =
          URL_CONDITION_KINDS.has(kind) !== URL_CONDITION_KINDS.has(s.condition?.kind);
        return {
          ...s,
          condition: { ...s.condition, kind, ...(crossed ? { target: "", locator: undefined } : {}) },
        };
      }),
    );
  const saveSteps = async () => {
    // Validate before persisting so a broken step can't be saved and fail mid-run.
    if (draft.length === 0) return toast.error("Add at least one step.");
    const blockErr = validateBlocks(draft);
    if (blockErr) return toast.error(blockErr);
    for (let i = 0; i < draft.length; i++) {
      const s = draft[i];
      // Block markers carry no locator/value; an `if` just needs its condition filled in.
      if (isBlockMarker(s.action)) {
        if (s.action === "if") {
          const hasCondTarget = !!(s.condition?.locator || (s.condition?.target ?? "").trim());
          if (!hasCondTarget)
            return toast.error(
              `Step ${i + 1}: the "if" needs ${
                URL_CONDITION_KINDS.has(s.condition?.kind) ? "a URL substring" : "a locator"
              }.`,
            );
        }
        if (s.action === "repeat") {
          if ((s.loop?.mode ?? "times") === "while") {
            const hasCondTarget = !!(s.condition?.locator || (s.condition?.target ?? "").trim());
            if (!hasCondTarget)
              return toast.error(
                `Step ${i + 1}: "repeat while" needs ${
                  URL_CONDITION_KINDS.has(s.condition?.kind) ? "a URL substring" : "a locator"
                }.`,
              );
          } else {
            const n = Number(s.loop?.count);
            if (!Number.isFinite(n) || n < 1)
              return toast.error(`Step ${i + 1}: "repeat" needs a count of 1 or more.`);
          }
        }
        continue;
      }
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
      if (s.condition) {
        const hasCondTarget = !!(s.condition.locator || (s.condition.target ?? "").trim());
        if (!hasCondTarget)
          return toast.error(
            `Step ${i + 1}: the condition needs ${
              URL_CONDITION_KINDS.has(s.condition.kind) ? "a URL substring" : "a locator"
            }.`,
          );
      }
    }
    setSavingSteps(true);
    const steps = draft.map(({ _k, ...s }: any) => {
      // Give every screenshot step a stable id so its baseline survives reordering /
      // inserting steps (the baseline is keyed by sid, not by positional index).
      if (s.action === "screenshot" && !s.sid) s.sid = crypto.randomUUID();
      return s;
    }); // _k is the transient React key; sid persists in the spec
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
    // Server-side: purges the test's screenshot baselines/captures, then removes schedules + the
    // test row (runs cascade) — so nothing orphans in Storage.
    try {
      await apiCall("/api/protected/delete-test", { testId });
      toast.success("Test deleted");
      nav({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleHealing = async (on: boolean) => {
    const newSpec = { ...test.spec, aiHealing: on };
    const { error } = await supabase.from("tests").update({ spec: newSpec }).eq("id", testId);
    if (error) return toast.error(error.message);
    setTest((t: any) => ({ ...t, spec: newSpec }));
    toast.success(on ? "AI auto-heal enabled for this test" : "AI auto-heal disabled");
  };

  // Reliability: how many times to auto-retry a failed run (0–3). Persisted on the spec.
  const setRetries = async (n: number) => {
    const newSpec = { ...test.spec, retries: n };
    const { error } = await supabase.from("tests").update({ spec: newSpec }).eq("id", testId);
    if (error) return toast.error(error.message);
    setTest((t: any) => ({ ...t, spec: newSpec }));
  };

  // DDT: attach (or detach) a dataset to this test. Persisted on the spec.
  const setDataset = async (datasetId: string) => {
    const newSpec = { ...test.spec, datasetId: datasetId || undefined };
    const { error } = await supabase.from("tests").update({ spec: newSpec }).eq("id", testId);
    if (error) return toast.error(error.message);
    setTest((t: any) => ({ ...t, spec: newSpec }));
    setDatasetResults(null);
  };

  // DDT: run the test once per dataset row.
  const runWithDataset = async () => {
    setDatasetRunBusy(true);
    setDatasetResults(null);
    try {
      const r = await apiCall<any>("/api/protected/run-dataset", { testId });
      setDatasetResults(r);
      const extra = [r.errored ? `${r.errored} errored` : "", r.skipped ? `${r.skipped} skipped` : ""]
        .filter(Boolean)
        .join(", ");
      const msg = `${r.passed}/${r.rows} rows passed${r.failed ? `, ${r.failed} failed` : ""}${extra ? `, ${extra}` : ""}`;
      if (r.failed > 0 || r.errored > 0 || r.passed === 0) toast.error(msg);
      else toast.success(msg);
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
    setDatasetRunBusy(false);
  };

  // DDT: open the parameterize-from-recording wizard. Scans the recorded steps for literal
  // values (fill/expect values + goto/url targets, skipping ones already bound to {{var}}) and
  // suggests a {{column}} name for each from the field it targets.
  const openParameterize = () => {
    const steps: any[] = test.spec?.steps || [];
    const candidates = steps
      .map((s, i) => {
        if (isBlockMarker(s.action)) return null;
        if (VALUE_ACTIONS.has(s.action)) {
          const v = s.value ?? "";
          if (!v || v.includes("{{")) return null;
          return {
            idx: i,
            action: s.action,
            kind: "value" as const,
            literal: v,
            field: s.locator ? locatorLabel(s.locator) : (s.target ?? s.action),
            step: s,
          };
        }
        if (URL_ACTIONS.has(s.action)) {
          const v = s.target ?? "";
          if (!v || v.includes("{{")) return null;
          return { idx: i, action: s.action, kind: "url" as const, literal: v, field: s.action, step: s };
        }
        return null;
      })
      .filter(Boolean) as any[];
    if (!candidates.length) {
      toast.info("No fillable values to parameterize — record some fill or goto steps first.");
      return;
    }
    const names = uniquifyColumns(candidates.map((c, i) => suggestColumnForStep(c.step, i)));
    setParamRows(
      candidates.map((c, i) => ({
        idx: c.idx,
        action: c.action,
        field: c.field,
        literal: c.literal,
        kind: c.kind,
        column: names[i],
        include: true,
        sensitive: SENSITIVE_RE.test(c.field) || SENSITIVE_RE.test(names[i]),
      })),
    );
    setParamName(`${test.name} data`);
    setParamOpen(true);
  };

  const setParamRow = (i: number, patch: Partial<(typeof paramRows)[number]>) =>
    setParamRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // DDT: create a dataset seeded with the recorded values (row 1), bind the chosen steps to
  // {{column}}, and attach the dataset — all in one spec update.
  const applyParameterize = async () => {
    const chosen = paramRows.filter((r) => r.include);
    if (!chosen.length) return toast.error("Select at least one field to parameterize.");
    for (const r of chosen) {
      const n = r.column.trim();
      if (!n || !isValidVarName(n))
        return toast.error(
          `Invalid column name "${r.column}" — use letters, numbers, . _ - (no spaces).`,
        );
    }
    const name = paramName.trim();
    if (!name) return toast.error("Give the dataset a name.");
    // The wizard captured step indices when it opened; bail if the steps changed underneath us
    // (e.g. the user edited and saved steps meanwhile) so we never bind the wrong step.
    const curSteps: any[] = test.spec?.steps || [];
    for (const r of chosen) {
      const s = curSteps[r.idx];
      const current = r.kind === "url" ? s?.target : s?.value;
      if (!s || current !== r.literal)
        return toast.error("Steps changed since you opened Data-drive — close it and reopen.");
    }
    setParamBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        setParamBusy(false);
        return toast.error("Session expired — sign in again.");
      }
      // Unique columns in first-seen order; row 1 seeded with the recorded literal. When two
      // fields map to the same column (same value used twice), the first occurrence wins.
      const columns: string[] = [];
      const row1: Record<string, string> = {};
      for (const r of chosen) {
        const col = r.column.trim();
        if (!columns.includes(col)) {
          columns.push(col);
          row1[col] = r.literal;
        }
      }
      // Rewrite only the chosen steps to bind {{column}}; leave every other step untouched.
      const bind = new Map(chosen.map((r) => [r.idx, { col: r.column.trim(), kind: r.kind }]));
      const steps = (test.spec?.steps || []).map((s: any, i: number) => {
        const b = bind.get(i);
        if (!b) return s;
        const token = `{{${b.col}}}`;
        return b.kind === "url" ? { ...s, target: token } : { ...s, value: token };
      });
      const { data: ds, error: dsErr } = await (supabase as any)
        .from("datasets")
        .insert({
          owner_id: uid,
          name,
          source: "spreadsheet",
          columns,
          rows: [row1],
          project_id: test.project_id ?? null,
        })
        .select("id")
        .single();
      if (dsErr || !ds) throw new Error(dsErr?.message || "Could not create dataset.");
      const newSpec = { ...test.spec, steps, datasetId: ds.id };
      const { error: tErr } = await supabase.from("tests").update({ spec: newSpec }).eq("id", testId);
      if (tErr) throw new Error(tErr.message);
      toast.success(
        `Created "${name}" (${columns.length} column${columns.length === 1 ? "" : "s"}) and bound ${chosen.length} field${chosen.length === 1 ? "" : "s"}.`,
      );
      setParamOpen(false);
      setDatasetResults(null);
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
    setParamBusy(false);
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
  // Indentation depth per row for if/else blocks (browser tests only).
  const draftDepths = !isApi ? computeDepths(draft) : [];
  const itemDepths = !isApi ? computeDepths(items) : [];

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
              <label
                className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer"
                title="Auto-retry a failed run this many times (fresh browser each attempt); passes if any attempt passes. Caution: a retry re-runs the WHOLE test, so side-effecting steps (form submits, purchases) repeat. Total time is capped across attempts."
              >
                <Repeat className="h-3.5 w-3.5" />
                Retries
                <select
                  value={Math.min(3, Math.max(0, Number(test.spec?.retries) || 0))}
                  onChange={(e) => setRetries(Number(e.target.value))}
                  className="bg-input/50 border border-border rounded-md px-2 py-1 text-xs font-mono"
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {test.type === "browser" && (
              <Button
                variant="outline"
                disabled={paramOpen || running}
                onClick={openParameterize}
                title="Turn recorded values into {{columns}}: creates a dataset seeded with these values, binds the chosen fields, and attaches it."
              >
                <Braces className="h-4 w-4 mr-1" /> Data-drive
              </Button>
            )}
            {test.type === "browser" && datasets.length > 0 && (
              <label
                className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer"
                title="Drive this test from a dataset — it runs once per row, binding each row's columns to {{variables}}."
              >
                <Database className="h-3.5 w-3.5" />
                Dataset
                <select
                  value={test.spec?.datasetId || ""}
                  onChange={(e) => setDataset(e.target.value)}
                  className="bg-input/50 border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="">none</option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({(d.rows || []).length})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {test.type === "browser" && test.spec?.datasetId && (
              <Button
                variant="outline"
                disabled={datasetRunBusy || running}
                onClick={runWithDataset}
                title="Run the test once per row of the attached dataset."
              >
                {datasetRunBusy ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Database className="h-4 w-4 mr-1" />
                )}{" "}
                Run with dataset
              </Button>
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
              disabled={running || datasetRunBusy}
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

      {/* DDT: parameterize-from-recording wizard */}
      {paramOpen && (
        <section className="glass rounded-2xl p-6 shadow-card border border-primary/20">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Braces className="h-4 w-4 text-primary-glow" /> Data-drive from recording
              </h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Turn recorded values into <code className="text-primary-glow">{"{{columns}}"}</code>.
                We&apos;ll create a dataset seeded with these values as row 1, bind each chosen
                field, and attach it — then fill the sheet and run once per row.
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setParamOpen(false)} title="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Dataset name</label>
            <Input
              value={paramName}
              onChange={(e) => setParamName(e.target.value)}
              className="max-w-xs"
            />
          </div>

          <div className="mt-4 space-y-2">
            {paramRows.map((r, i) => (
              <div
                key={r.idx}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface/40 p-3"
              >
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => setParamRow(i, { include: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-xs text-muted-foreground w-6 text-right">{r.idx + 1}</span>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {r.action}
                </Badge>
                <span
                  className="text-xs text-muted-foreground font-mono truncate max-w-[180px] shrink-0"
                  title={r.field}
                >
                  {r.field}
                </span>
                <span className="text-muted-foreground shrink-0">→</span>
                <div className="flex items-center gap-0.5 font-mono text-xs shrink-0">
                  <span className="text-muted-foreground">{"{{"}</span>
                  <Input
                    value={r.column}
                    onChange={(e) => setParamRow(i, { column: e.target.value })}
                    disabled={!r.include}
                    className="h-7 w-36 font-mono text-xs"
                  />
                  <span className="text-muted-foreground">{"}}"}</span>
                </div>
                {r.sensitive && (
                  <Badge
                    variant="outline"
                    className="text-xs shrink-0 border-amber-500/40 text-amber-500"
                    title="Looks sensitive. Dataset values are stored unencrypted — for real credentials use a write-only test secret variable instead."
                  >
                    sensitive
                  </Badge>
                )}
                <span
                  className="text-xs text-muted-foreground truncate flex-1 text-right"
                  title={r.literal}
                >
                  = &quot;{r.literal}&quot;
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={applyParameterize}
              disabled={paramBusy}
              className="bg-gradient-primary border-0 shadow-glow"
            >
              {paramBusy ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-1" />
              )}{" "}
              Create dataset &amp; bind
            </Button>
            <span className="text-xs text-muted-foreground">
              {paramRows.filter((r) => r.include).length} of {paramRows.length} selected
            </span>
          </div>
        </section>
      )}

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
                type={row.secret ? "password" : "text"}
                autoComplete="off"
                value={row.value}
                onChange={(e) => setVar(i, { value: e.target.value })}
                placeholder={
                  row.secret
                    ? row.stored
                      ? "•••••• set — leave blank to keep"
                      : "value (encrypted at rest)"
                    : "value"
                }
                className="bg-input/50 text-xs font-mono flex-1 min-w-[160px]"
              />
              <label
                className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none"
                title="Secret: encrypted at rest, masked here, never stored in run records"
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
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <EyeOff className="h-3.5 w-3.5" /> Secrets are encrypted at rest and can't be
                viewed — only replaced.
              </span>
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
            {draft.map((s: any, i: number) => {
              const depth = draftDepths[i] ?? 0;
              const marker = isBlockMarker(s.action);
              const moveRemove = (
                <div className="flex items-center ml-auto">
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
                    title={marker ? "Remove block" : "Remove step"}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
              return (
                <div
                  key={s._k ?? i}
                  style={{ marginLeft: depth * 20 }}
                  className={`rounded-lg border p-2 ${marker ? "border-primary/40 bg-primary/10" : "border-border bg-surface/40"}`}
                >
                  {marker ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
                      {s.action === "if" ? (
                        <>
                          <span className="text-[11px] font-bold uppercase tracking-wide text-primary-glow">
                            if
                          </span>
                          <select
                            value={s.condition?.kind ?? "visible"}
                            onChange={(e) => setConditionKind(i, e.target.value as ConditionKind)}
                            className="bg-input/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                          >
                            {CONDITION_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {k.replace("_", " ")}
                              </option>
                            ))}
                          </select>
                          <Input
                            value={
                              s.condition?.locator
                                ? locatorLabel(s.condition.locator)
                                : (s.condition?.target ?? "")
                            }
                            onChange={(e) =>
                              patchCondition(i, { target: e.target.value, locator: undefined })
                            }
                            placeholder={
                              URL_CONDITION_KINDS.has(s.condition?.kind)
                                ? "url substring"
                                : "locator (css, text=…, role=…)"
                            }
                            className="bg-input/50 text-xs font-mono flex-1 min-w-[160px]"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => addStepInside(i)}
                            title="Add a step inside this block"
                            className="text-xs"
                          >
                            + step
                          </Button>
                          {blockBounds(draft, i)?.elseIndex == null && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => addElse(i)}
                              title="Add an else branch"
                              className="text-xs"
                            >
                              + else
                            </Button>
                          )}
                        </>
                      ) : s.action === "repeat" ? (
                        <>
                          <span className="text-[11px] font-bold uppercase tracking-wide text-primary-glow">
                            repeat
                          </span>
                          <select
                            value={s.loop?.mode ?? "times"}
                            onChange={(e) => patchLoop(i, { mode: e.target.value })}
                            className="bg-input/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                          >
                            <option value="times">times</option>
                            <option value="while">while</option>
                          </select>
                          {(s.loop?.mode ?? "times") === "times" ? (
                            <>
                              <Input
                                type="number"
                                min="1"
                                max="100"
                                value={s.loop?.count ?? ""}
                                onChange={(e) =>
                                  patchLoop(i, {
                                    count: e.target.value === "" ? undefined : Number(e.target.value),
                                  })
                                }
                                className="bg-input/50 text-xs font-mono w-20"
                              />
                              <span className="text-[11px] text-muted-foreground">times</span>
                            </>
                          ) : (
                            <>
                              <select
                                value={s.condition?.kind ?? "visible"}
                                onChange={(e) =>
                                  setConditionKind(i, e.target.value as ConditionKind)
                                }
                                className="bg-input/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                              >
                                {CONDITION_KINDS.map((k) => (
                                  <option key={k} value={k}>
                                    {k.replace("_", " ")}
                                  </option>
                                ))}
                              </select>
                              <Input
                                value={
                                  s.condition?.locator
                                    ? locatorLabel(s.condition.locator)
                                    : (s.condition?.target ?? "")
                                }
                                onChange={(e) =>
                                  patchCondition(i, { target: e.target.value, locator: undefined })
                                }
                                placeholder={
                                  URL_CONDITION_KINDS.has(s.condition?.kind)
                                    ? "url substring"
                                    : "locator (css, text=…, role=…)"
                                }
                                className="bg-input/50 text-xs font-mono flex-1 min-w-[160px]"
                              />
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => addStepInside(i)}
                            title="Add a step inside this loop"
                            className="text-xs"
                          >
                            + step
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-[11px] font-bold uppercase tracking-wide text-primary-glow">
                            {s.action === "else"
                              ? "else"
                              : s.action === "endrepeat"
                                ? "end repeat"
                                : "end if"}
                          </span>
                          {s.action === "else" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => addStepInside(i)}
                              title="Add a step to the else branch"
                              className="text-xs"
                            >
                              + step
                            </Button>
                          )}
                        </>
                      )}
                      {moveRemove}
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
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
                        {!s.condition && s.action !== "goto" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => addCondition(i)}
                            title="Add condition (run only if…)"
                          >
                            <GitBranch className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {moveRemove}
                      </div>
                      {s.condition && (
                        <div className="flex flex-wrap items-center gap-2 mt-2 ml-7 pl-2 border-l-2 border-primary/40">
                          <span className="text-[11px] uppercase tracking-wide text-primary-glow">
                            only if
                          </span>
                          <select
                            value={s.condition.kind}
                            onChange={(e) => setConditionKind(i, e.target.value as ConditionKind)}
                            className="bg-input/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                          >
                            {CONDITION_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {k.replace("_", " ")}
                              </option>
                            ))}
                          </select>
                          <Input
                            value={
                              s.condition.locator
                                ? locatorLabel(s.condition.locator)
                                : (s.condition.target ?? "")
                            }
                            onChange={(e) =>
                              patchCondition(i, { target: e.target.value, locator: undefined })
                            }
                            placeholder={
                              URL_CONDITION_KINDS.has(s.condition.kind)
                                ? "url substring"
                                : "locator (css, text=…, role=…)"
                            }
                            className="bg-input/50 text-xs font-mono flex-1 min-w-[160px]"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeCondition(i)}
                            title="Remove condition"
                            className="text-destructive hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={addStep}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add step
              </Button>
              <Button size="sm" variant="outline" onClick={addIfBlock}>
                <GitBranch className="h-3.5 w-3.5 mr-1" /> Add if-block
              </Button>
              <Button size="sm" variant="outline" onClick={addRepeatBlock}>
                <Repeat className="h-3.5 w-3.5 mr-1" /> Add repeat-block
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((s: any, i: number) => (
              <div
                key={i}
                style={{ marginLeft: !isApi ? (itemDepths[i] ?? 0) * 20 : 0 }}
                className={`rounded-lg border p-3 ${
                  !isApi && isBlockMarker(s.action)
                    ? "border-primary/40 bg-primary/10"
                    : "border-border bg-surface/40"
                }`}
              >
                <div className="flex items-center gap-3 font-mono text-sm">
                  <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
                  <Badge variant="secondary" className="text-xs">
                    {isApi
                      ? s.method
                      : s.action === "endif"
                        ? "end if"
                        : s.action === "endrepeat"
                          ? "end repeat"
                          : s.action}
                  </Badge>
                  <span className="flex-1 truncate">
                    {isApi
                      ? s.url
                      : isBlockMarker(s.action)
                        ? s.action === "if" && s.condition
                          ? conditionLabel(s.condition)
                          : s.action === "repeat"
                            ? (s.loop?.mode ?? "times") === "while"
                              ? s.condition
                                ? `while ${conditionLabel(s.condition).replace(/^only if /, "")}`
                                : "while …"
                              : `${s.loop?.count ?? 0} times`
                            : ""
                        : s.locator
                          ? locatorLabel(s.locator)
                          : s.target}
                  </span>
                  {!isApi && !isBlockMarker(s.action) && s.value && (
                    <span className="text-xs text-muted-foreground">"{s.value}"</span>
                  )}
                  {!isApi && !isBlockMarker(s.action) && (
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
                {!isApi && s.condition && !isBlockMarker(s.action) && (
                  <div className="text-xs text-primary-glow mt-1 ml-9 flex items-center gap-1 font-mono">
                    <GitBranch className="h-3 w-3" /> {conditionLabel(s.condition)}
                  </div>
                )}
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

      {/* Dataset run results (per row) */}
      {datasetResults && (
        <section className="glass rounded-2xl p-6 shadow-card">
          <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-primary-glow" /> Dataset run — {datasetResults.passed}/
            {datasetResults.rows} rows passed
          </h2>
          <div className="grid gap-1.5">
            {datasetResults.results.map((r: any) => {
              const ok = r.status === "passed";
              const skipped = "skipped" in r;
              const errored = "error" in r;
              return (
                <div
                  key={r.row}
                  className="flex items-center gap-2 text-sm font-mono rounded-md border border-border bg-surface/40 px-3 py-1.5"
                >
                  {ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                  ) : skipped ? (
                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  )}
                  <span className="text-muted-foreground">row {r.row + 1}</span>
                  <span className="flex-1 truncate">{r.label}</span>
                  <span
                    className={
                      ok
                        ? "text-success"
                        : skipped
                          ? "text-muted-foreground"
                          : "text-destructive"
                    }
                  >
                    {ok ? "passed" : skipped ? r.skipped : errored ? r.error : r.status}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
                      {(r.summary?.attempts ?? 1) > 1 && (
                        <Badge
                          variant="outline"
                          className="border-primary/40 text-primary-glow gap-1"
                          title="This run was retried"
                        >
                          <Repeat className="h-3 w-3" /> attempt {r.summary.attempts}/
                          {r.summary.maxAttempts}
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
                      title={`${s.action || s.name} ${s.target || ""}${s.iteration ? ` [iter ${s.iteration}]` : ""}${s.status === "healed" ? ` (healed from ${s.healed_from})` : ""}${s.status === "skipped" && s.skipped_reason ? ` (skipped — ${s.skipped_reason})` : ""}`}
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
                          {stepImagePaths(s).length > 0 &&
                            (() => {
                              const st = imgState[stepKey(r, s)];
                              if (!st?.urls) {
                                return (
                                  <button
                                    className="ml-2 text-[11px] underline text-muted-foreground hover:text-foreground disabled:opacity-50"
                                    disabled={st?.busy}
                                    onClick={() => loadImages(r, s)}
                                  >
                                    {st?.busy ? "loading…" : "view images"}
                                  </button>
                                );
                              }
                              const tiles: [string, string][] = (
                                [
                                  ["baseline", s.baseline_path],
                                  ["actual", s.actual_path],
                                  ["diff", s.diff_path],
                                ] as [string, string | undefined][]
                              )
                                .filter(([, p]) => p && st.urls?.[p])
                                .map(([label, p]) => [label, st.urls![p as string]]);
                              return (
                                <div className="mt-2">
                                  <div className="flex flex-wrap gap-3">
                                    {tiles.map(([label, url]) => (
                                      <figure
                                        key={label}
                                        className="text-[10px] text-muted-foreground"
                                      >
                                        <a href={url} target="_blank" rel="noreferrer">
                                          <img
                                            src={url}
                                            alt={label}
                                            className="h-32 w-auto rounded border border-border object-contain bg-surface"
                                          />
                                        </a>
                                        <figcaption className="mt-0.5 uppercase tracking-wide">
                                          {label}
                                        </figcaption>
                                      </figure>
                                    ))}
                                  </div>
                                  {s.actual_path && (
                                    <button
                                      className="mt-2 text-[11px] underline text-primary-glow hover:opacity-80 disabled:opacity-50"
                                      disabled={imgState[stepKey(r, s)]?.updating}
                                      onClick={() => updateBaseline(r, s)}
                                    >
                                      {imgState[stepKey(r, s)]?.updating
                                        ? "updating…"
                                        : "update baseline to this"}
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
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
