import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Wand2, Sparkles, Save, CircleDot } from "lucide-react";
import { locatorLabel } from "@/lib/locator";

export const Route = createFileRoute("/_authenticated/codegen")({
  head: () => ({ meta: [{ title: "Codegen — Testrify" }] }),
  component: Codegen,
});

const SAMPLE = `// Paste a recorded Playwright script (npx playwright codegen <url>).
// Testrify parses getByRole/getByLabel/etc. directly and hardens any brittle
// css/xpath locators into resilient ones.
await page.goto('https://example.com/login');
await page.getByLabel('Email').fill('test@example.com');
await page.getByLabel('Password').fill('secret');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.locator('#toast-2f9a').click();
await expect(page.getByText('Welcome back')).toBeVisible();`;

function Codegen() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [script, setScript] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [recordUrl, setRecordUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const [testName, setTestName] = useState("");
  const [newProjectName, setNewProjectName] = useState("");

  useEffect(() => {
    supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setProjects(data || []);
        setProjectId(data?.[0]?.id ?? "__new__");
      });
  }, []);

  const record = async () => {
    if (!/^https?:\/\//i.test(recordUrl.trim()))
      return toast.error("Enter a URL starting with http(s)://");
    setRecording(true);
    setResult(null);
    try {
      // Long-running: a real browser window opens on this machine; resolves when closed.
      const r = await apiCall<any>("/api/protected/record-codegen", { url: recordUrl.trim() });
      if (!r.script?.trim()) return toast.error("Nothing was recorded.");
      setScript(r.script);
      toast.success("Recording captured — review the script, then Convert to a resilient test.");
    } catch (e: any) {
      toast.error(e.message);
    }
    setRecording(false);
  };

  const convert = async () => {
    if (!script.trim()) return toast.error("Paste a script first.");
    setBusy(true);
    setResult(null);
    try {
      const r = await apiCall<any>("/api/protected/ai-codegen", { script });
      setResult(r);
      setTestName(r.name || "Recorded test"); // prefill, but the user can edit it
    } catch (e: any) {
      toast.error(e.message);
    }
    setBusy(false);
  };

  const save = async () => {
    if (!result) return toast.error("Convert a script first.");
    if (!testName.trim()) return toast.error("Give the test a name.");

    // Resolve the target project — either an existing one, or a new one to create.
    let targetProjectId = projectId;
    if (projectId === "__new__") {
      if (!newProjectName.trim()) return toast.error("Name the new project.");
      const { data: proj, error: pErr } = await supabase
        .from("projects")
        .insert({ owner_id: user!.id, name: newProjectName.trim() })
        .select()
        .single();
      if (pErr || !proj) return toast.error(pErr?.message || "Could not create project");
      targetProjectId = proj.id;
    }
    if (!targetProjectId) return toast.error("Pick or create a project.");

    const { data, error } = await supabase
      .from("tests")
      .insert({
        project_id: targetProjectId,
        owner_id: user!.id,
        name: testName.trim(),
        description: result.description,
        type: "browser",
        spec: { ...result, name: testName.trim() },
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    toast.success("Test saved");
    nav({ to: "/tests/$testId", params: { testId: data.id } });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Resilient Codegen</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Record a flow in a real browser (or paste a Playwright script). Testrify rewrites brittle
          locators into role/text/label-based ones that survive refactors.
        </p>
      </header>

      {/* Record a flow */}
      <section className="glass rounded-2xl p-6 shadow-card space-y-3">
        <Label className="text-xs text-muted-foreground flex items-center gap-1">
          <CircleDot className="h-3.5 w-3.5 text-destructive" /> RECORD A FLOW
        </Label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={recordUrl}
            onChange={(e) => setRecordUrl(e.target.value)}
            placeholder="https://your-app.com/login"
            className="bg-input/50 font-mono text-sm"
            onKeyDown={(e) => e.key === "Enter" && !recording && record()}
          />
          <Button disabled={recording} onClick={record} className="shrink-0">
            {recording ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Recording…
              </>
            ) : (
              <>
                <CircleDot className="h-4 w-4 mr-2" /> Record
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {recording
            ? "Recording… a browser + Playwright Inspector opened on this machine. Click around, then CLOSE the browser window — the captured steps appear here only after you close it."
            : "Opens a real Chromium window locally. Interact, then close it to bring the steps back here. (Live code shows in Playwright's Inspector meanwhile. Runs on the local server only.)"}
        </p>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="glass rounded-2xl p-6 shadow-card space-y-3">
          <Label className="text-xs text-muted-foreground">PASTE YOUR PLAYWRIGHT SCRIPT</Label>
          <Textarea
            rows={18}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            className="font-mono text-xs bg-input/50"
          />
          <Button
            disabled={busy}
            onClick={convert}
            className="bg-gradient-primary border-0 shadow-glow w-full"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Converting…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" /> Convert to resilient test
              </>
            )}
          </Button>
        </section>

        <section className="glass rounded-2xl p-6 shadow-card space-y-3 min-h-[300px]">
          <Label className="text-xs text-primary-glow flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> RESILIENT OUTPUT
          </Label>
          {!result ? (
            <div className="text-sm text-muted-foreground flex items-center justify-center h-64">
              Output will appear here.
            </div>
          ) : (
            <>
              <div>
                <div className="font-semibold">{result.name}</div>
                <div className="text-xs text-muted-foreground">{result.description}</div>
              </div>
              <div className="space-y-1.5 max-h-[320px] overflow-auto pr-1">
                {(result.steps || []).map((s: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 font-mono text-xs rounded-md bg-surface/40 px-2 py-1.5 border border-border"
                  >
                    <span className="text-muted-foreground w-4">{i + 1}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {s.action}
                    </Badge>
                    <span className="truncate flex-1 text-success">
                      {s.locator ? locatorLabel(s.locator) : s.target}
                    </span>
                    {s.value && (
                      <span className="text-muted-foreground truncate max-w-[120px]">
                        "{s.value}"
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="space-y-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <Label className="text-xs">TEST NAME</Label>
                  <Input
                    value={testName}
                    onChange={(e) => setTestName(e.target.value)}
                    placeholder="e.g. MUI — open Installation"
                    className="bg-input/50 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">PROJECT</Label>
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full bg-input/50 border border-border rounded-md px-2 py-1.5 text-sm"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    <option value="__new__">＋ New project…</option>
                  </select>
                  {projectId === "__new__" && (
                    <Input
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="New project name"
                      className="bg-input/50 text-sm"
                    />
                  )}
                </div>
                <Button onClick={save} className="w-full bg-gradient-primary border-0">
                  <Save className="h-4 w-4 mr-2" /> Save as test
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
