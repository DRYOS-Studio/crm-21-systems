import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type OrgMember = {
  user_id: string;
  name: string;
  email: string | null;
};

export function memberShortName(fullName: string | null | undefined, email: string | null | undefined) {
  const n = String(fullName || "").trim();
  if (n) return n.split(/\s+/)[0];
  const local = String(email || "").split("@")[0].trim();
  return local || "Conta";
}

export function memberFilterLabel(member: OrgMember, currentUserId?: string | null) {
  if (member.user_id === currentUserId) return `Você · ${member.name}`;
  return member.name;
}

export function useOrgMembers() {
  const { user } = useAuth();
  const [members, setMembers] = useState<OrgMember[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const [{ data: memberRows }, { data: profileRows }] = await Promise.all([
        supabase.from("organization_members").select("user_id"),
        supabase.from("profiles").select("user_id, full_name, email"),
      ]);
      if (cancelled) return;
      const profiles = new Map(
        ((profileRows ?? []) as { user_id: string; full_name: string | null; email: string | null }[]).map((p) => [
          p.user_id,
          p,
        ]),
      );
      const ids = new Set<string>([
        ...((memberRows ?? []) as { user_id: string }[]).map((m) => m.user_id),
        ...profiles.keys(),
        user.id,
      ]);
      const rows: OrgMember[] = [...ids].map((id) => {
        const p = profiles.get(id);
        return {
          user_id: id,
          name: memberShortName(p?.full_name, p?.email || (id === user.id ? user.email : null)),
          email: p?.email ?? (id === user.id ? user.email ?? null : null),
        };
      });
      rows.sort((a, b) => {
        if (a.user_id === user.id) return -1;
        if (b.user_id === user.id) return 1;
        return a.name.localeCompare(b.name);
      });
      setMembers(rows);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return members;
}
