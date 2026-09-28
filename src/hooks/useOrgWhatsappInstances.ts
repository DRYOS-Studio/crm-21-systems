import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { WhatsappInstanceRow } from "@/lib/whatsapp-instance-label";

export function useOrgWhatsappInstances() {
  const { user } = useAuth();
  const [instances, setInstances] = useState<WhatsappInstanceRow[]>([]);

  useEffect(() => {
    if (!user) {
      setInstances([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("whatsapp_instances")
        .select("id, name, phone, profile_name, status, user_id")
        .order("name", { ascending: true });
      if (cancelled) return;
      setInstances((data as WhatsappInstanceRow[]) ?? []);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return instances;
}
