import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bot, User, MessageSquare, Sparkles, Clock, Trello, X, PanelRight, Search, ArrowRightLeft } from "lucide-react";
import {
  type LastSnap,
  ehEmContato,
  ehPerdido,
  formatInboxTime,
  matchesInboxQuery,
  precisaResponder,
  conversationSemContato,
  previewText,
  lastSnapFromMessage,
  threadDateLabel,
  waMeUrl,
} from "@/lib/inbox";
import { conversationMatchesTagFilter } from "@/lib/tag-filter";
import { conversationHasFollowup } from "@/lib/followup-filter";
import { usePendingFollowupConversationIds } from "@/hooks/usePendingFollowupConversationIds";
import { toast } from "@/hooks/use-toast";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { MainHeader } from "@/components/layout/MainHeader";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LeadContextBody, leadPerson, leadTitle, type LeadEditableFields } from "@/components/lead/LeadContextPanel";
import { LeadTagChips, TagFilterSelect } from "@/components/lead/LeadTagEditor";
import { useLeadTags } from "@/hooks/useLeadTags";
import { useViewFilters } from "@/hooks/useViewFilters";
import { LossReasonDialog } from "@/components/crm/LossReasonDialog";
import { useLossReasons } from "@/hooks/useLossReasons";
import { lossReasonLabel } from "@/lib/loss-reasons";
import { useOrgMembers } from "@/hooks/useOrgMembers";
import { UserFilterSelect } from "@/components/org/UserFilterSelect";
import { InstanceFilterSelect } from "@/components/inbox/InstanceFilterSelect";
import { useOrgWhatsappInstances } from "@/hooks/useOrgWhatsappInstances";
import { coerceInstanceFilter, conversationMatchesInstanceFilter } from "@/lib/view-filters";
import { TransferConversationDialog } from "@/components/org/TransferConversationDialog";
import { ChatComposer, type ComposerPayload } from "@/components/inbox/ChatComposer";
import { MessageMedia } from "@/components/inbox/MessageMedia";
import { MessageWaTicks } from "@/components/inbox/MessageWaTicks";
import { extractUazapiMessageId } from "@/lib/message-wa-status";
import type { WaMessageStatus } from "@/lib/message-wa-status";
import { InboxContactAvatar } from "@/components/inbox/InboxContactAvatar";
import { useContactAvatarEnrichment } from "@/hooks/useContactAvatarEnrichment";
import { assertMediaSize, mediaLabel, uploadChatFile } from "@/lib/chat-media";

type Conversation = {
  id: string;
  contact_phone: string | null;
  wa_phone: string | null;
  contact_email: string | null;
  contact_name: string | null;
  contact_company: string | null;
  contact_city: string | null;
  ai_enabled: boolean;
  last_message_at: string;
  instance_id: string | null;
  human_takeover_at: string | null;
  stage_id: string | null;
  user_id: string;
  loss_reason_id: string | null;
  loss_reason_note: string | null;
  contact_avatar_url: string | null;
  inactivity_followup_at: string | null;
};

function destPhone(c: Conversation): string | null {
  return c.wa_phone || c.contact_phone || null;
}

function stripMediaPrefix(content: string) {
  return content.replace(/^\[(imagem|vídeo|áudio|figurinha|documento)\]\s*/i, "").trim();
}

function priorizarConversas(
  conversas: Conversation[],
  lastInboundAt: Record<string, string>,
  emContatoStageIds: Set<string>,
) {
  const peso = (c: Conversation) => {
    const respondeu = !!lastInboundAt[c.id] || (!!c.stage_id && emContatoStageIds.has(c.stage_id));
    const quando = lastInboundAt[c.id] || c.last_message_at;
    return { respondeu, quando };
  };
  return [...conversas].sort((a, b) => {
    const pa = peso(a);
    const pb = peso(b);
    if (pa.respondeu !== pb.respondeu) return pa.respondeu ? -1 : 1;
    return new Date(pb.quando).getTime() - new Date(pa.quando).getTime();
  });
}

