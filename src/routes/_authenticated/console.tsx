import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Activity, Play, CheckCircle2, XCircle, Loader2, Clock, Zap,
  TrendingUp, AlertTriangle, ArrowRight, Brain,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/console")({
  head: () => ({ meta: [{ title: "Live Console — Testrify" }] }),
  component: Console,
});

function Console() {
  const [tests, setTests] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [activeProject, setActiveProject] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("activeProject") : null
  );
  const pollRef = useRef<number | null>(null);

  const refresh = async () => {
    const [{ data: ts }, { data: rs }] = await Promise.all([
      supabase.from("tests").select("*").order("created_at", { ascending: false }),
      supabase.from("runs").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    setTests(ts || []); setRuns(rs || []); setLoading(false);
  };

  useEffect(() => {
    refresh();
    const onProj = (e: Event) => setActiveProject((e as CustomEvent).detail);
    window.addEventListener("activeProjectChange", onProj);

    // Realtime subscription on runs
    const channel = supabase.channel("console-runs")
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, () => refresh())
      .subscribe();

    // Soft poll fallback every 4s
    pollRef.current = window.setInterval(refresh, 4000);
    return () => {
      window.removeEventListener("activeProjectChange", onProj);
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const runTest = async (testId: string) => {
    setRunningIds(s => new Set(s).add(testId));
    try {
      const { run } = await apiCall<any>("/api/protected/run-test", { testId });
      toast[run.status === "passed" ? "success" : "error"](`Run ${run.status}`);
    } catch (e: any) { toast.error(e.message); }
    finally {
      setRunningIds(s => { const n = new Set(s); n.delete(testId); return n; });
      refresh();
    }
  };

  const filteredTests = activeProject ? tests.filter(t => t.project_id === activeProject) : tests;
  const filteredRuns = activeProject
    ? runs.filter(r => filteredTests.some(t => t.id === r.test_id))
    : runs;

  // Stats
  const last24h = filteredRuns.filter(r => new Date(r.created_at).getTime() > Date.now() - 86400000);
  const passed = last24h.filter(r => r.status === "passed").length;
  const failed = last24h.filter(r => r.status === "failed").length;
  const passRate = last24h.length ? Math.round((passed / last24h.length) * 100) : 0;
  const avgDuration = last24h.length
    ? Math.round(last24h.reduce((s, r) => s + (r.duration_ms || 0), 0) / last24h.length)
    : 0;

  if (loading) return <div className="p-12 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse-glow" />
            <h1 className="text-2xl font-bold tracking-tight">Live Console</h1>
          </div>
          <p className="text-sm text-muted-foreground">Real-time test execution feed across your cloud runners.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/dashboard"><Zap className="h-3.5 w-3.5 mr-1.5" /> Author test</Link></Button>
          <Button asChild size="sm" className="bg-gradient-primary border-0"><Link to="/codegen">Codegen <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Link></Button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={TrendingUp} label="Pass rate · 24h" value={`${passRate}%`} accent={passRate >= 90 ? "success" : passRate >= 70 ? "warning" : "destructive"} />
        <Stat icon={Activity} label="Runs · 24h" value={String(last24h.length)} />
        <Stat icon={AlertTriangle} label="Failures · 24h" value={String(failed)} accent={failed > 0 ? "destructive" : undefined} />
        <Stat icon={Clock} label="Avg duration" value={avgDuration ? `${avgDuration}ms` : "—"} />
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        {/* Live feed */}
        <section className="glass rounded-2xl shadow-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary-glow" />
              <h2 className="font-semibold text-sm">Run feed</h2>
              <Badge variant="outline" className="text-[10px] font-mono">LIVE</Badge>
            </div>
            <span className="text-xs text-muted-foreground">{filteredRuns.length} runs</span>
          </div>
          {filteredRuns.length === 0 ? (
            <div className="p-12 text-center">
              <Activity className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground mb-4">No runs yet. Kick one off →</p>
              <Button asChild size="sm" className="bg-gradient-primary border-0"><Link to="/dashboard">Go to Tests</Link></Button>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[70vh] overflow-auto">
              {filteredRuns.map(r => {
                const test = tests.find(t => t.id === r.test_id);
                return (
                  <Link key={r.id} to="/tests/$testId" params={{ testId: r.test_id }}
                    className="flex items-start gap-3 p-4 hover:bg-surface-elevated/40 transition">
                    <div className="mt-0.5">
                      {r.status === "passed" ? <CheckCircle2 className="h-4 w-4 text-success" />
                        : r.status === "failed" ? <XCircle className="h-4 w-4 text-destructive" />
                        : <Loader2 className="h-4 w-4 animate-spin text-primary-glow" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm truncate">{test?.name || "Test"}</span>
                        <Badge variant="outline" className="text-[10px]">{test?.type || "browser"}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.summary?.passed ?? 0}/{r.summary?.total ?? 0} steps · {r.duration_ms ?? 0}ms ·{" "}
                        {new Date(r.created_at).toLocaleTimeString()}
                      </div>
                      <div className="mt-2 flex gap-0.5">
                        {(r.steps || []).map((s: any, i: number) => (
                          <div key={i} title={`${s.action || s.name || ""} ${s.target || ""}`}
                            className={`h-1 flex-1 min-w-[6px] rounded-full
                              ${s.status === "passed" ? "bg-success"
                                : s.status === "failed" ? "bg-destructive"
                                : s.status === "running" ? "bg-primary-glow animate-pulse"
                                : "bg-muted"}`} />
                        ))}
                      </div>
                    </div>
                    {r.status === "failed" && (
                      <Brain className="h-3.5 w-3.5 text-primary-glow shrink-0 mt-0.5" />
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Quick run sidebar */}
        <aside className="space-y-3">
          <div className="glass rounded-2xl shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h2 className="font-semibold text-sm flex items-center gap-2"><Play className="h-3.5 w-3.5" /> Quick run</h2>
            </div>
            {filteredTests.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No tests in this project yet.
                <div className="mt-3"><Button asChild size="sm" variant="outline"><Link to="/dashboard">Create one</Link></Button></div>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[60vh] overflow-auto">
                {filteredTests.slice(0, 20).map(t => (
                  <div key={t.id} className="p-3 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{t.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {t.spec?.steps?.length ?? t.spec?.requests?.length ?? 0} steps · {t.type}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" disabled={runningIds.has(t.id)}
                      onClick={() => runTest(t.id)}
                      className="h-7 px-2">
                      {runningIds.has(t.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: "success" | "warning" | "destructive" }) {
  const color = accent === "success" ? "text-success"
    : accent === "warning" ? "text-warning"
    : accent === "destructive" ? "text-destructive"
    : "text-foreground";
  return (
    <div className="glass rounded-xl p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`text-2xl font-bold tracking-tight ${color}`}>{value}</div>
    </div>
  );
}
