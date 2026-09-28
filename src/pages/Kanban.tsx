import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { MainHeader } from "@/components/layout/MainHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { Bot, Clock, Plus, Trash2, User, Pencil, Building2, Columns3, ArrowRightLeft } from "lucide-react";
import { TransferConversationDialog } from "@/components/org/TransferConversationDialog";
import { FunnelStagesDialog } from "@/components/crm/FunnelStagesDialog";
import { nextFunnelColor } from "@/lib/funnel-colors";
import { leadPerson, leadTitle } from "@/components/lead/LeadContextPanel";
import { LeadTagChips, TagFilterSelect } from "@/components/lead/LeadTagEditor";
import { useLeadTags } from "@/hooks/useLeadTags";
import { useOrgMembers } from "@/hooks/useOrgMembers";
import { useViewFilters } from "@/hooks/useViewFilters";
import { UserFilterSelect } from "@/components/org/UserFilterSelect";
import { InstanceFilterSelect } from "@/components/inbox/InstanceFilterSelect";
import { useOrgWhatsappInstances } from "@/hooks/useOrgWhatsappInstances";
import { coerceInstanceFilter, conversationMatchesInstanceFilter } from "@/lib/view-filters";
import { ehPerdido } from "@/lib/inbox";
import type { LeadTag } from "@/lib/lead-tags";
import { LossReasonDialog } from "@/components/crm/LossReasonDialog";
import { useLossReasons } from "@/hooks/useLossReasons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

type Stage = { id: string; name: string; position: number; color: string | null };
type Conversation = {
  id: string;
  contact_name: string | null;
  contact_company: string | null;
  contact_city: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  stage_id: string | null;
  ai_enabled: boolean;
  last_message_at: string;
  inactivity_followup_at: string | null;
  user_id: string;
  instance_id: string | null;
  loss_reason_id: string | null;
  loss_reason_note: string | null;
};

function Card({
  c,
  tags,
  ownerLabel,
  onTransfer,
}: {
  c: Conversation;
  tags?: LeadTag[];
  ownerLabel?: string | null;
  onTransfer?: (c: Conversation) => void;
}) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => navigate(`/?open=${c.id}`)}
      className={`bg-background border rounded-md p-3 cursor-grab active:cursor-grabbing hover:border-primary transition ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="font-medium text-sm truncate flex items-center gap-1.5 min-w-0">
          {c.contact_company && <Building2 className="w-3 h-3 shrink-0 text-muted-foreground" />}
          <span className="truncate">{leadTitle(c)}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onTransfer && (
            <button
              type="button"
              title="Transferir conversa"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onTransfer(c);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
          )}
          <Badge variant={c.ai_enabled ? "default" : "secondary"} className="text-[10px] shrink-0">
            {c.ai_enabled ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
          </Badge>
        </div>
      </div>
      {leadPerson(c) && <div className="text-xs text-foreground truncate">{leadPerson(c)}</div>}
      {c.contact_city && <div className="text-xs text-muted-foreground truncate">{c.contact_city}</div>}
      <div className="text-xs text-muted-foreground truncate">{c.contact_phone || c.contact_email}</div>
      {ownerLabel && <div className="text-[10px] text-muted-foreground truncate mt-1">{ownerLabel}</div>}
      {tags && tags.length > 0 && (
        <div className="mt-2">
          <LeadTagChips tags={tags} max={2} />
        </div>
      )}
      {c.inactivity_followup_at && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-primary">
          <Clock className="w-3 h-3" /> Follow-up agendado
        </div>
      )}
    </div>
  );
}

function Column({
  stage,
  cards,
  tagsByConv,
  ownerOf,
  onTransfer,
  onRename,
  onDelete,
}: {
  stage: Stage;
  cards: Conversation[];
  tagsByConv: Record<string, LeadTag[]>;
  ownerOf?: (c: Conversation) => string | null;
  onTransfer?: (c: Conversation) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  return (
    <div
      className="w-72 shrink-0 flex flex-col bg-muted/40 rounded-lg border overflow-hidden"
      style={{ borderTopWidth: 3, borderTopColor: stage.color || "hsl(var(--border))" }}
    >
      <div className="p-3 border-b flex items-center justify-between gap-2">
        {editing ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (name.trim() && name !== stage.name) onRename(stage.id, name.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(stage.name);
                setEditing(false);
              }
            }}
            autoFocus
            className="h-7 text-sm"
          />
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            {stage.color && (
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.color }} />
            )}
            <span className="font-medium text-sm truncate">{stage.name}</span>
            <span className="text-xs text-muted-foreground">{cards.length}</span>
          </div>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-muted-foreground hover:text-foreground p-1"
            title="Renomear"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => onDelete(stage.id)}
            className="text-muted-foreground hover:text-destructive p-1"
            title="Apagar coluna"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 p-2 space-y-2 min-h-[200px] overflow-y-auto transition ${
          isOver ? "bg-primary/5" : ""
        }`}
      >
        {cards.map((c) => (
          <Card key={c.id} c={c} tags={tagsByConv[c.id]} ownerLabel={ownerOf?.(c)} onTransfer={onTransfer} />
        ))}
      </div>
    </div>
  );
}

