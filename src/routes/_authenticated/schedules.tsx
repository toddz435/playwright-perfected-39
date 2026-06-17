import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Clock } from "lucide-react";
import { buildCronFromLocal } from "@/lib/cron";

export const Route = createFileRoute("/_authenticated/schedules")({
  head: () => ({ meta: [{ title: "Schedules — Testrify" }] }),
  component: Schedules,
});

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PRESETS = [
  { label: "Every 5 min", cron: "*/5 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
];

function Schedules() {
  const { user } = useAuth();
  const [tests, setTests] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testId, setTestId] = useState("");
  const [cron, setCron] = useState("0 9 * * *");
  const [timeLocal, setTimeLocal] = useState("09:00"); // 24h local time
  const [days, setDays] = useState<number[]>([]); // local weekdays; [] = every day
  // True once the user hand-edits the cron (Advanced box or a preset). While dirty, the
  // picker stops overwriting cron, and the summary shows "custom" instead of lying.
  const [cronDirty, setCronDirty] = useState(false);

  // Rebuild the (UTC) cron from the local time + chosen days, unless the user has taken
  // manual control. Runs client-side so the timezone offset is the user's, not the SSR
  // server's.
  useEffect(() => {
    if (!cronDirty) setCron(buildCronFromLocal(timeLocal, days, new Date().getTimezoneOffset()));
  }, [timeLocal, days, cronDirty]);
  // Using the picker re-asserts picker control.
  const onTimeChange = (v: string) => {
    setCronDirty(false);
    setTimeLocal(v);
  };
  const toggleDay = (d: number) => {
    setCronDirty(false);
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  };

  const refresh = async () => {
    const [{ data: ts }, { data: ss }] = await Promise.all([
      supabase.from("tests").select("*").order("created_at", { ascending: false }),
      supabase.from("schedules").select("*").order("created_at", { ascending: false }),
    ]);
    setTests(ts || []);
    setSchedules(ss || []);
    if (!testId && ts?.[0]) setTestId(ts[0].id);
    setLoading(false);
  };
  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line

  const create = async () => {
    if (!testId) return toast.error("Pick a test.");
    if (!cronDirty && !timeLocal) return toast.error("Pick a time (or set a cron under Advanced).");
    if (!cron) return toast.error("Set a schedule time or cron.");
    const { error } = await supabase.from("schedules").insert({
      owner_id: user!.id,
      test_id: testId,
      cron,
      enabled: true,
      next_run_at: new Date().toISOString(),
    });
    if (error) return toast.error(error.message);
    toast.success("Schedule created");
    refresh();
  };

  const toggle = async (id: string, enabled: boolean) => {
    await supabase.from("schedules").update({ enabled }).eq("id", id);
    refresh();
  };
  const remove = async (id: string) => {
    await supabase.from("schedules").delete().eq("id", id);
    toast.success("Removed");
    refresh();
  };

  if (loading)
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Clock className="h-6 w-6" /> Schedules
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Run any test on a cron schedule. Testrify checks every minute and triggers due runs
          automatically.
        </p>
      </header>

      <section className="glass rounded-2xl p-6 shadow-card space-y-4">
        <h2 className="font-semibold">New schedule</h2>
        {tests.length === 0 ? (
          <div className="text-sm text-muted-foreground">Create a test first to schedule it.</div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Test</Label>
                <select
                  value={testId}
                  onChange={(e) => setTestId(e.target.value)}
                  className="w-full bg-input/50 border border-border rounded-md px-3 py-2 text-sm"
                >
                  {tests.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.type})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Run at (24-hour, your time)</Label>
                <Input
                  type="time"
                  value={timeLocal}
                  onChange={(e) => onTimeChange(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Days</Label>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map((lbl, d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`text-xs px-3 py-1 rounded-full border transition ${days.includes(d) ? "bg-gradient-primary text-primary-foreground border-transparent" : "border-border hover:bg-surface-elevated"}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {cronDirty ? (
                  <>
                    Custom cron: <span className="font-mono">{cron}</span> (UTC)
                  </>
                ) : !timeLocal ? (
                  "Pick a time."
                ) : (
                  <>
                    {days.length === 0
                      ? "Every day"
                      : "On " +
                        days
                          .slice()
                          .sort((a, b) => a - b)
                          .map((d) => DAY_LABELS[d])
                          .join(", ")}{" "}
                    at {timeLocal} your time · cron <span className="font-mono">{cron}</span> (UTC).
                    Fixed UTC time — may shift ±1h across a DST change.
                  </>
                )}
              </p>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Advanced: edit cron directly
              </summary>
              <Input
                value={cron}
                onChange={(e) => {
                  setCronDirty(true);
                  setCron(e.target.value);
                }}
                className="font-mono mt-2"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.cron}
                    onClick={() => {
                      setCronDirty(true);
                      setCron(p.cron);
                    }}
                    className="px-3 py-1 rounded-full border border-border hover:bg-surface-elevated transition"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </details>
            <Button
              onClick={create}
              disabled={!cronDirty && !timeLocal}
              className="bg-gradient-primary border-0"
            >
              <Plus className="h-4 w-4 mr-1" /> Create schedule
            </Button>
          </>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">Active schedules</h2>
        {schedules.length === 0 ? (
          <div className="text-sm text-muted-foreground glass rounded-xl p-6">
            No schedules yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {schedules.map((s) => {
              const t = tests.find((x) => x.id === s.test_id);
              return (
                <div
                  key={s.id}
                  className="glass rounded-xl p-4 flex items-center gap-4 shadow-card"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate">{t?.name || "Unknown test"}</div>
                      <Badge variant="outline" className="text-xs">
                        {t?.type}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-1">{s.cron}</div>
                    <div className="text-xs text-muted-foreground">
                      Last run: {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "—"}
                    </div>
                  </div>
                  <Switch checked={s.enabled} onCheckedChange={(v) => toggle(s.id, v)} />
                  <Button variant="ghost" size="sm" onClick={() => remove(s.id)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
