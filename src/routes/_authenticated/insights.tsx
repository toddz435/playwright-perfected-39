import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Wand2, CheckCircle2, XCircle, Activity } from "lucide-react";
import { flakyHotspots, runStats, type Hotspot, type RunStats } from "@/lib/insights";

export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({ meta: [{ title: "Insights — Testrify" }] }),
  component: Insights,
});

function Insights() {
  const [loading, setLoading] = useState(true);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [testNames, setTestNames] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data: runs } = await supabase
        .from("runs")
        .select("test_id,status,created_at,steps")
        .order("created_at", { ascending: false })
        .limit(300);
      const { data: tests } = await supabase.from("tests").select("id,name");
      setTestNames(Object.fromEntries((tests || []).map((t) => [t.id, t.name])));
      const rows = (runs || []) as any[];
      setHotspots(flakyHotspots(rows));
      setStats(runStats(rows));
      setLoading(false);
    })();
  }, []);

  if (loading)
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  const passRate = stats && stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <TrendingUp className="h-6 w-6" /> Insights
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Where your tests are fragile — and how often auto-heal is saving them. Based on the last
          300 runs.
        </p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Activity className="h-4 w-4" />} label="Runs" value={stats?.total ?? 0} />
        <Stat
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          label="Pass rate"
          value={`${passRate}%`}
        />
        <Stat
          icon={<Wand2 className="h-4 w-4 text-amber-500" />}
          label="Auto-heals"
          value={stats?.heals ?? 0}
        />
        <Stat
          icon={<XCircle className="h-4 w-4 text-destructive" />}
          label="Failed runs"
          value={stats?.failed ?? 0}
        />
      </div>

      {/* Flaky hotspots */}
      <section>
        <h2 className="font-semibold text-lg mb-1 flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-amber-500" /> Flaky locators
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Locators that have needed healing most often — your best candidates to stabilize (e.g. add
          a data-testid).
        </p>
        {hotspots.length === 0 ? (
          <div className="text-sm text-success glass rounded-xl p-6">
            No flaky locators in recent runs — nothing has needed healing. 🎉
          </div>
        ) : (
          <div className="grid gap-2">
            {hotspots.map((h) => (
              <div
                key={`${h.testId}-${h.locator}`}
                className="glass rounded-xl p-4 shadow-card flex items-center gap-4"
              >
                <Badge variant="outline" className="border-amber-500/40 text-amber-500 shrink-0">
                  {h.heals}× healed
                </Badge>
                <div className="flex-1 min-w-0 font-mono text-xs">
                  <div className="truncate">{h.locator}</div>
                  {h.lastHealedTo && (
                    <div className="text-muted-foreground truncate">
                      now → <span className="text-success">{h.lastHealedTo}</span>
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                  {h.fallback > 0 && <span>{h.fallback} fallback</span>}
                  {h.fallback > 0 && h.ai > 0 && <span> · </span>}
                  {h.ai > 0 && <span>{h.ai} AI</span>}
                </div>
                <Link
                  to="/tests/$testId"
                  params={{ testId: h.testId }}
                  className="text-xs text-primary-glow hover:underline shrink-0"
                >
                  {testNames[h.testId] || "test"} →
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: any }) {
  return (
    <div className="glass rounded-xl p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