export default function Kanban() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [stages, setStages] = useState<Stage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeCard, setActiveCard] = useState<Conversation | null>(null);
  const [addStageOpen, setAddStageOpen] = useState(false);
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [stageToDelete, setStageToDelete] = useState<Stage | null>(null);
  const { filters, update: updateFilters } = useViewFilters(user?.id);
  const { tagFilter, userFilter, instanceFilter } = filters;
  const orgMembers = useOrgMembers();
  const whatsappInstances = useOrgWhatsappInstances();
  useEffect(() => {
    const next = coerceInstanceFilter(instanceFilter, userFilter, whatsappInstances);
    if (next !== instanceFilter) updateFilters({ instanceFilter: next });
  }, [instanceFilter, userFilter, whatsappInstances, updateFilters]);
  const { catalog: tagCatalog, byConv: tagsByConv } = useLeadTags();
  const { activeReasons } = useLossReasons();
  const [pendingLoss, setPendingLoss] = useState<{ convId: string; stageId: string } | null>(null);
  const [savingLoss, setSavingLoss] = useState(false);
  const [transferConv, setTransferConv] = useState<Conversation | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const hasUnassignedInstance = conversations.some(
    (c) => !c.instance_id && (userFilter === "all" || c.user_id === userFilter),
  );
  const visibleConversations = conversations.filter((c) => {
    if (tagFilter !== "all" && !(tagsByConv[c.id] ?? []).some((t) => t.id === tagFilter)) return false;
    if (userFilter !== "all" && c.user_id !== userFilter) return false;
    if (!conversationMatchesInstanceFilter(c.instance_id, instanceFilter, c.user_id, whatsappInstances)) return false;
    return true;
  });
  const kanbanMembers = (() => {
    const known = new Map(orgMembers.map((m) => [m.user_id, m]));
    for (const c of conversations) {
      if (!c.user_id || known.has(c.user_id)) continue;
      known.set(c.user_id, {
        user_id: c.user_id,
        name: c.user_id === user?.id ? "Você" : "Conta",
        email: null,
      });
    }
    return [...known.values()];
  })();
  const ownerOf = (c: Conversation) => {
    if (kanbanMembers.length < 2 || userFilter !== "all") return null;
    const m = kanbanMembers.find((x) => x.user_id === c.user_id);
    if (m?.user_id === user?.id) return "Você";
    return m?.name ?? "Conta";
  };

  const canTransfer = kanbanMembers.length > 1;
  const onTransferCard = canTransfer ? (c: Conversation) => setTransferConv(c) : undefined;

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
    setTransferConv(null);
    toast({ title: "Conversa transferida" });
  };

  const loadStages = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .order("position", { ascending: true });
    setStages((data as Stage[]) || []);
  };
  const loadConvs = async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, contact_name, contact_company, contact_city, contact_phone, contact_email, stage_id, ai_enabled, last_message_at, inactivity_followup_at, user_id, instance_id, loss_reason_id, loss_reason_note")
      .order("last_message_at", { ascending: false });
    setConversations((data as Conversation[]) || []);
  };

  useEffect(() => {
    if (!user) return;
    loadStages();
    loadConvs();
    const ch = supabase
      .channel("kanban-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, loadConvs)
      .on("postgres_changes", { event: "*", schema: "public", table: "pipeline_stages" }, loadStages)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const onDragStart = (e: DragStartEvent) => {
    const c = conversations.find((x) => x.id === e.active.id);
    setActiveCard(c || null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveCard(null);
    if (!e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith("stage-")) return;
    const newStageId = overId.replace("stage-", "");
    const convId = String(e.active.id);
    const conv = conversations.find((c) => c.id === convId);
    if (!conv || conv.stage_id === newStageId) return;

    // optimistic
    const lost = ehPerdido(stages.find((s) => s.id === newStageId)?.name);
    if (lost) {
      setPendingLoss({ convId, stageId: newStageId });
      return;
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, stage_id: newStageId, loss_reason_id: null, loss_reason_note: null }
          : c,
      ),
    );
    const { error } = await supabase
      .from("conversations")
      .update({ stage_id: newStageId, loss_reason_id: null, loss_reason_note: null })
      .eq("id", convId);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadConvs();
    }
  };

  const confirmLost = async (payload: { reasonId: string | null; note: string }) => {
    if (!pendingLoss) return;
    setSavingLoss(true);
    const { convId, stageId } = pendingLoss;
    try {
      const { error } = await supabase
        .from("conversations")
        .update({
          stage_id: stageId,
          loss_reason_id: payload.reasonId,
          loss_reason_note: payload.note || null,
        })
        .eq("id", convId);
      if (error) throw error;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                stage_id: stageId,
                loss_reason_id: payload.reasonId,
                loss_reason_note: payload.note || null,
                ai_enabled: false,
                inactivity_followup_at: null,
              }
            : c,
        ),
      );
      setPendingLoss(null);
      toast({ title: "Lead marcado como perdido" });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: e instanceof Error ? e.message : "Falha ao salvar",
      });
      loadConvs();
    } finally {
      setSavingLoss(false);
    }
  };

  const openAddStage = () => {
    setNewStageName("");
    setAddStageOpen(true);
  };

  const addStage = async () => {
    if (!user) return;
    const name = newStageName.trim();
    if (!name) return;
    const pos = (stages[stages.length - 1]?.position ?? -1) + 1;
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({ user_id: user.id, name, position: pos, color: nextFunnelColor(stages.map((s) => s.color)) })
      .select()
      .single();
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    if (data) {
      setStages((prev) => [...prev, data as Stage]);
    }
    setAddStageOpen(false);
    setNewStageName("");
  };

  const addStageWithColor = async (name: string, color: string) => {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const pos = (stages[stages.length - 1]?.position ?? -1) + 1;
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({ user_id: user.id, name: trimmed, position: pos, color })
      .select()
      .single();
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    if (data) setStages((prev) => [...prev, data as Stage]);
  };

  const reorderStages = async (ordered: Stage[]) => {
    const next = ordered.map((s, i) => ({ ...s, position: i }));
    setStages(next);
    const results = await Promise.all(
      next.map((s) => supabase.from("pipeline_stages").update({ position: s.position }).eq("id", s.id)),
    );
    const err = results.find((r) => r.error)?.error;
    if (err) {
      toast({ variant: "destructive", title: "Erro", description: err.message });
      loadStages();
    }
  };

  const setStageColor = async (id: string, color: string) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, color } : s)));
    const { error } = await supabase.from("pipeline_stages").update({ color }).eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadStages();
    }
  };

  const seedDefaults = async () => {
    if (!user) return;
    const { error } = await supabase.rpc("seed_pipeline_stages", { _user_id: user.id });
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    await loadStages();
  };

  const renameStage = async (id: string, name: string) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    const { error } = await supabase.from("pipeline_stages").update({ name }).eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadStages();
    }
  };

  const requestDeleteStage = (id: string) => {
    if (stages.length <= 1) {
      toast({ variant: "destructive", title: "Precisa ter pelo menos 1 coluna" });
      return;
    }
    const s = stages.find((x) => x.id === id);
    if (s) setStageToDelete(s);
  };

  const confirmDeleteStage = async () => {
    if (!stageToDelete) return;
    const id = stageToDelete.id;
    const inThis = conversations.filter((c) => c.stage_id === id).length;
    const first = stages.find((s) => s.id !== id);
    if (first && inThis > 0) {
      await supabase.from("conversations").update({ stage_id: first.id }).eq("stage_id", id);
      setConversations((prev) =>
        prev.map((c) => (c.stage_id === id ? { ...c, stage_id: first.id } : c)),
      );
    }
    await supabase.from("pipeline_stages").delete().eq("id", id);
    setStages((prev) => prev.filter((s) => s.id !== id));
    setStageToDelete(null);
  };

  return (
    <div className="dryos h-screen flex flex-col bg-background text-foreground">
      <MainHeader
        onLogout={async () => {
          await signOut();
          navigate("/login");
        }}
      />

      <div className="border-b border-border px-4 py-2 flex flex-wrap items-center gap-2 shrink-0 sticky top-0 z-10 bg-card">
        <InstanceFilterSelect
          instances={whatsappInstances}
          members={kanbanMembers}
          currentUserId={user?.id}
          value={instanceFilter}
          onChange={(next) => updateFilters({ instanceFilter: next })}
          showUnassigned={hasUnassignedInstance}
          userFilter={userFilter}
        />
        <UserFilterSelect
          members={kanbanMembers}
          currentUserId={user?.id}
          value={userFilter}
          onChange={(next) => updateFilters({ userFilter: next })}
        />
        <TagFilterSelect catalog={tagCatalog} value={tagFilter} onChange={(next) => updateFilters({ tagFilter: next })} />
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFunnelOpen(true)}>
          <Columns3 className="w-3.5 h-3.5 mr-1.5" />
          Etapas do funil
        </Button>
      </div>

      <LossReasonDialog
        open={!!pendingLoss}
        onOpenChange={(o) => !o && !savingLoss && setPendingLoss(null)}
        reasons={activeReasons}
        saving={savingLoss}
        onConfirm={confirmLost}
      />

      <FunnelStagesDialog
        open={funnelOpen}
        onOpenChange={setFunnelOpen}
        stages={stages}
        defaultAddColor={nextFunnelColor(stages.map((s) => s.color))}
        onReorder={reorderStages}
        onRename={renameStage}
        onColor={setStageColor}
        onAdd={addStageWithColor}
        onDelete={requestDeleteStage}
        onSeed={seedDefaults}
      />

      <Dialog open={addStageOpen} onOpenChange={setAddStageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova coluna</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Nome da coluna"
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addStage();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStageOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={addStage} disabled={!newStageName.trim()}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-4 h-full">
            {stages.length === 0 && (
              <div className="w-full flex items-center justify-center">
                <div className="text-center max-w-sm border-2 border-dashed rounded-lg p-8">
                  <div className="font-medium mb-1">Seu CRM está vazio</div>
                  <div className="text-sm text-muted-foreground mb-4">
                    Comece com um pipeline padrão de vendas: Novo Lead → Em Negociação → Fechado. Você pode renomear, apagar ou adicionar colunas depois.
                  </div>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" onClick={seedDefaults}>
                      <Plus className="w-4 h-4 mr-1" /> Criar colunas padrão
                    </Button>
                    <Button size="sm" variant="outline" onClick={openAddStage}>
                      Nova coluna
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {stages.map((s) => (
              <Column
                key={s.id}
                stage={s}
                cards={visibleConversations.filter((c) => c.stage_id === s.id)}
                tagsByConv={tagsByConv}
                ownerOf={ownerOf}
                onTransfer={onTransferCard}
                onRename={renameStage}
                onDelete={requestDeleteStage}
              />
            ))}
            {stages.length > 0 && (
              <button
                onClick={openAddStage}
                className="w-72 shrink-0 border-2 border-dashed rounded-lg flex items-center justify-center text-sm text-muted-foreground hover:text-foreground hover:border-primary transition min-h-[120px]"
              >
                <Plus className="w-4 h-4 mr-2" /> Nova coluna
              </button>
            )}
          </div>
          <DragOverlay>
            {activeCard && (
              <Card
                c={activeCard}
                tags={tagsByConv[activeCard.id]}
                ownerLabel={ownerOf(activeCard)}
                onTransfer={onTransferCard}
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>
      <TransferConversationDialog
        open={!!transferConv}
        onOpenChange={(o) => !o && setTransferConv(null)}
        conversationId={transferConv?.id ?? null}
        ownerUserId={transferConv?.user_id ?? null}
        leadLabel={transferConv ? leadTitle(transferConv) : undefined}
        members={kanbanMembers}
        currentUserId={user?.id}
        onTransferred={onConversationTransferred}
      />
      <AlertDialog open={!!stageToDelete} onOpenChange={(o) => !o && setStageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar coluna?</AlertDialogTitle>
            <AlertDialogDescription>
              {stageToDelete
                ? (() => {
                    const n = conversations.filter((c) => c.stage_id === stageToDelete.id).length;
                    return n > 0
                      ? `Esta coluna contém ${n} conversa(s). Elas serão movidas para a primeira coluna.`
                      : "Esta coluna está vazia.";
                  })()
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteStage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}