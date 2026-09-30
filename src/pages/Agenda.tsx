import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, List } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { MainHeader } from "@/components/layout/MainHeader";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
  const [view, setView] = useState<"list" | "calendar">("list");
  const [month, setMonth] = useState(() => new Date());

  const calendarDays = useMemo(() => {
    const firstDay = startOfWeek(startOfMonth(month), { locale: ptBR });
    const lastDay = endOfWeek(endOfMonth(month), { locale: ptBR });
    const days: Date[] = [];
    for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) days.push(day);
    return days;
  }, [month]);

  const eventsForDay = (day: Date) => rows.filter((row) => isSameDay(new Date(row.at), day));

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
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" value={view} onValueChange={(value) => { if (value) setView(value as "list" | "calendar"); }} aria-label="Visualização da agenda" className="rounded-md border p-1">
          <ToggleGroupItem value="list" aria-label="Modo lista" className="gap-2 px-3"><List className="h-4 w-4" />Lista</ToggleGroupItem>
          <ToggleGroupItem value="calendar" aria-label="Modo calendário" className="gap-2 px-3"><CalendarDays className="h-4 w-4" />Calendário</ToggleGroupItem>
        </ToggleGroup>
        {view === "calendar" && <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => setMonth((current) => subMonths(current, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-36 text-center font-medium capitalize">{format(month, "MMMM yyyy", { locale: ptBR })}</span>
          <Button variant="outline" size="icon" aria-label="Próximo mês" onClick={() => setMonth((current) => addMonths(current, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>}
      </div>

      {loading ? <p className="mt-4 rounded-lg border p-5 text-sm text-muted-foreground">Carregando…</p>
        : rows.length === 0 ? <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border p-10 text-center text-sm text-muted-foreground"><CalendarDays className="h-6 w-6" />Nenhum evento agendado.</div>
          : view === "list" ? <div className="mt-4 divide-y rounded-lg border">
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
          </div> : <div className="mt-4 overflow-x-auto rounded-lg border">
            <div className="grid min-w-[700px] grid-cols-7">
              {Array.from({ length: 7 }, (_, index) => <div key={index} className="border-b p-2 text-center text-xs font-medium text-muted-foreground">{format(addDays(startOfWeek(month, { locale: ptBR }), index), "EEE", { locale: ptBR })}</div>)}
              {calendarDays.map((day) => {
                const dayEvents = eventsForDay(day);
                return <div key={day.toISOString()} className={`min-h-28 border-b border-r p-1.5 ${!isSameMonth(day, month) ? "bg-muted/30 text-muted-foreground" : ""}`}>
                  <div className={`mb-1 flex h-7 w-7 items-center justify-center rounded-full text-sm ${isToday(day) ? "bg-primary text-primary-foreground" : ""}`}>{format(day, "d")}</div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((row) => <Link key={row.id} to={`/conversas?open=${row.conversationId}`} title={`${format(new Date(row.at), "HH:mm")} · ${row.type} · ${row.contact_company || row.contact_name || row.contact_phone || "Lead"}`} className="block truncate rounded bg-primary/10 px-1.5 py-1 text-[11px] hover:bg-primary/20">
                      <span className="font-medium">{format(new Date(row.at), "HH:mm")}</span> {row.contact_company || row.contact_name || row.contact_phone || "Lead"}
                    </Link>)}
                    {dayEvents.length > 3 && <p className="px-1 text-[11px] text-muted-foreground">+{dayEvents.length - 3} mais</p>}
                  </div>
                </div>;
              })}
            </div>
          </div>}
      <Button asChild variant="outline" className="mt-4"><Link to="/conversas">Voltar às conversas</Link></Button>
    </main>
  </div>;
}
