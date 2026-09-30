import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { memberContext } from "../_shared/member-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function inviteRedirectUrl(): string | null {
  const configured = Deno.env.get("APP_URL");
  if (!configured) return null;
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("APP_URL precisa usar HTTPS");
  }
  return `${url.origin}/aceitar-convite`;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  try {
    const ctx = await memberContext(req);
    if (!ctx) return json({ ok: false, error: "Não autenticado ou membro inativo" }, 401);
    if (!ctx.isAdmin) return json({ ok: false, error: "Apenas admin pode administrar usuários" }, 403);

    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ ok: false, error: "Ação inválida" }, 400);

    if (body.action === "list") {
      const { data: members, error } = await ctx.admin.from("organization_members")
        .select("user_id,org_id,is_active,access_review_required,created_at")
        .eq("org_id", ctx.orgId).order("created_at", { ascending: true });
      if (error) return json({ ok: false, error: "Não foi possível listar os membros" }, 500);
      const ids = (members || []).map((member) => member.user_id);
      const [{ data: profiles }, { data: roles }, { data: modules }, { data: grants }, { data: owners }] = await Promise.all([
        ctx.admin.from("profiles").select("user_id,email,full_name").in("user_id", ids),
        ctx.admin.from("user_roles").select("user_id,role").in("user_id", ids),
        ctx.admin.from("organization_member_modules").select("user_id,module_key").eq("org_id", ctx.orgId).in("user_id", ids),
        ctx.admin.from("organization_member_instances").select("user_id,instance_id").eq("org_id", ctx.orgId).in("user_id", ids),
        ctx.admin.from("organization_members").select("user_id").eq("org_id", ctx.orgId),
      ]);
      const { data: instances } = await ctx.admin.from("whatsapp_instances")
        .select("id,user_id,name,phone,status").in("user_id", (owners || []).map((row) => row.user_id));
      return json({
        ok: true,
        members: (members || []).map((member) => ({
          ...member,
          profile: (profiles || []).find((row) => row.user_id === member.user_id) || null,
          role: (roles || []).find((row) => row.user_id === member.user_id)?.role || "user",
          module_keys: (modules || []).filter((row) => row.user_id === member.user_id).map((row) => row.module_key),
          instance_ids: (grants || []).filter((row) => row.user_id === member.user_id).map((row) => row.instance_id),
        })),
        instances: instances || [],
      });
    }

    if (body.action === "invite") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "Email inválido" }, 400);
      const redirectTo = inviteRedirectUrl();
      if (!redirectTo) return json({ ok: false, error: "APP_URL precisa ser configurado nas secrets das Edge Functions" }, 500);
      const { data, error } = await ctx.admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error) return json({ ok: false, error: "Não foi possível enviar o convite" }, 400);
      const { data: membership } = await ctx.admin.from("organization_members").select("org_id")
        .eq("user_id", data.user.id).maybeSingle();
      if (membership?.org_id !== ctx.orgId) {
        return json({ ok: false, error: "Convite associado a outra organização" }, 409);
      }
      return json({ ok: true });
    }

    if (body.action === "resend_invite") {
      const targetId = typeof body.user_id === "string" ? body.user_id : "";
      const { data: target } = await ctx.admin.from("organization_members")
        .select("user_id").eq("org_id", ctx.orgId).eq("user_id", targetId).maybeSingle();
      if (!target) return json({ ok: false, error: "Membro não encontrado" }, 404);
      const { data: profile } = await ctx.admin.from("profiles").select("email").eq("user_id", targetId).maybeSingle();
      if (!profile?.email) return json({ ok: false, error: "Email não encontrado" }, 404);
      const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
      const redirectTo = inviteRedirectUrl();
      if (!redirectTo) return json({ ok: false, error: "APP_URL precisa ser configurado nas secrets das Edge Functions" }, 500);
      if (!publicKey) return json({ ok: false, error: "Servidor sem configuração de Auth" }, 500);
      const publicClient = createClient(Deno.env.get("SUPABASE_URL")!, publicKey);
      await publicClient.auth.resetPasswordForEmail(profile.email, {
        redirectTo,
      });
      return json({ ok: true });
    }

    if (body.action === "save_access") {
      const targetId = typeof body.user_id === "string" ? body.user_id : "";
      const isActive = body.is_active;
      const moduleKeys = body.module_keys;
      const instanceIds = body.instance_ids;
      if (!targetId || typeof isActive !== "boolean" || !Array.isArray(moduleKeys) ||
        !moduleKeys.every((key) => typeof key === "string") || !Array.isArray(instanceIds) ||
        !instanceIds.every((id) => typeof id === "string")) {
        return json({ ok: false, error: "Dados de acesso inválidos" }, 400);
      }

      const { error } = await ctx.admin.rpc("admin_save_member_access", {
        p_actor: ctx.userId,
        p_target: targetId,
        p_is_active: isActive,
        p_module_keys: moduleKeys,
        p_instance_ids: instanceIds,
      });
      if (error) {
        const status = error.code === "42501" ? 403 : 400;
        return json({ ok: false, error: error.message }, status);
      }

      const { data: authData, error: authError } = await ctx.admin.auth.admin.updateUserById(targetId, {
        ban_duration: isActive ? "none" : "876000h",
      });
      if (authError || !authData.user) {
        return json({ ok: false, error: "Acesso do banco salvo; sincronização da conta pendente. Salve novamente para repetir." }, 502);
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: "Ação inválida" }, 400);
  } catch (error) {
    console.error("[manage-organization-members]", error instanceof Error ? error.message : "erro");
    return json({ ok: false, error: "Erro interno ao administrar usuários" }, 500);
  }
}

Deno.serve(handle);
