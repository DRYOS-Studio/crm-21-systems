import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bot, User, Send, MessageSquare, Settings, LogOut, Sparkles, Clock, Trello, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { useAdminRole } from "@/hooks/useAdminRole";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

type Conversation = {
  id: string;
  contact_phone: string;
  contact_name: string | null;
  ai_enabled: boolean;
  last_message_at: string;
  instance_id: string | null;
  human_takeover_at: string | null;
  stage_id: string | null;
};

type Message = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender: "contact" | "ai" | "human";
  content: string;
  created_at: string;
};

type Stage = { id: string; name: string; position: number; color: string | null };
type Followup = { id: string; send_at: string; kind: string; text_override: string | null };
type FollowupHistoryItem = {
  id: string;
  send_at: string;
  sent_at: string | null;
  kind: string;
  status: string;
  text_override: string | null;
  error: string | null;
  created_at: string;
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "agora";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${d}d ${hr}h` : `${d}d`;
}

export default function Conversas() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAdminRole();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [followupHistory, setFollowupHistory] = useState<FollowupHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [fuText, setFuText] = useState("");
  const [fuPreset, setFuPreset] = useState("1h");
  const [fuCustom, setFuCustom] = useState("");
  const [fuOpen, setFuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  // Load conversations + realtime
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .order("last_message_at", { ascending: false });
      setConversations((data as Conversation[]) || []);
      const openParam = searchParams.get("open");
      if (openParam && data?.some((c: any) => c.id === openParam)) {
        setActiveId(openParam);
      } else if (data?.length && !activeId) {
        setActiveId(data[0].id);
      }
    };
    load();

    const ch = supabase
      .channel("conversations-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  // Load stages
  useEffect(() => {
    if (!user) return;
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("user_id", user.id)
      .order("position", { ascending: true })
      .then(({ data }) => setStages((data as Stage[]) || []));
  }, [user]);

  // Load followups for active conversation
  useEffect(() => {
    if (!activeId) {
      setFollowups([]);
      setFollowupHistory([]);
      return;
    }
    const load = async () => {
      const [{ data: pending }, { data: hist }] = await Promise.all([
        supabase
          .from("followups")
          .select("id, send_at, kind, text_override")
          .eq("conversation_id", activeId)
          .eq("status", "pending")
          .order("send_at", { ascending: true }),
        supabase
          .from("followups")
          .select("id, send_at, sent_at, kind, status, text_override, error, created_at")
          .eq("conversation_id", activeId)
          .neq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      setFollowups((pending as Followup[]) || []);
      setFollowupHistory((hist as FollowupHistoryItem[]) || []);
    };
    load();
    const ch = supabase
      .channel(`followups-${activeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "followups", filter: `conversation_id=eq.${activeId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeId]);

  // Tick para atualizar contagem regressiva dos follow-ups
  useEffect(() => {
    if (followups.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [followups.length]);

  // Load messages for active + realtime
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    const load = async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeId)
        .order("created_at", { ascending: true });
      setMessages((data as Message[]) || []);
    };
    load();

    const ch = supabase
      .channel(`messages-${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message]),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Detect setup completion (Groq key configured)
  useEffect(() => {
    if (!user) return;
    const check = async () => {
      const { data: agent } = await supabase
        .from("agent_configs")
        .select("groq_api_key")
        .eq("user_id", user.id)
        .maybeSingle();
      setNeedsSetup(!agent?.groq_api_key);
    };
    check();
  }, [user, configOpen]);

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  const toggleAI = async (enabled: boolean) => {
    if (!active) return;
    if (enabled) {
      const { error } = await supabase
        .from("conversations")
        .update({ ai_enabled: true, human_takeover_at: null as unknown as string })
        .eq("id", active.id);
      if (error) toast({ variant: "destructive", title: "Erro", description: error.message });
    } else {
      // Humano assume via toggle → cancela pendentes e zera contador
      const { error } = await supabase
        .from("conversations")
        .update({
          ai_enabled: false,
          human_takeover_at: new Date().toISOString(),
          inactivity_followup_at: null,
          auto_followup_count: 0,
        })
        .eq("id", active.id);
      if (error) {
        toast({ variant: "destructive", title: "Erro", description: error.message });
        return;
      }
      await supabase
        .from("followups")
        .update({ status: "cancelled" })
        .eq("conversation_id", active.id)
        .eq("status", "pending");
    }
  };

  const changeStage = async (stageId: string) => {
    if (!active) return;
    await supabase.from("conversations").update({ stage_id: stageId }).eq("id", active.id);
  };

  const scheduleFollowup = async () => {
    if (!active || !user) return;
    let sendAt: Date;
    const now = Date.now();
    if (fuPreset === "1min") sendAt = new Date(now + 60_000);
    else if (fuPreset === "1h") sendAt = new Date(now + 3600_000);
    else if (fuPreset === "3h") sendAt = new Date(now + 3 * 3600_000);
    else if (fuPreset === "tomorrow") {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      sendAt = d;
    } else if (fuPreset === "2d") sendAt = new Date(now + 2 * 86400_000);
    else if (fuPreset === "custom") {
      if (!fuCustom) {
        toast({ variant: "destructive", title: "Escolha data e hora" });
        return;
      }
      sendAt = new Date(fuCustom);
    } else return;

    const { error } = await supabase.from("followups").insert({
      user_id: user.id,
      conversation_id: active.id,
      send_at: sendAt.toISOString(),
      status: "pending",
      kind: "manual",
      text_override: fuText.trim() || null,
    });
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } else {
      const isToday = sendAt.toDateString() === new Date().toDateString();
      const when = sendAt.toLocaleString("pt-BR", {
        day: isToday ? undefined : "2-digit",
        month: isToday ? undefined : "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      toast({
        title: "Follow-up agendado",
        description: isToday ? `Será enviado hoje às ${when}` : `Será enviado em ${when}`,
      });
      setFuText("");
      setFuCustom("");
      setFuOpen(false);
    }
  };

  const cancelFollowup = async (id: string) => {
    const target = followups.find((f) => f.id === id);
    // Otimista: remove da lista pendente e insere no topo do histórico
    setFollowups((prev) => prev.filter((f) => f.id !== id));
    if (target) {
      setFollowupHistory((prev) => [
        {
          id: target.id,
          send_at: target.send_at,
          sent_at: null,
          kind: target.kind,
          status: "cancelled",
          text_override: target.text_override,
          error: null,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
    setCancelId(null);

    const { error } = await supabase
      .from("followups")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (error) {
      // Reverte
      if (target) {
        setFollowups((prev) => [...prev, target].sort((a, b) => a.send_at.localeCompare(b.send_at)));
        setFollowupHistory((prev) => prev.filter((h) => h.id !== id));
      }
      toast({ variant: "destructive", title: "Erro ao cancelar", description: error.message });
    } else {
      toast({ title: "Follow-up cancelado", description: "A mensagem não será enviada." });
    }
  };

  const send = async () => {
    if (!input.trim() || !active) return;
    setSending(true);
    try {
      // Fetch instance token
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_token")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!inst?.instance_token) throw new Error("Nenhuma instância WhatsApp conectada");

      const { data, error } = await supabase.functions.invoke("manage-instance", {
        body: {
          action: "send_text",
          instance_token: inst.instance_token,
          number: active.contact_phone,
          text: input.trim(),
        },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "Falha ao enviar");

      await supabase.from("messages").insert({
        conversation_id: active.id,
        user_id: user!.id,
        direction: "outbound",
        sender: "human",
        content: input.trim(),
      });
      // Humano assumiu → pausa a IA e registra o timestamp. NÃO há retomada
      // automática: a IA só volta quando o usuário clica "Reativar IA".
      await supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          ai_enabled: false,
          human_takeover_at: new Date().toISOString(),
        })
        .eq("id", active.id);
      setInput("");
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro", description: e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <nav className="hidden sm:flex items-center gap-1 ml-2">
            <Link to="/" className="px-3 py-1.5 text-sm rounded-md bg-muted font-medium">
              Conversas
            </Link>
            <Link
              to="/kanban"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition"
            >
              Kanban
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/kanban")} title="Kanban">
            <Trello className="w-4 h-4" />
          </Button>
          <ThemeToggle />
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/uazapi")}>
              Admin
            </Button>
          )}
          <Button
            variant={needsSetup ? "default" : "ghost"}
            size="sm"
            onClick={() => setConfigOpen(true)}
          >
            <Settings className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Configuração</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Sair">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <ConfigDrawer open={configOpen} onOpenChange={setConfigOpen} />

      {/* Main */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-0 overflow-hidden">
        {/* Sidebar list */}
        <div className="border-r overflow-hidden flex flex-col bg-card">
          <div className="p-3 border-b font-semibold text-sm flex items-center gap-2 shrink-0">
            <MessageSquare className="w-4 h-4" /> Conversas
          </div>
          <div className="flex-1 overflow-y-auto">
            {needsSetup && (
              <button
                onClick={() => setConfigOpen(true)}
                className="w-full text-left p-4 border-b bg-primary/5 hover:bg-primary/10 transition"
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Configure em 2 passos
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Cole sua chave da Groq e conecte o WhatsApp para começar.
                </p>
              </button>
            )}
            {conversations.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground text-center">
                Nenhuma conversa ainda. Quando o WhatsApp receber mensagens, elas aparecem aqui.
              </div>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`w-full text-left px-3 py-3 border-b hover:bg-muted transition ${
                  c.id === activeId ? "bg-muted" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">
                    {c.contact_name || c.contact_phone}
                  </span>
                  <Badge variant={c.ai_enabled ? "default" : "secondary"} className="text-[10px]">
                    {c.ai_enabled ? "IA" : "Humano"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">{c.contact_phone}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat panel */}
        <div className="flex flex-col bg-background overflow-hidden">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Selecione uma conversa
            </div>
          ) : (
            <>
              <div className="p-3 border-b flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">
                    {active.contact_name || active.contact_phone}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {active.contact_phone}
                    {!active.ai_enabled && active.human_takeover_at && (
                      <span className="ml-2 text-primary">
                        · Humano assumiu — reative a IA manualmente
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {stages.length > 0 && (
                    <Select value={active.stage_id ?? undefined} onValueChange={changeStage}>
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue placeholder="Stage" />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    {active.ai_enabled ? (
                      <Bot className="w-4 h-4 text-primary" />
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                    IA
                    <Switch checked={active.ai_enabled} onCheckedChange={toggleAI} />
                  </label>
                </div>
              </div>

              {/* Follow-ups pendentes / agendar */}
              <div className="px-3 py-2 border-b bg-muted/30 space-y-2">
                {followups.length > 0 && (
                  <div className="space-y-1.5">
                    {followups.map((f) => {
                      const sendMs = new Date(f.send_at).getTime();
                      const diff = sendMs - now;
                      const countdown = formatCountdown(diff);
                      const isAuto = f.kind === "auto_inactivity";
                      return (
                        <div
                          key={f.id}
                          className="flex items-center gap-2 bg-background border rounded-md px-3 py-2 text-xs"
                        >
                          <Clock className="w-4 h-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">
                              {isAuto ? "Follow-up automático (inatividade)" : "Follow-up agendado"}
                              <span className="ml-2 text-muted-foreground font-normal">
                                {diff > 0 ? `em ${countdown}` : "enviando…"}
                              </span>
                            </div>
                            <div className="text-muted-foreground truncate">
                              {new Date(f.send_at).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {" · "}
                              {f.text_override
                                ? `"${f.text_override.slice(0, 60)}${f.text_override.length > 60 ? "…" : ""}"`
                                : "IA vai gerar a mensagem"}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => setCancelId(f.id)}
                          >
                            <X className="w-3 h-3 mr-1" /> Cancelar
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <Popover open={fuOpen} onOpenChange={setFuOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      <Clock className="w-3 h-3 mr-1" /> Agendar follow-up
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 space-y-3" align="end">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Quando</Label>
                      <Select value={fuPreset} onValueChange={setFuPreset}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1h">Em 1 hora</SelectItem>
                          <SelectItem value="3h">Em 3 horas</SelectItem>
                          <SelectItem value="tomorrow">Amanhã às 9h</SelectItem>
                          <SelectItem value="2d">Em 2 dias</SelectItem>
                          <SelectItem value="custom">Escolher data/hora</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {fuPreset === "custom" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Data e hora</Label>
                        <Input
                          type="datetime-local"
                          value={fuCustom}
                          onChange={(e) => setFuCustom(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mensagem (opcional)</Label>
                      <Textarea
                        rows={3}
                        value={fuText}
                        onChange={(e) => setFuText(e.target.value)}
                        placeholder="Deixe vazio para a IA gerar com base no histórico."
                      />
                    </div>
                    <Button size="sm" className="w-full" onClick={scheduleFollowup}>
                      Agendar
                    </Button>
                  </PopoverContent>
                  </Popover>
                  {followupHistory.length > 0 && (
                    <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="w-full">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                          <ChevronDown
                            className={`w-3 h-3 mr-1 transition-transform ${historyOpen ? "rotate-180" : ""}`}
                          />
                          Histórico ({followupHistory.length})
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1 space-y-1">
                        {followupHistory.map((h) => {
                          const Icon =
                            h.status === "sent"
                              ? CheckCircle2
                              : h.status === "cancelled"
                                ? XCircle
                                : AlertCircle;
                          const color =
                            h.status === "sent"
                              ? "text-emerald-600"
                              : h.status === "cancelled"
                                ? "text-muted-foreground"
                                : "text-destructive";
                          const label =
                            h.status === "sent"
                              ? "Enviado"
                              : h.status === "cancelled"
                                ? "Cancelado"
                                : "Falhou";
                          const ref = h.sent_at || h.send_at;
                          return (
                            <div
                              key={h.id}
                              className="flex items-start gap-2 bg-background border rounded-md px-2 py-1.5"
                            >
                              <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} />
                              <div className="flex-1 min-w-0">
                                <div className={`font-medium ${color}`}>
                                  {label}
                                  <span className="ml-1.5 text-muted-foreground font-normal">
                                    {new Date(ref).toLocaleString("pt-BR", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                    {" · "}
                                    {h.kind === "auto_inactivity" ? "auto" : "manual"}
                                  </span>
                                </div>
                                {h.status === "failed" && h.error && (
                                  <div className="text-destructive/80 truncate">{h.error}</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === "outbound"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {m.direction === "outbound" && (
                      <div className="text-[10px] opacity-70 mb-0.5">
                        {m.sender === "ai" ? "IA" : "Você"}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                ))}
              </div>

              <div className="p-3 border-t flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={active.ai_enabled ? "IA responderá automaticamente. Envie mensagem manual mesmo assim..." : "Digite sua resposta..."}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                  disabled={sending}
                />
                <Button onClick={send} disabled={sending || !input.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      <AlertDialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar este follow-up?</AlertDialogTitle>
            <AlertDialogDescription>
              A mensagem não será enviada. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelId && cancelFollowup(cancelId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancelar follow-up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}