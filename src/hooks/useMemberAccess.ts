import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type MemberAccess = {
  is_active: boolean;
  is_admin: boolean;
  access_review_required: boolean;
  module_keys: string[];
  instance_ids: string[];
};

export function useMemberAccess() {
  const { user } = useAuth();
  const userId = user?.id;
  const [access, setAccess] = useState<MemberAccess | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId) {
      setAccess(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("my_member_access");
      if (error || !data || typeof data !== "object" || Array.isArray(data)) setAccess(null);
      else setAccess(data as unknown as MemberAccess);
    } catch {
      setAccess(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void reload(); }, [reload]);

  const hasModule = useCallback((module: string) => {
    if (!access?.is_active) return false;
    if (access.is_admin) return true;
    if (module === "settings") return false;
    const key = ["crm", "conversations", "agenda", "dashboard"].includes(module)
      ? "crm_conversations"
      : module;
    return access.module_keys.includes(key);
  }, [access]);

  return {
    access,
    loading,
    isActive: access?.is_active === true,
    isAdmin: access?.is_admin === true,
    accessReviewRequired: access?.access_review_required === true,
    instanceIds: access?.instance_ids ?? [],
    hasModule,
    reload,
  };
}
