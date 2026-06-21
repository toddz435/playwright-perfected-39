import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiCall } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Save, KeyRound, CheckCircle2, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({ meta: [{ title: "Integrations — Testrify" }] }),
  component: Integrations,
});

// `jira_config` isn't in the generated Supabase types yet — query via a loose handle.
const db = supabase as any;

function Integrations() {
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [connected, setConnected] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [token, setToken] = useState(""); // write-only: never loaded
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      // Never select `token` (the encrypted credential is write-only).
      const { data, error } = await db
        .from("jira_config")
        .select("base_url,email,project_key")
        .maybeSingle();
      if (error) {
        const missing =
          (error as any).code === "42P01" || /does not exist|relation/i.test(error.message || "");
        if (missing) setNotSetUp(true);
        else toast.error(error.message || "Failed to load Jira config");
      } else if (data) {
        setBaseUrl(data.base_url || "");
        setEmail(data.email || "");
        setProjectKey(data.project_key || "");
        setConnected(true);
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!baseUrl.trim() || !email.trim() || !projectKey.trim())
      return toast.error("Base URL, email, and project key are required.");
    if (!connected && !token.trim()) return toast.error("Enter your Jira API token.");
    setSaving(true);
    try {
      await apiCall("/api/protected/save-jira-config", {
        baseUrl: baseUrl.trim(),
        email: email.trim(),
        projectKey: projectKey.trim(),
        token, // blank keeps the stored token
      });
      toast.success("Jira connection saved");
      setToken("");
      setConnected(true);
    } catch (e: any) {
      toast.error(e.message);
    }
    setSaving(false);
  };

  if (loading)
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect external tools. File a failed run straight into Jira as a ticket.
        </p>
      </div>

      {notSetUp ? (
        <div className="glass rounded-xl p-6 text-sm">
          The <code>jira_config</code> table isn&apos;t set up yet. Apply the migration{" "}
          <code>supabase/migrations/20260621000000_jira_config.sql</code> (via Lovable or the
          Supabase SQL editor), then reload.
        </div>
      ) : (
        <section className="glass rounded-2xl p-6 shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Jira (Cloud)</h2>
            {connected && (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Connected
              </span>
            )}
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">Base URL</span>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-company.atlassian.net"
                className="bg-input/50 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Account email</span>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="bg-input/50 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Project key</span>
              <Input
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                placeholder="BUG"
                className="bg-input/50 font-mono text-sm max-w-[160px]"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <KeyRound className="h-3 w-3" /> API token
              </span>
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={connected ? "Leave blank to keep the saved token" : "Atlassian API token"}
                className="bg-input/50 font-mono text-sm"
              />
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-primary-glow hover:opacity-80 inline-flex items-center gap-1 mt-1"
              >
                Create a token <ExternalLink className="h-3 w-3" />
              </a>
            </label>
          </div>

          <p className="text-xs text-muted-foreground">
            Your token is encrypted at rest and never shown again. Tickets are filed from a failed
            run via the “Create Jira ticket” button on the run.
          </p>

          <Button onClick={save} disabled={saving} className="bg-gradient-primary border-0">
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save connection
          </Button>
        </section>
      )}
    </div>
  );
}
