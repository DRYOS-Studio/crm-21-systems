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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
  ownerUserId: string | null;
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
  leadLabel,
  members,
  currentUserId,
  onTransferred,
}: Props) {
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo(
    () => members.filter((m) => m.user_id !== ownerUserId),
    [members, ownerUserId],
  );

  useEffect(() => {
    if (!open) return;
    setTargetId(targets[0]?.user_id ?? "");
    setError(null);
  }, [open, targets]);

  const confirm = async () => {
    if (!conversationId || !targetId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await transferConversation(conversationId, targetId);
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

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir conversa</DialogTitle>
          <DialogDescription>
            {leadLabel
              ? `Escolha quem passa a ser responsável por ${leadLabel}. Mensagens, follow-ups e o funil acompanham a transferência.`
              : "Escolha quem passa a ser responsável por esta conversa."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void confirm()} disabled={saving || !targetId}>
            {saving ? "Transferindo…" : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
