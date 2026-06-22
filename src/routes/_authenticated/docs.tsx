import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  Wand2,
  GitBranch,
  Eye,
  Repeat,
  ShieldCheck,
  Clock,
  Database,
  FileSpreadsheet,
  Link2,
  Sparkles,
  Globe,
  FileCode,
  Plug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/docs")({
  head: () => ({ meta: [{ title: "Docs — Testrify" }] }),
  component: Docs,
});

type Section = { icon: any; title: string; blurb: string; items: string[] };

const SECTIONS: Section[] = [
  {
    icon: Wand2,
    title: "Record & self-heal",
    blurb:
      "Capture a flow on a real browser, then keep it passing when the page changes underneath it.",
    items: [
      "Record a flow on any URL in Codegen → converted to resilient role / text / test-id selectors.",
      "When a locator breaks, Testrify tries stored fallbacks, then an AI heal, and continues from the failed step — not a full restart.",
      "“Harden locators” validates each selector against the live page; “data-testid advice” flags the brittle ones.",
    ],
  },
  {
    icon: GitBranch,
    title: "Test logic",
    blurb: "Real control flow — your tests can branch, repeat, and adapt, not just run top to bottom.",
    items: [
      "Variables: reference {{name}} in any locator, value, or URL.",
      "Secret variables: encrypted at rest, masked in run records, never sent to the AI.",
      "Per-step conditions (“run only if …”), if / else blocks, and loops (repeat N times / repeat while) with hard safety caps.",
    ],
  },
  {
    icon: Eye,
    title: "Visual regression",
    blurb: "Catch unintended visual changes, pixel for pixel.",
    items: [
      "Add a screenshot step (viewport, full page, or one element).",
      "First run stores a baseline; later runs pixel-diff against it and fail when >0.5% of pixels change.",
      "View baseline / actual / diff side-by-side, promote a new baseline, and old captures are auto-pruned.",
    ],
  },
  {
    icon: Repeat,
    title: "Reliability & performance",
    blurb: "Flaky-resistant, never-hang, and fast across a whole suite.",
    items: [
      "Retries (0–3): a failed run is re-tried with a fresh browser; passes if any attempt passes.",
      "Run time budget: a run stops cleanly instead of hanging (shared across retries).",
      "“Run all”: every browser test in a project runs in parallel, bounded by concurrency limits.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Security",
    blurb: "Hardened for a shared/cloud deployment from the ground up.",
    items: [
      "Secret values encrypted at rest (AES-256-GCM); the key never leaves the server.",
      "SSRF protection: recorded and API-test URLs are resolved and refused if they point at private/internal addresses.",
      "Per-user and global concurrency caps so no one can exhaust the runner.",
    ],
  },
  {
    icon: Clock,
    title: "Scheduling & insights",
    blurb: "Run unattended and learn from the results.",
    items: [
      "Schedule a test on a 24 hour-time, day-of-week basis.",
      "Insights surfaces flaky hotspots and pass/fail trends across recent runs.",
    ],
  },
  {
    icon: Globe,
    title: "Watch & cross-browser",
    blurb: "See it run, on the engine your users actually use.",
    items: [
      "“Watch” opens a real browser and runs in slow-motion so you can see every step (local runner).",
      "Pick the engine: Chromium, Firefox, or WebKit (Safari) — plus real Chrome / Edge where installed.",
      "Headless and fast by default; flip Watch on per run when you want eyes on it.",
    ],
  },
  {
    icon: FileCode,
    title: "Export & local CLI",
    blurb: "Take your tests with you — no lock-in.",
    items: [
      "Export any test to clean, human-readable native Playwright TypeScript (.spec.ts).",
      "Run the testrify CLI to auto-heal broken locators on your machine, so you push code that already passes CI.",
      "Secret values export as process.env references — never baked into the file.",
    ],
  },
  {
    icon: Plug,
    title: "Integrations",
    blurb: "Wire Testrify into the tools your team already uses.",
    items: [
      "File a failed run straight into Jira as a ticket — summary, error, and steps prefilled.",
      "Your Jira API token is encrypted at rest and never sent to the browser.",
    ],
  },
];

const DDT_SOURCES = [
  {
    icon: FileSpreadsheet,
    label: "Spreadsheet — CSV / Excel",
    how: "Export to CSV and upload or paste. Zero setup, works with any spreadsheet.",
  },
  {
    icon: Link2,
    label: "Google Sheets (live)",
    how: "Publish the sheet to the web as CSV and paste the URL — refreshes on each run, no auth.",
  },
  {
    icon: Database,
    label: "Database via REST — Airtable / Supabase / any API",
    how: "Point at a REST endpoint that returns rows. Airtable is the easiest free no-code option; Supabase is the easiest free SQL database (both give you an API for free).",
  },
];

function Docs() {
  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="h-7 w-7 text-primary-glow" /> Docs
        </h1>
        <p className="text-muted-foreground mt-1">
          Testrify is AI-native test automation on a real Playwright engine: record a flow,
          self-heal when the page changes, and run it with real logic, visual checks, and
          data-driven inputs.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {SECTIONS.map((s) => (
          <section key={s.title} className="glass rounded-xl p-5 shadow-card">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <s.icon className="h-5 w-5 text-primary-glow" /> {s.title}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{s.blurb}</p>
            <ul className="mt-3 space-y-1.5">
              {s.items.map((it) => (
                <li key={it} className="text-sm flex gap-2">
                  <span className="text-primary-glow mt-0.5">•</span>
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* Featured: Data-Driven Testing */}
      <section className="glass rounded-xl p-6 shadow-card border border-primary/30">
        <h2 className="font-semibold text-xl flex items-center gap-2">
          <Database className="h-5 w-5 text-primary-glow" /> Data-Driven Testing
          <Badge variant="outline" className="border-primary/40 text-primary-glow gap-1">
            <Sparkles className="h-3 w-3" /> Live
          </Badge>
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Drive one test across many rows of data — from a <strong>spreadsheet</strong> or a{" "}
          <strong>database</strong>, your choice. Each row’s columns bind to your{" "}
          <code className="text-xs">{"{{variables}}"}</code>, and Testrify runs the test once per
          row in parallel. The <strong>Data-drive wizard</strong> turns a recorded test’s values
          into <code className="text-xs">{"{{columns}}"}</code> in one click, and you can refresh
          the rows from the source anytime.
        </p>
        <div className="mt-4 grid gap-3">
          {DDT_SOURCES.map((src) => (
            <div
              key={src.label}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface/40 p-3"
            >
              <src.icon className="h-5 w-5 text-primary-glow mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-sm">{src.label}</div>
                <div className="text-sm text-muted-foreground">{src.how}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Every source is read as tabular rows over HTTPS, so you never hand Testrify raw database
          credentials.
        </p>
      </section>
    </div>
  );
}
