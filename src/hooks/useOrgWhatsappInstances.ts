import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { WhatsappInstanceRow } from "@/lib/whatsapp-instance-label";

export function useOrgWhatsappInstances() {
  const { user } = useAuth();
  const [result, setResult] = useState<{
    userId: string | null;
    instances: WhatsappInstanceRow[];
  }>({ userId: null, instances: [] });
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setResult({ userId: null, instances: [] });
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("id, name, phone, profile_name, status, user_id")
        .order("name", { ascending: true });
      if (cancelled || error) return;
      setResult({ userId, instances: (data as WhatsappInstanceRow[]) ?? [] });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return {
    instances: result.userId === userId ? result.instances : [],
    loading: !!userId && result.userId !== userId,
  };
}
