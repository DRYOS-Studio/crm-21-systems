import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { memberFilterLabel, type OrgMember } from "@/hooks/useOrgMembers";

export function UserFilterSelect({
  members,
  currentUserId,
  value,
  onChange,
  className,
}: {
  members: OrgMember[];
  currentUserId?: string | null;
  value: string;
  onChange: (userId: string) => void;
  className?: string;
}) {
  if (members.length < 2) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-8 w-[160px] text-xs"}>
        <SelectValue placeholder="Usuário" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos os usuários</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.user_id} value={m.user_id}>
            {memberFilterLabel(m, currentUserId)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
