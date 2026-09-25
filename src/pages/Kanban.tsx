import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
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
import { Bot, Clock, LogOut, Plus, Settings, Trash2, User, Pencil } from "lucide-react";
import { ConfigDrawer } from "@/components/ConfigDrawer";
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
  contact_phone: string | null;
  contact_email: string | null;
  stage_id: string | null;
  ai_enabled: boolean;
  last_message_at: string;
  inactivity_followup_at: string | null;
};

function Card({ c }: { c: Conversation }) {
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
        <div className="font-medium text-sm truncate">{c.contact_name || c.contact_phone || c.contact_email}</div>
        <Badge variant={c.ai_enabled ? "default" : "secondary"} className="text-[10px] shrink-0">
          {c.ai_enabled ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground truncate">{c.contact_phone || c.contact_email}</div>
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
  onRename,
  onDelete,
}: {
  stage: Stage;
  cards: Conversation[];
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  return (
    <div className="w-72 shrink-0 flex flex-col bg-muted/40 rounded-lg border">
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
          <Card key={c.id} c={c} />
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
  const [configOpen, setConfigOpen] = useState(false);
  const [addStageOpen, setAddStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [stageToDelete, setStageToDelete] = useState<Stage | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const loadStages = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("user_id", user.id)
      .order("position", { ascending: true });
    setStages((data as Stage[]) || []);
  };
  const loadConvs = async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, contact_name, contact_phone, contact_email, stage_id, ai_enabled, last_message_at, inactivity_followup_at")
      .order("last_message_at", { ascending: false });
    setConversations((data as Conversation[]) || []);
  };

  useEffect(() => {
    if (!user) return;
    loadStages();
    loadConvs();
    const ch = supabase
      .channel("kanban-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `user_id=eq.${user.id}` }, loadConvs)
      .on("postgres_changes", { event: "*", schema: "public", table: "pipeline_stages", filter: `user_id=eq.${user.id}` }, loadStages)
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
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, stage_id: newStageId } : c)),
    );
    const { error } = await supabase
      .from("conversations")
      .update({ stage_id: newStageId })
      .eq("id", convId);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadConvs();
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
      .insert({ user_id: user.id, name, position: pos })
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
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <nav className="hidden sm:flex items-center gap-1 ml-2">
            <Link to="/" className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition">
              Conversas
            </Link>
            <Link to="/kanban" className="px-3 py-1.5 text-sm rounded-md bg-muted font-medium">
              Kanban
            </Link>
            <Link to="/prospeccao" className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition">
              Prospecção
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setConfigOpen(true)}>
            <Settings className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Configuração</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={async () => { await signOut(); navigate("/login"); }} title="Sair">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <ConfigDrawer open={configOpen} onOpenChange={setConfigOpen} />

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
                  <div className="font-medium mb-1">Seu Kanban está vazio</div>
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
                cards={conversations.filter((c) => c.stage_id === s.id)}
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
            {activeCard && <Card c={activeCard} />}
          </DragOverlay>
        </DndContext>
      </div>
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