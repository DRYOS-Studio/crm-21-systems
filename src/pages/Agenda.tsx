import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { MainHeader } from "@/components/layout/MainHeader";
import { Button } from "@/components/ui/button";

type AgendaEvent = {
  id: string;
  conversationId: string;
  at: string;
  type: "Instalação" | "Follow-up manual" | "Follow-up automático";
  contact_name: string | null;
  contact_company: string | null;
  contact_phone: string | null;
};

type FollowupWithConversation = {
  id: string;
  conversation_id: string;
  send_at: string;
  kind: string;
  conversations: {
    contact_name: string | null;
    contact_company: string | null;
    contact_phone: string | null;
  };
};

export default function Agenda() {
  const { user, signOut } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const [rows, setRows] = useState<AgendaEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      const [{ data: appointments }, { data: followups }] = await Promise.all([
        supabase.from("conversations")
          .select("id, installation_at, contact_name, contact_company, contact_phone")
          .not("installation_at", "is", null),
        supabase.from("followups")
          .select("id, conversation_id, send_at, kind, conversations!inner(contact_name, contact_company, contact_phone)")
          .eq("status", "pending"),
      ]);
      if (cancelled) return;

      const installEvents: AgendaEvent[] = ((appointments ?? []) as Array<{
        id: string;
        installation_at: string;
        contact_name: string | null;
        contact_company: string | null;
        contact_phone: string | null;
      }>).map((row) => ({
        id: `installation-${row.id}`,
        conversationId: row.id,
        at: row.installation_at,
        type: "Instalação",
        contact_name: row.contact_name,
        contact_company: row.contact_company,
        contact_phone: row.contact_phone,
      }));
      const followupEvents: AgendaEvent[] = ((followups ?? []) as unknown as FollowupWithConversation[]).map((row) => ({
        id: `followup-${row.id}`,
        conversationId: row.conversation_id,
        at: row.send_at,
        type: row.kind === "auto_inactivity" ? "Follow-up automático" : "Follow-up manual",
        contact_name: row.conversations.contact_name,
        contact_company: row.conversations.contact_company,
        contact_phone: row.conversations.contact_phone,
      }));

      setRows([...installEvents, ...followupEvents].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [userId]);

  return <div className="dryos h-screen flex flex-col bg-background text-foreground">
    <MainHeader onLogout={async () => { await signOut(); navigate("/login"); }} />
    <main className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Agenda</h1>
      <p className="mt-1 text-sm text-muted-foreground">Instalações e follow-ups agendados nos leads.</p>
      <div className="mt-6 divide-y rounded-lg border">
        {rows.map((row) => <Link key={row.id} to={`/conversas?open=${row.conversationId}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{row.type}</span>
              <div className="truncate font-medium">{row.contact_company || row.contact_name || row.contact_phone || "Lead"}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{row.contact_phone}</div>
          </div>
          <time className="shrink-0 text-sm">{new Date(row.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time>
        </Link>)}
        {!loading && rows.length === 0 && <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground"><CalendarDays className="h-6 w-6" />Nenhum evento agendado.</div>}
        {loading && <p className="p-5 text-sm text-muted-foreground">Carregando…</p>}
      </div>
      <Button asChild variant="outline" className="mt-4"><Link to="/conversas">Voltar às conversas</Link></Button>
    </main>
  </div>;
}
