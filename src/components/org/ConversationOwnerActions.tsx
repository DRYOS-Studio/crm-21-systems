import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { memberFilterLabel, type OrgMember } from "@/hooks/useOrgMembers";

type Props = {
  ownerUserId: string;
  members: OrgMember[];
  currentUserId?: string | null;
  onTransfer: () => void;
  compact?: boolean;
};

export function ConversationOwnerActions({
  ownerUserId,
  members,
  currentUserId,
  onTransfer,
  compact,
}: Props) {
  if (members.length < 2) return null;
  const owner = members.find((m) => m.user_id === ownerUserId);
  const label = owner ? memberFilterLabel(owner, currentUserId) : "Conta";

  return (
    <div className={`flex ${compact ? "items-center gap-2" : "flex-col gap-2"}`}>
      <div className="text-xs text-muted-foreground">
        Responsável: <span className="text-foreground font-medium">{label}</span>
      </div>
      <Button
        type="button"
        variant={compact ? "outline" : "secondary"}
        size="sm"
        className={compact ? "h-8 text-xs gap-1.5" : "w-full gap-2"}
        onClick={onTransfer}
      >
        <ArrowRightLeft className="w-3.5 h-3.5" />
        Transferir
      </Button>
    </div>
  );
}
