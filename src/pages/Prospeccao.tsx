import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { MainHeader } from "@/components/layout/MainHeader";
import { CsvImport } from "@/components/prospeccao/CsvImport";
import { OpenersEditor } from "@/components/prospeccao/OpenersEditor";
import { OutreachSettings } from "@/components/prospeccao/OutreachSettings";
import { ProspectsTable } from "@/components/prospeccao/ProspectsTable";

export default function Prospeccao() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="dryos h-screen flex flex-col bg-background text-foreground">
      <MainHeader
        onLogout={async () => {
          await signOut();
          navigate("/login");
        }}
      />
      <main className="flex-1 overflow-auto p-6">
        <h1 className="text-3xl text-foreground">Prospecção</h1>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">
          Cada conta tem o próprio WhatsApp, a própria fila e os próprios toques. Groq não é obrigatório para
          disparar.
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