type Message = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender: "contact" | "ai" | "human";
  content: string;
  created_at: string;
  media_type?: string | null;
  media_url?: string | null;
  media_name?: string | null;
  external_id?: string | null;
  wa_status?: WaMessageStatus | null;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const initialOpen = useRef(searchParams.get("open"));
  const pendingOpen = useRef(searchParams.get("open"));
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(searchParams.get("open"));
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
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
  const [leadOpen, setLeadOpen] = useState(false);
  const [lastInboundAt, setLastInboundAt] = useState<Record<string, string>>({});
  const [lastByConv, setLastByConv] = useState<Record<string, LastSnap>>({});
  const [inboxQuery, setInboxQuery] = useState("");
  const { filters, update: updateFilters } = useViewFilters(user?.id);
  const { inboxFilter, tagFilters, userFilter, instanceFilter, followupOnly } = filters;
  const pendingFollowupConvIds = usePendingFollowupConversationIds();
  const orgMembers = useOrgMembers();
  const whatsappInstances = useOrgWhatsappInstances();
  useEffect(() => {
    const next = coerceInstanceFilter(instanceFilter, userFilter, whatsappInstances);
    if (next !== instanceFilter) updateFilters({ instanceFilter: next });
  }, [instanceFilter, userFilter, whatsappInstances, updateFilters]);
  const { catalog: tagCatalog, byConv: tagsByConv, createTag, assign: assignTag, unassign: unassignTag } =
    useLeadTags();
  const scrollRef = useRef<HTMLDivElement>(null);
  const instanceTokenCache = useRef<{ key: string; token: string } | null>(null);
  const inboxReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { activeReasons, reasonById } = useLossReasons();
  const [pendingLossStage, setPendingLossStage] = useState<string | null>(null);
  const [savingLoss, setSavingLoss] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const emContatoStageIds = useMemo(
    () => new Set(stages.filter((s) => ehEmContato(s.name)).map((s) => s.id)),
    [stages],
  );
  const perdidoStageIds = useMemo(
    () => new Set(stages.filter((s) => ehPerdido(s.name)).map((s) => s.id)),
    [stages],
  );
  const encerrado = (c: Conversation) => !!c.stage_id && perdidoStageIds.has(c.stage_id);

  const orderedConversations = useMemo(
    () => priorizarConversas(conversations, lastInboundAt, emContatoStageIds),
    [conversations, lastInboundAt, emContatoStageIds],
  );

  useContactAvatarEnrichment(conversations);

  const hasUnassignedInstance = useMemo(
    () =>
      orderedConversations.some(
        (c) => !c.instance_id && (userFilter === "all" || c.user_id === userFilter),
      ),
    [orderedConversations, userFilter],
  );

  const scopedConversations = useMemo(
    () =>
      orderedConversations.filter(
        (c) =>
          (userFilter === "all" || c.user_id === userFilter) &&
          conversationMatchesInstanceFilter(c.instance_id, instanceFilter, c.user_id, whatsappInstances),
      ),
    [orderedConversations, userFilter, instanceFilter, whatsappInstances],
  );

  const priorityConversations = useMemo(
    () =>
      scopedConversations.filter(
        (c) =>
          !encerrado(c) &&
          (!!lastInboundAt[c.id] || (!!c.stage_id && emContatoStageIds.has(c.stage_id))),
      ),
    [scopedConversations, lastInboundAt, emContatoStageIds, perdidoStageIds],
  );

  const visibleConversations = useMemo(() => {
    const q = inboxQuery.trim();
    const passaBusca = (c: Conversation) =>
      matchesInboxQuery(q, [
        c.contact_name,
        c.contact_company,
        c.contact_city,
        destPhone(c),
        c.contact_email,
        ...(tagsByConv[c.id] ?? []).map((t) => t.name),
      ]);
    const passaFiltro = (c: Conversation) => {
      const closed = encerrado(c);
      if (inboxFilter === "encerrados") return closed;
      if (closed) return false;
      if (inboxFilter === "humano") return !c.ai_enabled;
      if (inboxFilter === "sem_contato") {
        return conversationSemContato(c.id, c.stage_id, lastInboundAt, emContatoStageIds);
      }
      if (inboxFilter === "responder") return precisaResponder(lastByConv[c.id]);
      if (inboxFilter === "aguardando") return !precisaResponder(lastByConv[c.id]);
      return true;
    };
    const passaTag = (c: Conversation) =>
      conversationMatchesTagFilter(
        (tagsByConv[c.id] ?? []).map((t) => t.id),
        tagFilters,
      );
    const passaFollowup = (c: Conversation) =>
      !followupOnly || conversationHasFollowup(c, pendingFollowupConvIds);
    return scopedConversations.filter(
      (c) => passaBusca(c) && passaFiltro(c) && passaTag(c) && passaFollowup(c),
    );
  }, [
    scopedConversations,
    inboxQuery,
    inboxFilter,
    lastByConv,
    tagFilters,
    tagsByConv,
    perdidoStageIds,
    followupOnly,
    pendingFollowupConvIds,
    lastInboundAt,
    emContatoStageIds,
  ]);

  const filteredPriority = useMemo(
    () => visibleConversations.filter((c) => priorityConversations.some((p) => p.id === c.id)),
    [visibleConversations, priorityConversations],
  );
  const filteredWaiting = useMemo(
    () => visibleConversations.filter((c) => !priorityConversations.some((p) => p.id === c.id)),
    [visibleConversations, priorityConversations],
  );
  const flattenList =
    inboxFilter !== "todas" ||
    !!inboxQuery.trim() ||
    tagFilters.length > 0 ||
    userFilter !== "all" ||
    instanceFilter !== "all" ||
    followupOnly;

  const abertos = useMemo(
    () => scopedConversations.filter((c) => !encerrado(c)),
    [scopedConversations, perdidoStageIds],
  );
  const encerradosCount = useMemo(
    () => scopedConversations.filter((c) => encerrado(c)).length,
    [scopedConversations, perdidoStageIds],
  );

  const needsReplyCount = useMemo(
    () => abertos.filter((c) => precisaResponder(lastByConv[c.id])).length,
    [abertos, lastByConv],
  );

  const followupCount = useMemo(
    () => abertos.filter((c) => conversationHasFollowup(c, pendingFollowupConvIds)).length,
    [abertos, pendingFollowupConvIds],
  );

  const semContatoCount = useMemo(
    () =>
      abertos.filter((c) => conversationSemContato(c.id, c.stage_id, lastInboundAt, emContatoStageIds))
        .length,
    [abertos, lastInboundAt, emContatoStageIds],
  );

  const active = useMemo(
    () => orderedConversations.find((c) => c.id === activeId) || null,
    [orderedConversations, activeId],
  );

  const autoEncerradosOpen = useRef<string | null>(null);

  const stripOpenParam = () => {
    setSearchParams(
      (prev) => {
        if (!prev.get("open")) return prev;
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true },
    );
  };

  const selectConversation = (id: string) => {
    pendingOpen.current = null;
    setActiveId(id);
    stripOpenParam();
  };

  useEffect(() => {
    if (!initialOpen.current || activeId !== initialOpen.current) return;
    if (typeof window !== "undefined" && window.innerWidth < 1280) setLeadOpen(true);
  }, [activeId]);

  useEffect(() => {
    const openParam = initialOpen.current;
    if (!openParam || perdidoStageIds.size === 0) return;
    if (autoEncerradosOpen.current === openParam) return;
    const c = conversations.find((x) => x.id === openParam);
    if (c && encerrado(c)) {
      autoEncerradosOpen.current = openParam;
      updateFilters({ inboxFilter: "encerrados" });
    }
  }, [conversations, perdidoStageIds]);

  useEffect(() => {
    if (!searchParams.get("open")) return;
    if (pendingOpen.current) return;
    stripOpenParam();
  }, [searchParams, activeId]);

  const applyMessageToInbox = useCallback((row: Message & { conversation_id: string }) => {
    const snap = lastSnapFromMessage(row);
    setLastByConv((prev) => ({ ...prev, [row.conversation_id]: snap }));
    if (row.direction === "inbound") {
      setLastInboundAt((prev) => {
        const prevAt = prev[row.conversation_id];
        if (prevAt && prevAt >= row.created_at) return prev;
        return { ...prev, [row.conversation_id]: row.created_at };
      });
    }
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === row.conversation_id);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], last_message_at: row.created_at };
      return next;
    });
  }, []);

  const scheduleInboxReload = useCallback(() => {
    if (inboxReloadTimer.current) clearTimeout(inboxReloadTimer.current);
    inboxReloadTimer.current = setTimeout(() => {
      inboxReloadTimer.current = null;
      void loadInboxRef.current?.();
    }, 1200);
  }, []);

  const loadInboxRef = useRef<(() => Promise<void>) | null>(null);

  // Load conversations + realtime (incremental — evita 3 queries a cada mensagem enviada)
  useEffect(() => {
    if (!user) return;

    const loadInbox = async () => {
      const [{ data }, inbound, recent] = await Promise.all([
        supabase.from("conversations").select("*").order("last_message_at", { ascending: false }),
        supabase
          .from("messages")
          .select("conversation_id, created_at")
          .eq("direction", "inbound"),
        supabase
          .from("messages")
          .select("conversation_id, content, direction, sender, created_at")
          .order("created_at", { ascending: false })
          .limit(800),
      ]);
      const inboundMap: Record<string, string> = {};
      for (const row of (inbound.data ?? []) as { conversation_id: string; created_at: string }[]) {
        const prev = inboundMap[row.conversation_id];
        if (!prev || row.created_at > prev) inboundMap[row.conversation_id] = row.created_at;
      }
      const lastMap: Record<string, LastSnap> = {};
      for (const row of (recent.data ?? []) as (LastSnap & { conversation_id: string })[]) {
        if (!lastMap[row.conversation_id]) {
          lastMap[row.conversation_id] = lastSnapFromMessage(row);
        }
      }
      setLastInboundAt(inboundMap);
      setLastByConv(lastMap);
      const list = (data as Conversation[]) || [];
      setConversations(list);
      const ranked = priorizarConversas(list, inboundMap, emContatoStageIds);
      setActiveId((current) => {
        const want = pendingOpen.current;
        if (want && list.some((c) => c.id === want)) {
          pendingOpen.current = null;
          return want;
        }
        if (current && list.some((c) => c.id === current)) return current;
        return ranked[0]?.id ?? current;
      });
    };
    loadInboxRef.current = loadInbox;
    void loadInbox();

    const ch = supabase
      .channel("conversations-list")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        () => scheduleInboxReload(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        (payload) => {
          const row = payload.new as Conversation;
          setConversations((prev) => prev.map((c) => (c.id === row.id ? { ...c, ...row } : c)));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => applyMessageToInbox(payload.new as Message & { conversation_id: string }),
      )
      .subscribe();
    return () => {
      if (inboxReloadTimer.current) clearTimeout(inboxReloadTimer.current);
      supabase.removeChannel(ch);
    };
  }, [user, applyMessageToInbox, scheduleInboxReload, emContatoStageIds]);

  // Load stages
  useEffect(() => {
    if (!user) return;
    supabase
      .from("pipeline_stages")
      .select("*")
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
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            const trimmed = prev.filter(
              (m) =>
                !(
                  m.id.startsWith("temp-") &&
                  m.direction === row.direction &&
                  m.content === row.content
                ),
            );
            return [...trimmed, row];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
        },
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
  }, [user]);

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  const toggleAI = async (enabled: boolean) => {
    if (!active) return;
    if (encerrado(active)) return;
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

  const applyStage = async (
    stageId: string,
    loss?: { reasonId: string | null; note: string },
  ) => {
    if (!active) return;
    const lost = perdidoStageIds.has(stageId);
    const patch = {
      stage_id: stageId,
      ...(lost
        ? {
            loss_reason_id: loss?.reasonId ?? null,
            loss_reason_note: loss?.note || null,
          }
        : { loss_reason_id: null, loss_reason_note: null }),
    };
    const { error } = await supabase.from("conversations").update(patch).eq("id", active.id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === active.id
          ? {
              ...c,
              stage_id: stageId,
              loss_reason_id: patch.loss_reason_id ?? null,
              loss_reason_note: patch.loss_reason_note ?? null,
              ...(lost
                ? { ai_enabled: false, human_takeover_at: c.human_takeover_at || new Date().toISOString() }
                : {}),
            }
          : c,
      ),
    );
    if (lost) {
      setFollowups([]);
      updateFilters({ inboxFilter: "encerrados" });
      toast({ title: "Atendimento encerrado", description: "Lead marcado como perdido." });
    }
  };

  const onConversationTransferred = (payload: {
    conversationId: string;
    userId: string;
    stageId?: string | null;
  }) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === payload.conversationId
          ? { ...c, user_id: payload.userId, stage_id: payload.stageId ?? c.stage_id }
          : c,
      ),
    );
    toast({ title: "Conversa transferida" });
  };

  const leadContextOwnerProps =
    active && orgMembers.length > 1
      ? {
          ownerUserId: active.user_id,
          orgMembers,
          currentUserId: user?.id,
          onTransfer: () => setTransferOpen(true),
        }
      : {};

  const onLeadSaved = (fields: LeadEditableFields) => {
    if (!active) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === active.id ? { ...c, ...fields } : c)),
    );
  };

  const changeStage = (stageId: string) => {
    if (!active || active.stage_id === stageId) return;
    if (perdidoStageIds.has(stageId)) {
      setPendingLossStage(stageId);
      return;
    }
    void applyStage(stageId);
  };

  const confirmLostStage = async (payload: { reasonId: string | null; note: string }) => {
    if (!pendingLossStage) return;
    setSavingLoss(true);
    try {
      await applyStage(pendingLossStage, payload);
      setPendingLossStage(null);
    } finally {
      setSavingLoss(false);
    }
  };

  const activeLossLabel =
    active && encerrado(active)
      ? lossReasonLabel(reasonById(active.loss_reason_id), active.loss_reason_note)
      : null;

  const scheduleFollowup = async () => {
    if (!active || !user) return;
    if (encerrado(active)) {
      toast({ variant: "destructive", title: "Atendimento encerrado" });
      return;
    }
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

  const resolveInstanceToken = async (conv: Conversation) => {
    const key = conv.instance_id ?? `user:${user!.id}`;
    if (instanceTokenCache.current?.key === key) return instanceTokenCache.current.token;
    const { data: inst } = conv.instance_id
      ? await supabase
          .from("whatsapp_instances")
          .select("instance_token")
          .eq("id", conv.instance_id)
          .maybeSingle()
      : await supabase
          .from("whatsapp_instances")
          .select("instance_token")
          .eq("user_id", user!.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
    if (!inst?.instance_token) throw new Error("Nenhuma instância WhatsApp conectada");
    instanceTokenCache.current = { key, token: inst.instance_token };
    return inst.instance_token;
  };

  const sendPayload = async (payload: ComposerPayload) => {
    if (!active) return;
    if (encerrado(active)) {
      toast({ variant: "destructive", title: "Atendimento encerrado", description: "Mude o estágio para reabrir." });
      return;
    }
    const number = destPhone(active);
    if (!number) {
      toast({ variant: "destructive", title: "Sem WhatsApp", description: "Esse contato só tem email — não dá pra mandar mensagem." });
      return;
    }

    const content =
      payload.kind === "text" ? payload.text : mediaLabel(payload.type, payload.caption, payload.name);
    const nowIso = new Date().toISOString();
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: active.id,
      direction: "outbound",
      sender: "human",
      content,
      created_at: nowIso,
      media_type: payload.kind === "media" ? payload.type : null,
      media_url: null,
      media_name: payload.kind === "media" ? payload.name || payload.file.name : null,
      wa_status: "sent",
    };

    setMessages((prev) => [...prev, optimistic]);
    applyMessageToInbox(optimistic);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === active.id
          ? { ...c, last_message_at: nowIso, ai_enabled: false, human_takeover_at: nowIso }
          : c,
      ),
    );

    setSending(true);
    try {
      const instanceToken = await resolveInstanceToken(active);

      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let mediaName: string | null = null;

      let sendExternalId: string | null = null;
      if (payload.kind === "text") {
        const { data, error } = await supabase.functions.invoke("manage-instance", {
          body: {
            action: "send_text",
            instance_token: instanceToken,
            number,
            text: payload.text,
          },
        });
        if (error || !data?.ok) throw new Error(data?.error || error?.message || "Falha ao enviar");
        sendExternalId = extractUazapiMessageId(data?.data ?? data);
      } else {
        assertMediaSize(payload.file, payload.type);
        const uploaded = await uploadChatFile(user!.id, payload.file);
        mediaUrl = uploaded.url;
        mediaType = payload.type;
        mediaName = payload.name || payload.file.name;
        const { data, error } = await supabase.functions.invoke("manage-instance", {
          body: {
            action: "send_media",
            instance_token: instanceToken,
            number,
            type: payload.type,
            file: uploaded.url,
            text: payload.caption || undefined,
            docName: payload.type === "document" ? mediaName : undefined,
          },
        });
        if (error || !data?.ok) throw new Error(data?.error || error?.message || "Falha ao enviar mídia");
        sendExternalId = extractUazapiMessageId(data?.data ?? data);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId ? { ...m, media_url: mediaUrl, media_type: mediaType, media_name: mediaName } : m,
          ),
        );
      }

      const { data: saved, error: insertErr } = await supabase
        .from("messages")
        .insert({
          conversation_id: active.id,
          user_id: user!.id,
          direction: "outbound",
          sender: "human",
          content,
          media_type: mediaType,
          media_url: mediaUrl,
          media_name: mediaName,
          external_id: sendExternalId,
          wa_status: "sent",
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      if (saved) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? (saved as Message) : m)));
      }

      void supabase
        .from("conversations")
        .update({
          last_message_at: nowIso,
          ai_enabled: false,
          human_takeover_at: nowIso,
        })
        .eq("id", active.id);
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast({ variant: "destructive", title: "Erro", description: e.message });
      throw e;
    } finally {
      setSending(false);
    }
  };

  const conversationRow = (c: Conversation, respondeu: boolean) => {
    const last = lastByConv[c.id];
    const closed = encerrado(c);
    const waiting = !closed && precisaResponder(last);
    const title = leadTitle(c);
    const stage = stages.find((s) => s.id === c.stage_id);
    const prefix = last?.direction === "outbound" ? (last.sender === "ai" ? "Edith: " : "Você: ") : "";
    return (
      <button
        key={c.id}
        onClick={() => selectConversation(c.id)}
        className={`w-full text-left px-3 py-2.5 border-b border-border/80 hover:bg-muted/70 transition ${
          c.id === activeId ? "bg-muted" : ""
        } ${waiting ? "border-l-2 border-l-primary" : "border-l-2 border-l-transparent"}`}
      >
        <div className="flex gap-2.5">
          <InboxContactAvatar title={title} avatarUrl={c.contact_avatar_url} waiting={waiting} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-sm truncate">{title}</span>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {formatInboxTime(last?.created_at || c.last_message_at)}
              </span>
            </div>
            <div className={`text-xs truncate ${waiting ? "text-foreground" : "text-muted-foreground"}`}>
              {prefix}
              {previewText(last?.content)}
            </div>
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              {closed && (
                <Badge variant="secondary" className="text-[10px]">
                  Encerrado
                </Badge>
              )}
              {waiting && (
                <Badge variant="ok" className="text-[10px]">
                  Sua vez
                </Badge>
              )}
              {respondeu && !waiting && !closed && (
                <Badge variant="secondary" className="text-[10px]">
                  Respondeu
                </Badge>
              )}
              {stage && (
                <span className="text-[10px] text-muted-foreground truncate max-w-[90px]">{stage.name}</span>
              )}
              {!closed && (
                <span className="text-[10px] text-muted-foreground">{c.ai_enabled ? "IA" : "Você"}</span>
              )}
              {orgMembers.length > 1 && userFilter === "all" && (
                <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                  {orgMembers.find((m) => m.user_id === c.user_id)?.name ||
                    (c.user_id === user?.id ? "Você" : "Conta")}
                </span>
              )}
            </div>
            {(tagsByConv[c.id] ?? []).length > 0 && (
              <div className="mt-1">
                <LeadTagChips tags={tagsByConv[c.id] ?? []} max={2} />
              </div>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="dryos h-screen flex flex-col bg-background text-foreground">
      <MainHeader
        configNeedsAttention={needsSetup}
        onLogout={handleLogout}
        trailing={
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/crm")} title="CRM">
            <Trello className="w-4 h-4" />
          </Button>
        }
      />

      {/* Main */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[340px_1fr] gap-0 overflow-hidden">
        {/* Sidebar list */}
        <div className="border-r overflow-hidden flex flex-col bg-card">
          <div className="p-3 border-b space-y-2.5 shrink-0 sticky top-0 z-10 bg-card">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> Inbox
              </div>
              {needsReplyCount > 0 && (
                <span className="text-[11px] tabular-nums text-primary font-medium">{needsReplyCount} na sua vez</span>
              )}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={inboxQuery}
                onChange={(e) => setInboxQuery(e.target.value)}
                placeholder="Buscar nome, escritório, telefone"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["todas", "Todas", abertos.length],
                  ["responder", "Sua vez", needsReplyCount],
                  ["aguardando", "Aguardando", Math.max(0, abertos.length - needsReplyCount)],
                  ["sem_contato", "Sem contato", semContatoCount],
                  ["humano", "Com você", abertos.filter((c) => !c.ai_enabled).length],
                  ["encerrados", "Encerrados", encerradosCount],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => updateFilters({ inboxFilter: id })}
                  className={`px-2 py-1 rounded-md text-[11px] transition ${
                    inboxFilter === id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                  <span className="tabular-nums opacity-80"> {count}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => updateFilters({ followupOnly: !followupOnly })}
                className={`px-2 py-1 rounded-md text-[11px] transition ${
                  followupOnly
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                Follow-up
                <span className="tabular-nums opacity-80"> {followupCount}</span>
              </button>
            </div>
            <InstanceFilterSelect
              instances={whatsappInstances}
              members={orgMembers}
              currentUserId={user?.id}
              value={instanceFilter}
              onChange={(next) => updateFilters({ instanceFilter: next })}
              showUnassigned={hasUnassignedInstance}
              userFilter={userFilter}
              className="h-8 w-full text-xs"
            />
            <UserFilterSelect
              members={orgMembers}
              currentUserId={user?.id}
              value={userFilter}
              onChange={(next) => updateFilters({ userFilter: next })}
              className="h-8 w-full text-xs"
            />
            <TagFilterSelect catalog={tagCatalog} value={tagFilters} onChange={(next) => updateFilters({ tagFilters: next })} className="h-8 w-full text-xs" />
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
            {orderedConversations.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground text-center">
                Nenhuma conversa ainda. Quando o WhatsApp receber mensagens, elas aparecem aqui.
              </div>
            )}
            {orderedConversations.length > 0 && visibleConversations.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground text-center">Nada neste filtro.</div>
            )}
            {flattenList
              ? visibleConversations.map((c) =>
                  conversationRow(
                    c,
                    !!lastInboundAt[c.id] || (!!c.stage_id && emContatoStageIds.has(c.stage_id)),
                  ),
                )
              : (
                <>
                  {filteredPriority.length > 0 && (
                    <div className="px-3 pt-3 pb-1 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                      Responderam · {filteredPriority.length}
                    </div>
                  )}
                  {filteredPriority.map((c) => conversationRow(c, true))}
                  {filteredWaiting.length > 0 && (
                    <div className="px-3 pt-3 pb-1 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                      Aguardando · {filteredWaiting.length}
                    </div>
                  )}
                  {filteredWaiting.map((c) => conversationRow(c, false))}
                </>
              )}
          </div>
        </div>

        {/* Chat + contexto do lead */}
        <div className="flex min-w-0 overflow-hidden">
        <div className="flex-1 flex flex-col bg-background overflow-hidden min-w-0">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Selecione uma conversa
            </div>
          ) : (
            <>
              <div className="p-3 border-b flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <InboxContactAvatar
                    title={leadTitle(active)}
                    avatarUrl={active.contact_avatar_url}
                    waiting={precisaResponder(lastByConv[active.id])}
                    size="md"
                    className="mt-0"
                  />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{leadTitle(active)}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[leadPerson(active), active.contact_city].filter(Boolean).join(" · ")}
                      {destPhone(active) && (
                        <>
                          {" · "}
                          {waMeUrl(destPhone(active)) ? (
                            <a
                              href={waMeUrl(destPhone(active))!}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              {destPhone(active)}
                            </a>
                          ) : (
                            destPhone(active)
                          )}
                        </>
                      )}
                      {!destPhone(active) && active.contact_email ? ` · ${active.contact_email}` : null}
                      {encerrado(active) ? (
                        <span className="ml-2 text-muted-foreground">· Encerrado</span>
                      ) : (
                        !active.ai_enabled &&
                        active.human_takeover_at && (
                          <span className="ml-2 text-primary">· Você assumiu</span>
                        )
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {orgMembers.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1.5 hidden sm:inline-flex"
                      onClick={() => setTransferOpen(true)}
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      Transferir
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="xl:hidden h-8 px-2"
                    onClick={() => setLeadOpen(true)}
                    title="Dados do lead"
                  >
                    <PanelRight className="w-4 h-4" />
                  </Button>
                  {stages.length > 0 && (
                    <Select value={active.stage_id ?? undefined} onValueChange={changeStage}>
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue placeholder="Stage" />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ background: s.color || "#94a3b8" }}
                              />
                              {s.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <label className={`flex items-center gap-2 text-xs ${encerrado(active) ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}>
                    {active.ai_enabled ? (
                      <Bot className="w-4 h-4 text-primary" />
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                    {encerrado(active) ? "Encerrado" : active.ai_enabled ? "Edith" : "Você"}
                    <Switch
                      checked={active.ai_enabled}
                      disabled={encerrado(active)}
                      onCheckedChange={toggleAI}
                    />
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
                  {encerrado(active) ? (
                    <span className="text-muted-foreground">Atendimento encerrado — follow-ups cancelados.</span>
                  ) : (
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
                  )}
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

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/20">
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const showDate =
                    !prev || threadDateLabel(prev.created_at) !== threadDateLabel(m.created_at);
                  const outbound = m.direction === "outbound";
                  const who = outbound ? (m.sender === "ai" ? "Edith" : "Você") : leadPerson(active) || "Lead";
                  return (
                    <div key={m.id}>
                      {showDate && (
                        <div className="flex justify-center my-3">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-background border rounded-full px-2.5 py-0.5">
                            {threadDateLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                            outbound
                              ? "bg-bubble text-bubble-foreground rounded-br-md"
                              : "bg-bubble-in text-bubble-in-foreground border rounded-bl-md"
                          }`}
                        >
                          <div className={`text-[10px] mb-0.5 ${outbound ? "text-bubble-foreground/55" : "text-muted-foreground"}`}>
                            {who}
                          </div>
                          {m.media_url ? (
                            <>
                              <MessageMedia message={m} />
                              {stripMediaPrefix(m.content) ? (
                                <div className="whitespace-pre-wrap">{stripMediaPrefix(m.content)}</div>
                              ) : null}
                            </>
                          ) : (
                            <div className="whitespace-pre-wrap">{m.content}</div>
                          )}
                          <div
                            className={`text-[10px] mt-1 flex items-center justify-end gap-1 tabular-nums ${
                              outbound ? "text-bubble-foreground/55" : "text-muted-foreground"
                            }`}
                          >
                            {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {outbound && <MessageWaTicks status={m.wa_status} />}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {encerrado(active) ? (
                <div className="border-t px-4 py-3 text-sm text-muted-foreground bg-muted/40">
                  Atendimento encerrado. Este lead está em Perdido — mude o estágio para reabrir.
                </div>
              ) : (
              <ChatComposer
                disabled={!destPhone(active)}
                sending={sending}
                aiEnabled={active.ai_enabled}
                placeholder={
                  !destPhone(active)
                    ? "Contato sem WhatsApp — só tem email"
                    : active.ai_enabled
                      ? "Escreva para assumir a conversa…"
                      : "Escreva sua resposta…"
                }
                onSend={sendPayload}
              />
              )}
            </>
          )}
        </div>
        {active && (
          <aside className="hidden xl:flex w-[340px] shrink-0 flex-col border-l bg-card overflow-y-auto p-4">
            <LeadContextBody
              conversation={active}
              lossLabel={activeLossLabel}
              onSaved={onLeadSaved}
              {...leadContextOwnerProps}
              tags={{
                catalog: tagCatalog,
                assigned: tagsByConv[active.id] ?? [],
                createTag,
                assign: assignTag,
                unassign: unassignTag,
              }}
            />
          </aside>
        )}
        </div>
      </div>
      <Sheet open={leadOpen} onOpenChange={setLeadOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Dados do lead</SheetTitle>
          </SheetHeader>
          {active && (
            <div className="mt-6">
              <LeadContextBody
                conversation={active}
                lossLabel={activeLossLabel}
                onSaved={onLeadSaved}
                {...leadContextOwnerProps}
                tags={{
                  catalog: tagCatalog,
                  assigned: tagsByConv[active.id] ?? [],
                  createTag,
                  assign: assignTag,
                  unassign: unassignTag,
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
      <TransferConversationDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        conversationId={active?.id ?? null}
        ownerUserId={active?.user_id ?? null}
        sourceStageName={active?.stage_id ? stages.find((s) => s.id === active.stage_id)?.name : null}
        leadLabel={active ? leadTitle(active) : undefined}
        members={orgMembers}
        currentUserId={user?.id}
        onTransferred={onConversationTransferred}
      />
      <LossReasonDialog
        open={!!pendingLossStage}
        onOpenChange={(o) => !o && !savingLoss && setPendingLossStage(null)}
        reasons={activeReasons}
        saving={savingLoss}
        onConfirm={confirmLostStage}
      />
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
