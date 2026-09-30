import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const MAX_SYNC_AGE_MS = 10 * 60 * 1000;

export function useBillingAccess() {
  const { user, loading: authLoading } = useAuth();
  const query = useQuery({
    queryKey: ["billing-access"],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("q7_local_access")
        .select("is_control_plane, billing_status, grace_ends_at, payment_url, synchronized_at")
        .eq("singleton", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const data = query.data;
  const controlPlane = !!data?.is_control_plane;
  const fresh = !!data && Date.now() - new Date(data.synchronized_at).getTime() <= MAX_SYNC_AGE_MS;
  const inGrace = data?.billing_status === "past_due" && !!data.grace_ends_at &&
    new Date(data.grace_ends_at).getTime() > Date.now();
  const allowed = controlPlane || (fresh && (data?.billing_status === "active" || inGrace));

  return {
    ...query,
    loading: authLoading || (!!user && query.isLoading),
    allowed,
    fresh: fresh || controlPlane,
    status: data?.billing_status ?? "unavailable",
    graceEndsAt: data?.grace_ends_at ?? null,
    paymentUrl: data?.payment_url ?? null,
  };
}
