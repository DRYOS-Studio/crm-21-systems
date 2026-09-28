import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { memberFilterLabel, type OrgMember } from "@/hooks/useOrgMembers";
import { transferConversation } from "@/lib/transfer-conversation";
import { suggestTransferStageId, type TransferStageOption } from "@/lib/transfer-stage-suggest";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
  ownerUserId: string | null;
  sourceStageName?: string | null;
  leadLabel?: string;
  members: OrgMember[];
  currentUserId?: string | null;
  onTransferred?: (payload: { conversationId: string; userId: string; stageId?: string | null }) => void;
};

export function TransferConversationDialog({
  open,
  onOpenChange,
  conversationId,
  ownerUserId,
  sourceStageName,
  leadLabel,
  members,
  currentUserId,
  onTransferred,
}: Props) {
  const [targetId, setTargetId] = useState("");
  const [stageId, setStageId] = useState("");
  const [targetStages, setTargetStages] = useState<TransferStageOption[]>([]);
  const [loadingStages, setLoadingStages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo(
    () => members.filter((m) => m.user_id !== ownerUserId),
    [members, ownerUserId],
  );

  useEffect(() => {
    if (!open) return;
    setTargetId(targets[0]?.user_id ?? "");
    setStageId("");
    setTargetStages([]);
    setError(null);
  }, [open, targets]);

  useEffect(() => {
    if (!open || !targetId) {
      setTargetStages([]);
      setStageId("");
      return;
    }
    let cancelled = false;
    setLoadingStages(true);
    const load = async () => {
      const { data, error: qErr } = await supabase
        .from("pipeline_stages")
        .select("id, name, position")
        .eq("user_id", targetId)
        .order("position", { ascending: true });
      if (cancelled) return;
      setLoadingStages(false);
      if (qErr) {
        setTargetStages([]);
        setStageId("");
        return;
      }
      const rows = (data ?? []) as TransferStageOption[];
      setTargetStages(rows);
      const suggested = suggestTransferStageId(sourceStageName, rows);
      setStageId(suggested ?? "");
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, targetId, sourceStageName]);

  const stageHint = useMemo(() => {
    if (!sourceStageName?.trim()) return null;
    const suggested = suggestTransferStageId(sourceStageName, targetStages);
    if (suggested && stageId === suggested) {
      return `Sugerimos a etapa equivalente a “${sourceStageName.trim()}” no funil de quem vai receber.`;
    }
    if (targetStages.length > 0) {
      return `Hoje está em “${sourceStageName.trim()}”. Confirme a etapa no funil do novo responsável.`;
    }
    return null;
  }, [sourceStageName, targetStages, stageId]);

  const confirm = async () => {
    if (!conversationId || !targetId) return;
    if (targetStages.length > 0 && !stageId) {
      setError("Escolha a etapa do funil.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await transferConversation(conversationId, targetId, stageId || null);
      onTransferred?.({
        conversationId,
        userId: res.user_id ?? targetId,
        stageId: res.stage_id,
      });
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao transferir.");
    } finally {
      setSaving(false);
    }
  };

  if (targets.length === 0) return null;

  const canConfirm = !!targetId && (!targetStages.length || !!stageId) && !loadingStages;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir conversa</DialogTitle>
          <DialogDescription>
            {leadLabel
              ? `Escolha o novo responsável e a etapa do funil para ${leadLabel}.`
              : "Escolha quem passa a ser responsável e em qual etapa a conversa fica."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="transfer-target">Transferir para</Label>
            <Select value={targetId} onValueChange={setTargetId} disabled={saving}>
              <SelectTrigger id="transfer-target">
                <SelectValue placeholder="Membro do time" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {memberFilterLabel(m, currentUserId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {targetStages.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="transfer-stage">Etapa no funil</Label>
              <Select value={stageId} onValueChange={setStageId} disabled={saving || loadingStages}>
                <SelectTrigger id="transfer-stage">
                  <SelectValue placeholder={loadingStages ? "Carregando…" : "Etapa"} />
                </SelectTrigger>
                <SelectContent>
                  {targetStages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {stageHint && <p className="text-xs text-muted-foreground">{stageHint}</p>}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void confirm()} disabled={saving || !canConfirm}>
            {saving ? "Transferindo…" : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
