import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function usePendingFollowupConversationIds() {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!user) {
      setIds(new Set());
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("followups")
        .select("conversation_id")
        .eq("status", "pending");
      if (cancelled) return;
      setIds(new Set((data ?? []).map((r) => r.conversation_id)));
    };
    void load();
    const ch = supabase
      .channel(`followups-pending-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "followups" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  return ids;
}
