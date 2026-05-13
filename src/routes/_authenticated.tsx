import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Logo } from "@/components/logo";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, FlaskConical, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [loading, user, nav]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/api-tester", label: "API Tester", icon: FlaskConical },
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="p-5"><Logo /></div>
        <nav className="px-3 space-y-1 flex-1">
          {navItems.map((it) => {
            const active = path.startsWith(it.to);
            return (
              <Link key={it.to} to={it.to}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition
                  ${active ? "bg-gradient-primary text-primary-foreground shadow-glow" : "text-sidebar-foreground hover:bg-surface-elevated"}`}>
                <it.icon className="h-4 w-4" /> {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="text-xs text-muted-foreground mb-2 truncate px-2">{user.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={async () => { await supabase.auth.signOut(); nav({ to: "/login" }); }}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
