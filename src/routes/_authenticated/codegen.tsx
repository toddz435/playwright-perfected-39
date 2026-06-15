import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Wand2, Sparkles, Save } from "lucide-react";
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

  useEffect(() => {
    supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setProjects(data || []);
        if (data?.[0]) setProjectId(data[0].id);
      });
  }, []);

  const convert = async () => {
    if (!script.trim()) return toast.error("Paste a script first.");
    setBusy(true);
    setResult(null);
    try {
      const r = await apiCall<any>("/api/protected/ai-codegen", { script });
      setResult(r);
    } catch (e: any) {
      toast.error(e.message);
    }
    setBusy(false);
  };

  const save = async () => {
    if (!result || !projectId) return toast.error("Pick a project.");
    const { data, error } = await supabase
      .from("tests")
      .insert({
        project_id: projectId,
        owner_id: user!.id,
        name: result.name,
        description: result.description,
        type: "browser",
        spec: result,
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
          Paste a recorded Playwright script. Testrify rewrites brittle locators into
          role/text/label-based ones that survive refactors.
        </p>
      </header>

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
              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="text-xs">SAVE TO PROJECT</Label>
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
                </select>
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
