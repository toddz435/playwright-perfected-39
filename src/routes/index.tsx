import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Zap, Shield, Workflow, Brain, RotateCcw, FlaskConical, Bot, CheckCircle2, Github } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Testrify — AI-Native Test Automation Built on Playwright" },
      { name: "description", content: "Resilient browser & API testing powered by AI. Resume from any failed step. No flaky selectors. So simple grandma can test your APIs." },
      { property: "og:title", content: "Testrify — AI-Native Test Automation" },
      { property: "og:description", content: "Resilient browser & API testing powered by AI. Resume from any failed step." },
    ],
  }),
  component: Landing,
});

function Feature({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="glass rounded-2xl p-6 shadow-card hover:shadow-glow transition-shadow">
      <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center mb-4 shadow-glow">
        <Icon className="h-5 w-5 text-primary-foreground" />
      </div>
      <h3 className="font-semibold text-lg mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
      <div className="absolute inset-0 grid-bg pointer-events-none opacity-40" />

      {/* Nav */}
      <header className="relative z-10 max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
        <Logo />
        <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition">Features</a>
          <a href="#how" className="hover:text-foreground transition">How it works</a>
          <a href="#pricing" className="hover:text-foreground transition">Pricing</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground transition">Sign in</Link>
          <Button asChild size="sm" className="bg-gradient-primary border-0 shadow-glow hover:opacity-90">
            <Link to="/signup">Start free <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border glass px-3 py-1 text-xs text-muted-foreground mb-6">
          <Sparkles className="h-3 w-3 text-primary-glow" />
          <span>AI-native QA. Built on Playwright. Designed for humans.</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
          Quality is our <span className="text-gradient">Priority</span>.
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Testrify fixes everything that's annoying about Playwright. Resilient selectors, resumable runs, AI-authored tests, API testing your grandma could do.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="bg-gradient-primary border-0 shadow-glow text-base h-12 px-6">
            <Link to="/signup">Start testing free <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-6 border-border glass">
            <a href="#features">See what's inside</a>
          </Button>
        </div>

        {/* Hero card mock */}
        <div className="mt-20 mx-auto max-w-5xl">
          <div className="glass rounded-2xl shadow-elevated overflow-hidden border border-border">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface/50">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                <div className="h-2.5 w-2.5 rounded-full bg-warning/60" />
                <div className="h-2.5 w-2.5 rounded-full bg-success/60" />
              </div>
              <div className="text-xs text-muted-foreground font-mono ml-3">testrify.app/runs/checkout-flow</div>
            </div>
            <div className="grid md:grid-cols-3 gap-0">
              <div className="md:col-span-2 p-6 space-y-2 text-left">
                {[
                  { s: "passed", t: "Open homepage", d: "1.2s" },
                  { s: "passed", t: "Click 'Sign in' button", d: "240ms" },
                  { s: "passed", t: "Fill email + password", d: "180ms" },
                  { s: "passed", t: "Add product to cart", d: "1.4s" },
                  { s: "failed", t: "Verify cart total = $42.99", d: "—" },
                  { s: "queued", t: "Proceed to checkout", d: "—" },
                ].map((step, i) => (
                  <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2 font-mono text-sm
                    ${step.s === "failed" ? "bg-destructive/10 border border-destructive/30" :
                      step.s === "passed" ? "bg-success/5" : "bg-muted/30 text-muted-foreground"}`}>
                    <div className={`h-2 w-2 rounded-full
                      ${step.s === "passed" ? "bg-success" : step.s === "failed" ? "bg-destructive animate-pulse-glow" : "bg-muted-foreground/40"}`} />
                    <span className="flex-1 text-left">{step.t}</span>
                    <span className="text-xs text-muted-foreground">{step.d}</span>
                  </div>
                ))}
              </div>
              <div className="border-t md:border-t-0 md:border-l border-border bg-surface/30 p-6 text-left">
                <div className="flex items-center gap-2 text-xs text-primary-glow mb-2">
                  <Brain className="h-3.5 w-3.5" /> AI ANALYSIS
                </div>
                <p className="text-sm leading-relaxed mb-4">
                  Cart total mismatch — expected <span className="font-mono text-foreground">$42.99</span>, found <span className="font-mono text-warning">$45.99</span>. Likely the new $3 shipping fee added Tuesday.
                </p>
                <div className="text-xs text-muted-foreground mb-3">SUGGESTED FIX</div>
                <div className="font-mono text-xs glass rounded-md p-3 leading-relaxed">
                  <span className="text-muted-foreground">- expect</span>(total).<span className="text-primary-glow">toBe</span>(<span className="text-warning">"$42.99"</span>)<br />
                  <span className="text-success">+ expect</span>(total).<span className="text-primary-glow">toBe</span>(<span className="text-warning">"$45.99"</span>)
                </div>
                <Button size="sm" className="mt-4 w-full bg-gradient-primary border-0">
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Apply & resume run
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <div className="text-sm text-primary-glow font-medium mb-3">EVERYTHING PLAYWRIGHT SHOULD'VE BEEN</div>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Built for the way QA actually works.</h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          <Feature icon={Shield} title="Resilient selectors that heal themselves" body="No more div[data-id='abc-123-xyz']. Codegen produces role/text/semantic locators that survive refactors. AI heals brittle selectors automatically." />
          <Feature icon={RotateCcw} title="Resume from any failed step" body="A test fails on step 14? Fix it and resume from step 14 — not square one. State is checkpointed at every step." />
          <Feature icon={Brain} title="AI-authored tests in plain English" body='"Log in as admin and verify the dashboard loads with 3 widgets." Testrify generates the full test, locators included.' />
          <Feature icon={FlaskConical} title="API testing grandma can do" body="Paste a curl command or an OpenAPI URL. AI builds a complete test suite with assertions. Click run." />
          <Feature icon={Bot} title="AI failure analysis on every run" body="When a step fails, AI explains why, points at the likely cause, and proposes a one-click fix." />
          <Feature icon={Workflow} title="No more async/sync hell" body="Testrify's runtime handles awaits, retries, and timing for you. You write what you want — we figure out when." />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative z-10 max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <div className="text-sm text-primary-glow font-medium mb-3">HOW IT WORKS</div>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight">From idea to passing test in 60 seconds.</h2>
        </div>
        <div className="space-y-4">
          {[
            { n: "01", t: "Describe the test", d: "Type what you want to verify, in plain English. Or paste a curl, or record a flow." },
            { n: "02", t: "Testrify writes it", d: "AI generates resilient locators, sensible assertions, and a clean test spec." },
            { n: "03", t: "Run, debug, ship", d: "Failures get root-cause analysis and one-click fixes. Resume mid-run. Done." },
          ].map((s) => (
            <div key={s.n} className="glass rounded-2xl p-6 flex gap-6 items-start shadow-card">
              <div className="text-3xl font-bold text-gradient font-mono shrink-0">{s.n}</div>
              <div>
                <h3 className="font-semibold text-xl mb-1">{s.t}</h3>
                <p className="text-muted-foreground">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section id="pricing" className="relative z-10 max-w-5xl mx-auto px-6 py-24">
        <div className="glass rounded-3xl p-12 text-center shadow-elevated border border-border relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-hero opacity-50 pointer-events-none" />
          <div className="relative">
            <Zap className="h-10 w-10 text-primary-glow mx-auto mb-4" />
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Ready to ship without fear?</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Free for the first 100 test runs / month. No credit card. No "schedule a demo."
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              <Button asChild size="lg" className="bg-gradient-primary border-0 shadow-glow h-12 px-6">
                <Link to="/signup">Get started — it's free <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
            <div className="flex items-center justify-center gap-6 mt-8 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> No credit card</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> Cancel anytime</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> 100 free runs / mo</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border mt-12">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-3"><Logo /> <span>© 2026</span></div>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-foreground"><Github className="h-4 w-4" /></a>
            <a href="#" className="hover:text-foreground">Docs</a>
            <a href="#" className="hover:text-foreground">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
