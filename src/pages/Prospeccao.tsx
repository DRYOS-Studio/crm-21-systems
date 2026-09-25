import { Link, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { CsvImport } from "@/components/prospeccao/CsvImport";
import { OpenersEditor } from "@/components/prospeccao/OpenersEditor";
import { OutreachSettings } from "@/components/prospeccao/OutreachSettings";
import { ProspectsTable } from "@/components/prospeccao/ProspectsTable";

export default function Prospeccao() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="dryos h-screen flex flex-col bg-background text-foreground">
      <header className="border-b border-border px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <nav className="hidden sm:flex items-center gap-1 ml-2">
            <Link
              to="/"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition"
            >
              Conversas
            </Link>
            <Link
              to="/kanban"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition"
            >
              Kanban
            </Link>
            <Link to="/prospeccao" className="px-3 py-1.5 text-sm rounded-md bg-muted font-medium">
              Prospecção
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
            title="Sair"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <h1 className="text-3xl text-foreground">Prospecção</h1>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">
          Importe contatos e acompanhe os disparos.
        </p>
        <div className="space-y-6">
          <CsvImport />
          <OpenersEditor />
          <OutreachSettings />
          <ProspectsTable />
        </div>
      </main>
    </div>
  );
}
