import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { LogOut, Settings } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMemberAccess } from "@/hooks/useMemberAccess";

const NAV = [
  { to: "/conversas", label: "Conversas", module: "crm_conversations", match: (p: string) => p.startsWith("/conversas") },
  { to: "/crm", label: "CRM", module: "crm_conversations", match: (p: string) => p === "/crm" || p.startsWith("/kanban") },
  { to: "/agenda", label: "Agenda", module: "crm_conversations", match: (p: string) => p.startsWith("/agenda") },
  { to: "/prospeccao", label: "Prospecção", module: "prospecting", match: (p: string) => p.startsWith("/prospeccao") },
  {
    to: "/configuracoes",
    label: "Configurações",
    match: (p: string) => p.startsWith("/configuracoes") || p.startsWith("/whatsapp"),
  },
] as const;

type Props = {
  onLogout: () => void;
  configNeedsAttention?: boolean;
  trailing?: ReactNode;
};

export function MainHeader({ onLogout, configNeedsAttention, trailing }: Props) {
  const { pathname } = useLocation();
  const { hasModule } = useMemberAccess();
  const visibleNav = NAV.filter((item) => !item.module || hasModule(item.module));

  return (
    <header className="border-b border-border px-4 h-14 flex items-center justify-between shrink-0 bg-background">
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/" aria-label="Ir para o Dashboard" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo horizontal width={26} height={26} />
        </Link>
        <nav className="hidden sm:flex items-center gap-1 ml-2">
          {visibleNav.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.to}
                to={item.to === "/configuracoes" ? "/configuracoes/agente" : item.to}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition",
                  active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-1">
        {trailing}
        <ThemeToggle />
        <Button
          variant={configNeedsAttention ? "default" : "ghost"}
          size="icon"
          className="sm:hidden"
          asChild
          title="Configurações"
        >
          <Link to="/configuracoes/agente">
            <Settings className="w-4 h-4" />
          </Link>
        </Button>
        <Button variant="ghost" size="icon" onClick={onLogout} title="Sair">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
