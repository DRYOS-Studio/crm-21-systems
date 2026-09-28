import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FUNNEL_COLORS } from "@/lib/funnel-colors";

export type FunnelStage = { id: string; name: string; position: number; color: string | null };

function ColorSwatches({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {FUNNEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(c)}
          className={`h-5 w-5 rounded-full border shrink-0 transition ${
            value?.toLowerCase() === c.toLowerCase()
              ? "ring-2 ring-offset-2 ring-foreground scale-110"
              : "hover:scale-105"
          }`}
          style={{ background: c }}
        />
      ))}
      <label className="relative h-5 w-5 rounded-full border overflow-hidden cursor-pointer shrink-0" title="Cor personalizada">
        <input
          type="color"
          value={value && /^#/.test(value) ? value : "#3FB8BE"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        <span
          className="block h-full w-full"
          style={{
            background:
              "conic-gradient(#ef4444, #f59e0b, #10b981, #3fb8be, #6366f1, #ec4899, #ef4444)",
          }}
        />
      </label>
    </div>
  );
}

function SortableStage({
  stage,
  canDelete,
  onRename,
  onColor,
  onDelete,
}: {
  stage: FunnelStage;
  canDelete: boolean;
  onRename: (id: string, name: string) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });
  const [name, setName] = useState(stage.name);
  useEffect(() => {
    setName(stage.name);
  }, [stage.name]);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border bg-card p-3 space-y-2.5 ${isDragging ? "opacity-60 shadow-md" : ""}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing p-0.5 shrink-0"
          title="Arrastar para reordenar"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <span
          className="h-3 w-3 rounded-full shrink-0 border"
          style={{ background: stage.color || "#94a3b8" }}
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (!next) {
              setName(stage.name);
              return;
            }
            if (next !== stage.name) onRename(stage.id, next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setName(stage.name);
          }}
          className="h-8 text-sm"
        />
        <button
          type="button"
          disabled={!canDelete}
          onClick={() => onDelete(stage.id)}
          className="text-muted-foreground hover:text-destructive p-1 shrink-0 disabled:opacity-30"
          title={canDelete ? "Apagar etapa" : "Precisa ter pelo menos 1 etapa"}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <ColorSwatches value={stage.color} onChange={(c) => onColor(stage.id, c)} />
    </div>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: FunnelStage[];
  defaultAddColor: string;
  onReorder: (ordered: FunnelStage[]) => void;
  onRename: (id: string, name: string) => void;
  onColor: (id: string, color: string) => void;
  onAdd: (name: string, color: string) => Promise<void> | void;
  onDelete: (id: string) => void;
  onSeed?: () => void;
};

export function FunnelStagesDialog({
  open,
  onOpenChange,
  stages,
  defaultAddColor,
  onReorder,
  onRename,
  onColor,
  onAdd,
  onDelete,
  onSeed,
}: Props) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(defaultAddColor);
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (open) setNewColor(defaultAddColor);
  }, [open, defaultAddColor]);
  const ids = useMemo(() => stages.map((s) => s.id), [stages]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = stages.findIndex((s) => s.id === active.id);
    const to = stages.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(stages, from, to));
  };

  const submitAdd = async () => {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      await onAdd(name, newColor);
      setNewName("");
      setNewColor(defaultAddColor);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Etapas do funil</DialogTitle>
          <DialogDescription>
            Arraste para mudar a ordem. A cor aparece no CRM e no seletor de estágio das conversas.
          </DialogDescription>
        </DialogHeader>

        {stages.length === 0 ? (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>Nenhuma etapa ainda. Crie o funil padrão ou adicione uma etapa abaixo.</p>
            {onSeed && (
              <Button size="sm" onClick={onSeed}>
                Criar etapas padrão
              </Button>
            )}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <div className="space-y-2 overflow-y-auto pr-1 -mr-1 max-h-[46vh]">
                {stages.map((s) => (
                  <SortableStage
                    key={s.id}
                    stage={s}
                    canDelete={stages.length > 1}
                    onRename={onRename}
                    onColor={onColor}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div className="border-t pt-3 space-y-2">
          <Label className="text-xs">Nova etapa</Label>
          <Input
            placeholder="Nome da etapa"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitAdd();
              }
            }}
          />
          <ColorSwatches value={newColor} onChange={setNewColor} />
          <Button size="sm" className="w-full" disabled={!newName.trim() || adding} onClick={() => void submitAdd()}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar etapa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
