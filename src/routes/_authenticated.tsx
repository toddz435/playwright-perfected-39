import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Logo } from "@/components/logo";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity, FlaskConical, LogOut, Loader2, Wand2, Clock, LayoutDashboard,
  Search, ChevronDown, Plus, User as UserIcon, Command as CommandIcon, TrendingUp, BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

const TABS = [
  { to: "/console", label: "Console", icon: Activity },
  { to: "/dashboard", label: "Tests", icon: LayoutDashboard },
  { to: "/codegen", label: "Codegen", icon: Wand2 },
  { to: "/api-tester", label: "API", icon: FlaskConical },
  { to: "/schedules", label: "Schedules", icon: Clock },
  { to: "/insights", label: "Insights", icon: TrendingUp },
  { to: "/docs", label: "Docs", icon: BookOpen },
] as const;

function AuthLayout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const [projects, setProjects] = useState<any[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [loading, user, nav]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: ps } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
      setProjects(ps || []);
      const stored = typeof window !== "undefined" ? localStorage.getItem("activeProject") : null;
      setActiveProject(stored && ps?.some(p => p.id === stored) ? stored : ps?.[0]?.id ?? null);
      const { data: ts } = await supabase.from("tests").select("id,name,project_id").order("created_at", { ascending: false });
      setTests(ts || []);
    })();
  }, [user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const switchProject = (id: string) => {
    setActiveProject(id);
    if (typeof window !== "undefined") localStorage.setItem("activeProject", id);
    window.dispatchEvent(new CustomEvent("activeProjectChange", { detail: id }));
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeProj = projects.find(p => p.id === activeProject);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="h-14 px-4 flex items-center gap-3">
          <Link to="/console" className="shrink-0"><Logo /></Link>

          <span className="text-muted-foreground/40 hidden sm:inline">/</span>

          {/* Project switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 hidden sm:flex">
                <span className="text-sm font-medium truncate max-w-[160px]">{activeProj?.name ?? "Select project"}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
              {projects.length === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">No projects yet</div>
              ) : projects.map(p => (
                <DropdownMenuItem key={p.id} onClick={() => switchProject(p.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{p.name}</div>
                    {p.base_url && <div className="text-xs text-muted-foreground truncate">{p.base_url}</div>}
                  </div>
                  {activeProject === p.id && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/dashboard"><Plus className="h-3.5 w-3.5 mr-2" /> New project</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tabs */}
          <nav className="hidden md:flex items-center gap-1 ml-2">
            {TABS.map(t => {
              const active = path === t.to || path.startsWith(t.to + "/");
              return (
                <Link key={t.to} to={t.to}
                  className={`px-3 py-1.5 rounded-md text-sm transition flex items-center gap-1.5
                    ${active ? "bg-surface-elevated text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50"}`}>
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          {/* Search trigger */}
          <button onClick={() => setPaletteOpen(true)}
            className="hidden sm:flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-surface text-xs text-muted-foreground hover:bg-surface-elevated transition min-w-[200px]">
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border">⌘K</kbd>
          </button>

          {/* Live indicator */}
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-glow" />
            <span>Cloud runners online</span>
          </div>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full bg-gradient-primary text-primary-foreground">
                <UserIcon className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="text-xs text-muted-foreground">Signed in as</div>
                <div className="text-sm truncate">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => { await supabase.auth.signOut(); nav({ to: "/login" }); }}>
                <LogOut className="h-3.5 w-3.5 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile tabs */}
        <nav className="md:hidden flex gap-1 px-3 pb-2 overflow-x-auto">
          {TABS.map(t => {
            const active = path === t.to || path.startsWith(t.to + "/");
            return (
              <Link key={t.to} to={t.to}
                className={`px-3 py-1 rounded-md text-xs whitespace-nowrap transition flex items-center gap-1.5
                  ${active ? "bg-surface-elevated text-foreground" : "text-muted-foreground"}`}>
                <t.icon className="h-3 w-3" />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* Command palette */}
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Jump to a test, project, or action…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {TABS.map(t => (
              <CommandItem key={t.to} onSelect={() => { setPaletteOpen(false); nav({ to: t.to }); }}>
                <t.icon className="h-3.5 w-3.5 mr-2" /> {t.label}
              </CommandItem>
            ))}
          </CommandGroup>
          {projects.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Projects">
                {projects.map(p => (
                  <CommandItem key={p.id} onSelect={() => { switchProject(p.id); setPaletteOpen(false); }}>
                    <CommandIcon className="h-3.5 w-3.5 mr-2" /> {p.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {tests.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Tests">
                {tests.slice(0, 20).map(t => (
                  <CommandItem key={t.id} onSelect={() => { setPaletteOpen(false); nav({ to: "/tests/$testId", params: { testId: t.id } }); }}>
                    <FlaskConical className="h-3.5 w-3.5 mr-2" /> {t.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </div>
  );
}
