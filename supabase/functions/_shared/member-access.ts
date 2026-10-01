import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";

export type MemberContext = {
  admin: SupabaseClient;
  userId: string;
  email: string | null;
  orgId: string;
  isAdmin: boolean;
};

export async function memberContext(req: Request): Promise<MemberContext | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Servidor sem configuração");
  const admin = createClient(url, serviceKey);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return null;

  const [{ data: membership }, { data: role }] = await Promise.all([
    admin.from("organization_members").select("org_id,is_active").eq("user_id", auth.user.id).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", auth.user.id).eq("role", "admin").maybeSingle(),
  ]);
  if (!membership?.org_id || membership.is_active !== true) return null;
  return { admin, userId: auth.user.id, email: auth.user.email ?? null, orgId: membership.org_id, isAdmin: !!role };
}

export async function hasModule(ctx: MemberContext, moduleKey: string): Promise<boolean> {
  if (ctx.isAdmin) return true;
  const normalized = ["crm", "conversations", "agenda", "dashboard"].includes(moduleKey)
    ? "crm_conversations"
    : moduleKey;
  const { data } = await ctx.admin
    .from("organization_member_modules")
    .select("module_key")
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .eq("module_key", normalized)
    .maybeSingle();
  return !!data;
}

export type AuthorizedInstance = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  profile_name: string | null;
  status: string;
  is_organization_shared: boolean;
  server_url: string | null;
  instance_token: string | null;
};

export async function authorizedInstance(
  ctx: MemberContext,
  instanceId: unknown,
  options: { moduleKey?: string; adminOnly?: boolean } = {},
): Promise<AuthorizedInstance | null> {
  if (typeof instanceId !== "string" || !instanceId) return null;
  if (options.adminOnly && !ctx.isAdmin) return null;
  if (!(await hasModule(ctx, options.moduleKey || "crm_conversations"))) return null;

  const { data: instance } = await ctx.admin
    .from("whatsapp_instances")
    .select("id,user_id,name,phone,profile_name,status,is_organization_shared,server_url,instance_token")
    .eq("id", instanceId)
    .maybeSingle();
  if (!instance) return null;

  const { data: owner } = await ctx.admin
    .from("organization_members")
    .select("org_id")
    .eq("org_id", ctx.orgId)
    .eq("user_id", instance.user_id)
    .maybeSingle();
  if (!owner) return null;

  if (!ctx.isAdmin) {
    const { data: grant } = await ctx.admin
      .from("organization_member_instances")
      .select("instance_id")
      .eq("org_id", ctx.orgId)
      .eq("user_id", ctx.userId)
      .eq("instance_id", instance.id)
      .maybeSingle();
    if (!grant) return null;
  }
  return instance as AuthorizedInstance;
}
