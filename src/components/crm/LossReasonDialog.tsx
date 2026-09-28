import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LossReason } from "@/lib/loss-reasons";

const NONE = "__none__";

export function LossReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  reasons,
  saving,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  reasons: LossReason[];
  saving?: boolean;
  onConfirm: (payload: { reasonId: string | null; note: string }) => void | Promise<void>;
}) {
  const [reasonId, setReasonId] = useState<string>(NONE);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setReasonId(NONE);
    setNote("");
  }, [open]);

  const selected = reasons.find((r) => r.id === reasonId);
  const needsDetail = selected?.name.toLowerCase() === "outro";

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? "Motivo da perda"}</DialogTitle>
          <DialogDescription>
            {description ?? "Opcional — ajuda a entender por que o lead foi para Perdido."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Motivo</Label>
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Escolher motivo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem motivo específico</SelectItem>
                {reasons.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(needsDetail || reasonId !== NONE) && (
            <div className="space-y-1.5">
              <Label className="text-xs">{needsDetail ? "Descreva o motivo" : "Detalhe (opcional)"}</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={280}
                placeholder={needsDetail ? "Ex.: fechou com outro fornecedor por prazo" : "Observação curta"}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            disabled={saving || (needsDetail && !note.trim())}
            onClick={() =>
              void onConfirm({
                reasonId: reasonId === NONE ? null : reasonId,
                note: note.trim(),
              })
            }
          >
            {saving ? "Salvando…" : "Confirmar perda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
