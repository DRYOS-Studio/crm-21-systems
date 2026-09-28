import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INSTANCE_FILTER_NONE } from "@/lib/view-filters";
import { whatsappInstanceLabel, type WhatsappInstanceRow } from "@/lib/whatsapp-instance-label";
import type { OrgMember } from "@/hooks/useOrgMembers";

export function InstanceFilterSelect({
  instances,
  members,
  currentUserId,
  value,
  onChange,
  showUnassigned,
  className,
}: {
  instances: WhatsappInstanceRow[];
  members: OrgMember[];
  currentUserId?: string | null;
  value: string;
  onChange: (instanceId: string) => void;
  showUnassigned?: boolean;
  className?: string;
}) {
  const multiDevice = instances.length > 1 || (instances.length === 1 && showUnassigned);
  if (!multiDevice) return null;

  const ownerName = (userId: string) => {
    const m = members.find((x) => x.user_id === userId);
    if (!m) return null;
    if (m.user_id === currentUserId) return "Você";
    return m.name.split(/\s+/)[0];
  };

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-8 w-full text-xs"}>
        <SelectValue placeholder="Canal / dispositivo" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos os dispositivos</SelectItem>
        {showUnassigned && <SelectItem value={INSTANCE_FILTER_NONE}>Sem dispositivo</SelectItem>}
        {instances.map((inst) => (
          <SelectItem key={inst.id} value={inst.id}>
            {whatsappInstanceLabel(inst, members.length > 1 ? ownerName(inst.user_id) : null)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
