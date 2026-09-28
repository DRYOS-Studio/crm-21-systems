import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { MainHeader } from "@/components/layout/MainHeader";
import { AgentConfigProvider, useAgentConfig } from "@/contexts/AgentConfigContext";
import { useAuth } from "@/contexts/AuthContext";
import { SETTINGS_NAV } from "@/lib/settings-nav";
import { cn } from "@/lib/utils";

function SettingsChrome() {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { needsGroqSetup } = useAgentConfig();

  const activeItem = SETTINGS_NAV.flatMap((g) => g.items).find((item) => pathname.startsWith(item.to));

  return (
    <div className="dryos h-screen flex flex-col bg-background text-foreground">
      <MainHeader
        configNeedsAttention={needsGroqSetup}
        onLogout={async () => {
          await signOut();
          navigate("/login");
        }}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gerencie WhatsApp, IA e preferências do CRM.</p>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="Configurações" className="flex flex-col gap-4 md:border-r md:border-border md:pr-3">
              {SETTINGS_NAV.map((group) => (
                <div key={group.title}>
                  <h2 className="px-3 pb-1 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </h2>
                  <ul className="flex flex-col gap-0.5">
                    {group.items.map((item) => {
                      const active = pathname.startsWith(item.to);
                      const Icon = item.icon;
                      return (
                        <li key={item.to}>
                          <Link
                            to={item.to}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                              active
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="min-w-0 pb-10">
              {activeItem?.description && (
                <p className="text-sm text-muted-foreground mb-4 max-w-2xl">{activeItem.description}</p>
              )}
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsLayout() {
  return (
    <AgentConfigProvider>
      <SettingsChrome />
    </AgentConfigProvider>
  );
}

export function SettingsIndexRedirect() {
  return <Navigate to="/configuracoes/whatsapp" replace />;
}
