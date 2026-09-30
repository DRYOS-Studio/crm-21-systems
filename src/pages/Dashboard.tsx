import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainHeader } from "@/components/layout/MainHeader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type MetricEvent = { event_type: string; occurred_at: string };

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [events, setEvents] = useState<MetricEvent[]>([]);
  const [conversations, setConversations] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    void Promise.all([
      supabase.from("conversation_events" as never).select("event_type, occurred_at").gte("occurred_at", since),
      supabase.from("conversations").select("id", { count: "exact", head: true }).gte("created_at", since),
    ]).then(([eventResult, conversationResult]) => {
      if (!active) return;
      setEvents((eventResult.data ?? []) as unknown as MetricEvent[]);
      setConversations(conversationResult.count ?? 0);
      setLoading(false);
    });
    return () => { active = false; };
  }, [userId, days]);

  const counts = useMemo(() => events.reduce<Record<string, number>>((all, event) => {
    all[event.event_type] = (all[event.event_type] ?? 0) + 1;
    return all;
  }, {}), [events]);
  const daily = useMemo(() => {
    const byDay = new Map<string, number>();
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
      byDay.set(date, 0);
    }
    for (const event of events) {
      const day = new Date(event.occurred_at).toISOString().slice(0, 10);
      if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return [...byDay].slice(-14);
  }, [days, events]);
  const maxDaily = Math.max(1, ...daily.map(([, value]) => value));

  return <div className="dryos flex h-screen flex-col bg-background text-foreground">
    <MainHeader onLogout={async () => { await signOut(); navigate("/login"); }} />
    <main className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Dashboard</h1><p className="mt-1 text-sm text-muted-foreground">Atividade registrada no período.</p></div>
        <label className="space-y-1 text-xs">Período
          <select className="ml-2 h-9 rounded-md border border-input bg-background px-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option>
          </select>
        </label>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Conversas iniciadas", conversations],
          ["Qualificações atualizadas", counts.qualification_updated ?? 0],
          ["Passagens ao humano", counts.human_handoff ?? 0],
          ["Follow-ups enviados", counts.followup_sent ?? 0],
          ["Conversões", counts.converted ?? 0],
        ].map(([label, value]) => <article key={label} className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{loading ? "—" : value}</p></article>)}
      </div>
      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="font-medium">Eventos por dia</h2>
        <div className="mt-5 flex h-48 items-end gap-2" role="img" aria-label="Eventos diários de qualificação, passagem ao humano, follow-up e conversão">
          {daily.map(([day, value]) => <div key={day} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1 text-center">
            <span className="text-xs text-muted-foreground">{value || ""}</span>
            <div className="min-h-1 rounded-t bg-primary" style={{ height: `${Math.max(3, value / maxDaily * 100)}%` }} title={`${day}: ${value}`} />
            <span className="truncate text-[10px] text-muted-foreground">{day.slice(5)}</span>
          </div>)}
        </div>
        {loading && <p className="text-sm text-muted-foreground">Carregando métricas...</p>}
        {!loading && events.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Ainda não há eventos métricos neste período.</p>}
      </section>
      <p className="mt-3 text-xs text-muted-foreground">Eventos métricos começam a ser registrados após a atualização da instalação.</p>
    </main>
  </div>;
}
