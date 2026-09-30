import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const MAX_SYNC_AGE_MS = 10 * 60 * 1000;
type Admin = ReturnType<typeof createClient<any>>;

export function isBillingAccessAllowed(
  billingStatus: string,
  graceEndsAt: string | null,
  synchronizedAt: string,
  now = Date.now(),
) {
  const syncedAt = new Date(synchronizedAt).getTime();
  const fresh = Number.isFinite(syncedAt) && now - syncedAt <= MAX_SYNC_AGE_MS;
  const inGrace = billingStatus === "past_due" && !!graceEndsAt && new Date(graceEndsAt).getTime() > now;
  return fresh && (billingStatus === "active" || inGrace);
}

export async function getBillingAccess(admin: Admin) {
  const { data, error } = await admin
    .from("q7_local_access")
    .select("is_control_plane, billing_status, grace_ends_at, synchronized_at")
    .eq("singleton", true)
    .maybeSingle();

  if (error || !data) {
    console.error("[billing] não foi possível ler o estado local", error?.message);
    return { allowed: false, billingStatus: "unavailable", graceEndsAt: null, fresh: false };
  }
  const state = data as {
    is_control_plane: boolean;
    billing_status: string;
    grace_ends_at: string | null;
    synchronized_at: string;
  };
  if (state.is_control_plane) {
    return { allowed: true, billingStatus: "active", graceEndsAt: null, fresh: true };
  }

  const now = Date.now();
  const synchronizedAt = new Date(state.synchronized_at).getTime();
  const fresh = Number.isFinite(synchronizedAt) && now - synchronizedAt <= MAX_SYNC_AGE_MS;
  return {
    allowed: isBillingAccessAllowed(state.billing_status, state.grace_ends_at, state.synchronized_at, now),
    billingStatus: state.billing_status,
    graceEndsAt: state.grace_ends_at,
    fresh,
  };
}

export async function requireBillingAccess(admin: Admin) {
  const access = await getBillingAccess(admin);
  if (!access.allowed) console.warn("[billing] envio bloqueado", access);
  return access;
}
