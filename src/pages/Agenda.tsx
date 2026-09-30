import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { MainHeader } from "@/components/layout/MainHeader";
import { Button } from "@/components/ui/button";

type Appointment = { id: string; installation_at: string; contact_name: string | null; contact_company: string | null; contact_phone: string | null };

export default function Agenda() {
  const { user, signOut } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const [rows, setRows] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    void supabase.from("conversations")
      .select("id, installation_at, contact_name, contact_company, contact_phone")
      .not("installation_at", "is", null)
      .order("installation_at")
      .then(({ data }) => { setRows((data ?? []) as Appointment[]); setLoading(false); });
  }, [userId]);

  return <div className="dryos h-screen flex flex-col bg-background text-foreground">
    <MainHeader onLogout={async () => { await signOut(); navigate("/login"); }} />
    <main className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Agenda</h1>
      <p className="mt-1 text-sm text-muted-foreground">Agendamentos registrados nos leads.</p>
      <div className="mt-6 divide-y rounded-lg border">
        {rows.map((row) => <Link key={row.id} to={`/conversas?open=${row.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50">
          <div className="min-w-0"><div className="truncate font-medium">{row.contact_company || row.contact_name || row.contact_phone || "Lead"}</div><div className="text-xs text-muted-foreground">{row.contact_phone}</div></div>
          <time className="shrink-0 text-sm">{new Date(row.installation_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time>
        </Link>)}
        {!loading && rows.length === 0 && <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground"><CalendarDays className="h-6 w-6" />Nenhuma instalação agendada.</div>}
        {loading && <p className="p-5 text-sm text-muted-foreground">Carregando…</p>}
      </div>
      <Button asChild variant="outline" className="mt-4"><Link to="/conversas">Voltar às conversas</Link></Button>
    </main>
  </div>;
}
