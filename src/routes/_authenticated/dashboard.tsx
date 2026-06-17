import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Plus,
  Sparkles,
  Play,
  Loader2,
  FolderKanban,
  Activity,
  CheckCircle2,
  XCircle,
  Brain,
  Wand2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Testrify" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // create project
  const [pName, setPName] = useState("");
  const [pUrl, setPUrl] = useState("");
  const [pOpen, setPOpen] = useState(false);

  // AI test author
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // run + analysis
  const [runningId, setRunningId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ runId: string; text: string } | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [hardenBusy, setHardenBusy] = useState(false);

  const seedDemo = async () => {
    setSeedBusy(true);
    try {
      const { project, count } = await apiCall<any>("/api/protected/seed-demo", {});
      toast.success(`Seeded "${project.name}" with ${count} tests`);
      setActiveProject(project.id);
      if (typeof window !== "undefined") localStorage.setItem("activeProject", project.id);
      window.dispatchEvent(new CustomEvent("activeProjectChange", { detail: project.id }));
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
    setSeedBusy(false);
  };

  const hardenAll = async () => {
    if (!activeProject) return;
    setHardenBusy(true);
    try {
      const r = await apiCall<any>("/api/protected/harden-project", { projectId: activeProject });
      toast.success(
        `Hardened ${r.improved} locator${r.improved === 1 ? "" : "s"} across ${r.tests} test${r.tests === 1 ? "" : "s"}`,
      );
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
    setHardenBusy(false);
  };

  const deleteProject = async () => {
    if (!activeProject) return;
    const proj = projects.find((p) => p.id === activeProject);
    if (
      !window.confirm(
        `Delete project "${proj?.name ?? ""}" and ALL its tests and runs? This cannot be undone.`,
      )
    )
      return;
    const testIds = tests.filter((t) => t.project_id === activeProject).map((t) => t.id);
    // schedules have no FK to tests, so remove them explicitly; tests+runs cascade.
    if (testIds.length) await supabase.from("schedules").delete().in("test_id", testIds);
    const { error } = await supabase.from("projects").delete().eq("id", activeProject);
    if (error) return toast.error(error.message);
    toast.success("Project deleted");
    setActiveProject(null);
    refresh();
  };

  const refresh = async () => {
    const { data: ps } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    setProjects(ps || []);
    if (!activeProject && ps?.[0]) setActiveProject(ps[0].id);
    const { data: ts } = await supabase
      .from("tests")
      .select("*")
      .order("created_at", { ascending: false });
    setTests(ts || []);
    setLoading(false);
  };
  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line

  // Recent runs are fetched scoped to the active project (via an inner join on tests),
  // so a project's runs are never hidden behind a global limit.
  const loadRuns = (projectId: string | null) => {
    if (!projectId) return;
    supabase
      .from("runs")
      .select("*, tests!inner(project_id)")
      .eq("tests.project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setRuns(data || []));
  };
  useEffect(() => {
    loadRuns(activeProject);
  }, [activeProject]); // eslint-disable-line

  const createProject = async () => {
    if (!pName.trim()) return toast.error("Project name is required");
    if (!user?.id) return toast.error("Not signed in yet — please wait a moment and try again");
    try {
      const { error } = await supabase
        .from("projects")
        .insert({ owner_id: user.id, name: pName.trim(), base_url: pUrl.trim() || null });
      if (error) return toast.error(error.message);
      setPName("");
      setPUrl("");
      setPOpen(false);
      toast.success("Project created");
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create project");
    }
  };

  const generateTest = async () => {
    if (!aiPrompt.trim() || !activeProject)
      return toast.error("Pick a project and describe the test.");
    setAiBusy(true);
    try {
      const baseUrl = projects.find((p) => p.id === activeProject)?.base_url;
      const spec = await apiCall<any>("/api/protected/ai-generate-test", {
        prompt: aiPrompt,
        baseUrl,
      });
      const { error } = await supabase.from("tests").insert({
        project_id: activeProject,
        owner_id: user!.id,
        name: spec.name,
        description: spec.description,
        type: "browser",
        spec,
      });
      if (error) throw error;
      toast.success("Test generated");
      setAiPrompt("");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
    setAiBusy(false);
  };

  const runTest = async (testId: string) => {
    setRunningId(testId);
    try {
      const { run } = await apiCall<any>("/api/protected/run-test", { testId });
      toast[run.status === "passed" ? "success" : "error"](`Run ${run.status}`);
      loadRuns(activeProject);
      if (run.status === "failed") analyzeRun(run);
    } catch (e: any) {
      toast.error(e.message);
    }
    setRunningId(null);
  };

  const analyzeRun = async (run: any) => {
    setAnalysisBusy(true);
    setAnalysis({ runId: run.id, text: "" });
    try {
      const test = tests.find((t) => t.id === run.test_id);
      const failed = (run.steps || []).find((s: any) => s.status === "failed");
      const { analysis } = await apiCall<any>("/api/protected/ai-analyze-failure", {
        test,
        failedStep: failed,
        error: failed?.error,
        allSteps: run.steps,
      });
      setAnalysis({ runId: run.id, text: analysis });
    } catch (e: any) {
      toast.error(e.message);
      setAnalysis(null);
    }
    setAnalysisBusy(false);
  };

  const projectTests = tests.filter((t) => t.project_id === activeProject);
  // Recent runs scoped to the active project, so switching projects shows its runs.
  const projectTestIds = new Set(projectTests.map((t) => t.id));
  const projectRuns = runs.filter((r) => projectTestIds.has(r.test_id));

  if (loading)
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Author resilient tests with AI. Resume from any failed step.
          </p>
        </div>
        <div className="flex gap-2">
          {activeProject && projectTests.some((t) => t.type === "browser") && (
            <Button
              variant="outline"
              disabled={hardenBusy}
              onClick={hardenAll}
              title="Run every browser test in this project against the live site and replace brittle locators with validated, resilient ones."
            >
              {hardenBusy ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4 mr-1" />
              )}
              Harden all
            </Button>
          )}
          {activeProject && (
            <Button
              variant="outline"
              onClick={deleteProject}
              title="Delete this project and all its tests and runs."
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete project
            </Button>
          )}
          <Button variant="outline" disabled={seedBusy} onClick={seedDemo}>
            {seedBusy ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-1" />
            )}
            Seed demo project
          </Button>
          <Dialog open={pOpen} onOpenChange={setPOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary border-0 shadow-glow">
                <Plus className="h-4 w-4 mr-1" /> New project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a project</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    placeholder="Acme Storefront"
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    Base URL <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    value={pUrl}
                    onChange={(e) => setPUrl(e.target.value)}
                    placeholder="https://acme.com"
                  />
                </div>
                <Button onClick={createProject} className="w-full bg-gradient-primary border-0">
                  Create
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {projects.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center shadow-card">
          <FolderKanban className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold">No projects yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first project, or seed a ready-to-run demo against
            the-internet.herokuapp.com.
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" disabled={seedBusy} onClick={seedDemo}>
              {seedBusy ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4 mr-1" />
              )}
              Seed demo project
            </Button>
            <Button onClick={() => setPOpen(true)} className="bg-gradient-primary border-0">
              <Plus className="h-4 w-4 mr-1" /> New project
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Project picker */}
          <div className="flex gap-2 overflow-auto">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveProject(p.id)}
                className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap transition border
                  ${activeProject === p.id ? "bg-surface-elevated border-primary text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* AI Author */}
          <section className="glass rounded-2xl p-6 shadow-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-lg bg-gradient-primary flex items-center justify-center shadow-glow">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <h2 className="font-semibold text-lg">Author a test in plain English</h2>
            </div>
            <Textarea
              rows={3}
              placeholder='e.g. "Log in as admin@acme.com, navigate to Settings, verify the company name is Acme Inc."'
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              className="bg-input/50 mb-3"
            />
            <Button
              disabled={aiBusy}
              onClick={generateTest}
              className="bg-gradient-primary border-0"
            >
              {aiBusy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" /> Generate test
                </>
              )}
            </Button>
          </section>

          {/* Tests */}
          <section>
            <h2 className="font-semibold text-lg mb-3">Tests</h2>
            {projectTests.length === 0 ? (
              <div className="text-sm text-muted-foreground glass rounded-xl p-6">
                No tests yet. Generate one above.
              </div>
            ) : (
              <div className="grid gap-3">
                {projectTests.map((t) => (
                  <div
                    key={t.id}
                    className="glass rounded-xl p-4 flex items-center gap-4 shadow-card"
                  >
                    <Link
                      to="/tests/$testId"
                      params={{ testId: t.id }}
                      className="flex-1 min-w-0 hover:opacity-80 transition"
                    >
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium truncate">{t.name}</h3>
                        <Badge variant="outline" className="text-xs">
                          {t.type}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{t.description}</p>
                      <div className="text-xs text-muted-foreground mt-1">
                        {t.spec?.steps?.length ?? t.spec?.requests?.length ?? 0} steps
                      </div>
                    </Link>
                    <Button
                      size="sm"
                      disabled={runningId === t.id}
                      onClick={() => runTest(t.id)}
                      className="bg-gradient-primary border-0"
                    >
                      {runningId === t.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-1" /> Run
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent runs */}
          <section>
            <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4" /> Recent runs
            </h2>
            {projectRuns.length === 0 ? (
              <div className="text-sm text-muted-foreground glass rounded-xl p-6">No runs yet.</div>
            ) : (
              <div className="grid gap-3">
                {projectRuns.map((r) => {
                  const test = tests.find((t) => t.id === r.test_id);
                  return (
                    <div key={r.id} className="glass rounded-xl p-4 shadow-card">
                      <div className="flex items-center gap-3">
                        {r.status === "passed" ? (
                          <CheckCircle2 className="h-5 w-5 text-success" />
                        ) : (
                          <XCircle className="h-5 w-5 text-destructive" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate flex items-center gap-2">
                            <span className="truncate">{test?.name || "Test"}</span>
                            {(r.summary?.healed ?? 0) > 0 && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/40 text-amber-500 gap-1 shrink-0"
                              >
                                <Wand2 className="h-3 w-3" /> {r.summary.healed} auto-healed
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.summary?.passed ?? 0}/{r.summary?.total ?? 0} steps · {r.duration_ms}
                            ms · {new Date(r.created_at).toLocaleString()}
                          </div>
                        </div>
                        {r.status === "failed" && (
                          <Button size="sm" variant="outline" onClick={() => analyzeRun(r)}>
                            <Brain className="h-3.5 w-3.5 mr-1" /> Analyze
                          </Button>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {(r.steps || []).map((s: any, i: number) => (
                          <div
                            key={i}
                            title={`${s.action || s.name} ${s.target || ""}${s.status === "healed" ? ` (healed from ${s.healed_from})` : ""}`}
                            className={`h-1.5 flex-1 min-w-[8px] rounded-full
                              ${s.status === "passed" ? "bg-success" : s.status === "healed" ? "bg-amber-500" : s.status === "failed" ? "bg-destructive" : "bg-muted"}`}
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
                              </div>
                            ))}
                        </div>
                      )}
                      {analysis?.runId === r.id && (
                        <div className="mt-4 border-t border-border pt-4">
                          <div className="flex items-center gap-2 text-xs text-primary-glow mb-2">
                            <Brain className="h-3.5 w-3.5" /> AI ROOT-CAUSE ANALYSIS
                          </div>
                          {analysisBusy ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
                            </div>
                          ) : (
                            <div className="prose prose-sm prose-invert max-w-none text-sm">
                              <ReactMarkdown>{analysis?.text || ""}</ReactMarkdown>
                            </div>
                          )}
                          {!analysisBusy && (
                            <Button
                              size="sm"
                              className="mt-3 bg-gradient-primary border-0"
                              onClick={() => {
                                const failedIdx = (r.steps || []).findIndex(
                                  (s: any) => s.status === "failed",
                                );
                                apiCall("/api/protected/run-test", {
                                  testId: r.test_id,
                                  resumeFromStep: failedIdx,
                                })
                                  .then(() => {
                                    toast.success("Resumed run");
                                    refresh();
                                  })
                                  .catch((e: any) => toast.error(e.message));
                              }}
                            >
                              <Play className="h-3.5 w-3.5 mr-1" /> Resume from failed step
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
