import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRunTest } from "@/hooks/use-run-test";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, Loader2, Play, CheckCircle2, XCircle, FlaskConical } from "lucide-react";

export const Route = createFileRoute("/_authenticated/api-tester")({
  head: () => ({ meta: [{ title: "API Tester — Vector QA" }] }),
  component: ApiTester,
});

function ApiTester() {
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [suite, setSuite] = useState<any | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [run, setRun] = useState<any | null>(null);
  const [project, setProject] = useState<any | null>(null);

  const { runningId, runTest } = useRunTest({
    onComplete: (r) => setRun(r),
  });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("projects").select("*").limit(1).maybeSingle();
      if (data) setProject(data);
      else {
        const { data: p } = await supabase.from("projects").insert({ owner_id: user!.id, name: "API Tests" }).select().single();
        setProject(p);
      }
    })();
  }, [user]);

  const generate = async () => {
    if (!input.trim()) return;
    setBusy(true); setRun(null); setSuite(null); setTestId(null);
    try {
      const s = await apiCall<any>("/api/protected/ai-generate-api-suite", { input });
      setSuite(s);
      const { data, error } = await supabase.from("tests").insert({
        project_id: project!.id, owner_id: user!.id, name: s.name, description: s.description, type: "api", spec: s,
      }).select().single();
      if (error) throw error;
      setTestId(data.id);
      toast.success(`Suite generated · ${s.requests.length} requests`);
    } catch (e: any) { toast.error(e.message); }
    setBusy(false);
  };

  const runSuite = async () => {
    if (!testId) return;
    setRun(null);
    await runTest(testId);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <div className="inline-flex items-center gap-2 text-xs text-primary-glow mb-2"><FlaskConical className="h-3.5 w-3.5" /> API TESTER</div>
        <h1 className="text-3xl font-bold tracking-tight">So simple grandma can test your APIs.</h1>
        <p className="text-muted-foreground text-sm mt-1">Paste a curl command, an OpenAPI URL, or just describe what you want to test. AI builds the suite.</p>
      </header>

      <section className="glass rounded-2xl p-6 shadow-card">
        <Label className="mb-2 block">Paste curl, OpenAPI URL, or describe</Label>
        <Textarea rows={5} className="bg-input/50 font-mono text-sm" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={`curl https://api.example.com/users -H "Authorization: Bearer xyz"\n\n— or —\n\nTest that GET https://jsonplaceholder.typicode.com/posts/1 returns status 200 with a "title" field`} />
        <Button disabled={busy} onClick={generate} className="bg-gradient-primary border-0 mt-3">
          {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4 mr-2" /> Generate suite</>}
        </Button>
      </section>

      {suite && (
        <section className="glass rounded-2xl p-6 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-lg">{suite.name}</h2>
              <p className="text-sm text-muted-foreground">{suite.description}</p>
            </div>
            <Button disabled={!!runningId && runningId === testId} onClick={runSuite} className="bg-gradient-primary border-0">
              {runningId === testId && !!runningId ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running…</> : <><Play className="h-4 w-4 mr-2" /> Run suite</>}
            </Button>
          </div>
          <div className="space-y-3">
            {suite.requests.map((r: any, i: number) => {
              const stepRun = run?.steps?.find((s: any) => s.idx === i);
              return (
                <div key={i} className="rounded-lg border border-border p-3 bg-surface/30">
                  <div className="flex items-center gap-2 mb-2">
                    {stepRun ? (stepRun.status === "passed" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />) : <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />}
                    <Badge variant="outline" className="font-mono text-xs">{r.method}</Badge>
                    <code className="text-xs text-muted-foreground truncate flex-1">{r.url}</code>
                    {stepRun?.duration_ms && <span className="text-xs text-muted-foreground">{stepRun.duration_ms}ms</span>}
                  </div>
                  <div className="text-sm font-medium mb-1">{r.name}</div>
                  <ul className="text-xs space-y-1 mt-2">
                    {r.assertions.map((a: any, j: number) => {
                      const check = stepRun?.checks?.[j];
                      return (
                        <li key={j} className="flex items-center gap-2">
                          {check ? (check.ok ? <CheckCircle2 className="h-3 w-3 text-success" /> : <XCircle className="h-3 w-3 text-destructive" />) : <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />}
                          <span className={check && !check.ok ? "text-destructive" : "text-muted-foreground"}>{a.human}</span>
                          {check && !check.ok && <span className="text-xs text-muted-foreground">(got {check.actual})</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
