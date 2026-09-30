import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getBillingAccess } from "../_shared/billing-access.ts";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";
import { montarWebhookUrl, redigirJson, redigirSecret } from "../_shared/webhook-url.ts";
import { isPlayableMediaUrl, persistWhatsappMedia } from "../_shared/persist-media.ts";
import { contactAvatarFromUazapiChat } from "../_shared/contact-avatar.ts";
import { authorizedInstance, hasModule, memberContext } from "../_shared/member-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function storagePath(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl) return null;
  const marker = "storage://chat-media/";
  if (mediaUrl.startsWith(marker)) return mediaUrl.slice(marker.length);
  try {
    const pathname = new URL(mediaUrl).pathname;
    const match = pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/chat-media\/(.+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** set_webhook / get_webhooks: JWT + dono; nunca cai no token global (ADR-11). */
async function handleWebhookAction(req: Request, body: any) {
  const ctx = await memberContext(req);
  if (!ctx) return json({ ok: false, error: "Não autenticado ou membro inativo" }, 401);
  const inst = await authorizedInstance(ctx, body.instance_id, { adminOnly: true });
  if (!inst?.instance_token) return json({ ok: false, error: "Instância não encontrada ou sem permissão" }, 403);
  const { admin } = ctx;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const user = { id: ctx.userId };
  if (!inst.server_url) return json({ ok: false, error: "Instância sem servidor Uazapi" });

  const baseUrl = String(inst.server_url).replace(/\/$/, "");
  const action = body.action;

  if (action === "webhook_url") {
    const { data: secret, error } = await admin.rpc("webhook_secret_for", { p_user: user.id, p_instance: inst.id });
    if (error || !secret) return json({ ok: false, error: "Falha ao obter URL do webhook" }, 400);
    return json({ ok: true, url: montarWebhookUrl(supabaseUrl, secret) });
  }
  if (action === "webhook_confirmed") {
    const { data, error } = await admin.rpc("webhook_is_confirmed", { p_instance: inst.id });
    return json({ ok: true, confirmed: !error && data === true });
  }

  if (action === "get_webhooks") {
    const uazRes = await fetch(`${baseUrl}/webhook`, {
      method: "GET",
      headers: { Accept: "application/json", token: inst.instance_token },
    });
    const responseText = await uazRes.text();
    console.log(`[get_webhooks] status=${uazRes.status}, body=${redigirSecret(responseText)}`);
    if (!uazRes.ok) {
      return json({ ok: false, error: "Falha ao buscar webhooks", details: redigirSecret(responseText) });
    }
    let data: unknown = {};
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }
    return json({ ok: true, success: true, webhooks: redigirJson(data) });
  }

  // set_webhook: URL no servidor; webhook_url do body ignorado (design §6).
  const { data: atual, error: secretErr } = await admin.rpc("webhook_secret_for", {
    p_user: user.id,
    p_instance: inst.id,
  });
  if (secretErr || !atual) {
    return json({ ok: false, error: "Falha ao obter secret do webhook" });
  }

  const rotacionar = body.rotate === true;
  let secret = atual as string;
  if (rotacionar) {
    const { data: candidato, error: beginErr } = await admin.rpc("webhook_rotate_begin", {
      p_user: user.id,
      p_instance: inst.id,
    });
    if (beginErr || !candidato) {
      return json({ ok: false, error: "Falha ao iniciar rotação do webhook" });
    }
    secret = candidato as string;
  }

  const url = montarWebhookUrl(supabaseUrl, secret);
  if (!/^https?:\/\//i.test(url)) {
    return json({ ok: false, error: "URL do webhook inválida no servidor" });
  }
  const webhookBody = {
    enabled: true,
    url,
    events: ["messages", "messages_update"],
    excludeMessages: ["wasSentByApi"],
    addUrlEvents: false,
  };

  const uazRes = await fetch(`${baseUrl}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: inst.instance_token },
    body: JSON.stringify(webhookBody),
  });
  const responseText = await uazRes.text();
  console.log(`[set_webhook] status=${uazRes.status}, body=${redigirSecret(responseText, secret)}`);

  if (!uazRes.ok) {
    return json({ ok: false, error: "Falha ao configurar webhook", details: redigirSecret(responseText, secret) });
  }

  if (rotacionar) {
    const { error: commitErr } = await admin.rpc("webhook_rotate_commit", {
      p_user: user.id,
      p_instance: inst.id,
      p_novo: secret,
    });
    if (commitErr) {
      console.error("[set_webhook] rotate_commit falhou após Uazapi aceitar", commitErr.message);
      return json({ ok: false, error: "Webhook registrado, mas a rotação não gravou" });
    }
  }

  let data: unknown = {};
  try {
    data = JSON.parse(responseText);
  } catch {
    data = responseText;
  }
  return json({
    ok: true,
    success: true,
    data: redigirJson(data, secret),
    webhook_url: redigirSecret(url, secret),
  });
}

async function handleDownloadMedia(req: Request, body: any) {
  const ctx = await memberContext(req);
  if (!ctx) return json({ ok: false, error: "Não autenticado ou membro inativo" }, 401);
  const { admin } = ctx;

  const messageId = String(body.message_id || "").trim();
  if (!messageId) return json({ ok: false, error: "Mensagem não informada" });

  const { data: msg } = await admin
    .from("messages")
    .select("id, user_id, conversation_id, media_type, media_url, external_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return json({ ok: false, error: "Mensagem não encontrada" }, 404);

  const { data: conv } = await admin
    .from("conversations")
    .select("instance_id, user_id")
    .eq("id", msg.conversation_id)
    .maybeSingle();
  if (!conv || !(await hasModule(ctx, "crm_conversations"))) return json({ ok: false, error: "Sem permissão" }, 403);
  const conversationInstance = conv.instance_id
    ? await authorizedInstance(ctx, conv.instance_id)
    : null;
  if (conv.instance_id && !conversationInstance) return json({ ok: false, error: "Sem acesso à instância desta conversa" }, 403);
  const { data: owner } = await admin.from("organization_members").select("user_id")
    .eq("org_id", ctx.orgId).eq("user_id", msg.user_id).maybeSingle();
  if (!owner) return json({ ok: false, error: "Sem permissão" }, 403);

  const path = storagePath(msg.media_url);
  if (path) {
    const { data, error } = await admin.storage.from("chat-media").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return json({ ok: false, error: "Arquivo indisponível" }, 404);
    if (!msg.media_url?.startsWith("storage://")) {
      await admin.from("messages").update({ media_url: `storage://chat-media/${path}` }).eq("id", msg.id);
    }
    const url = data.signedUrl.startsWith("http") ? data.signedUrl : `${Deno.env.get("SUPABASE_URL")}${data.signedUrl}`;
    return json({ ok: true, url });
  }
  if (isPlayableMediaUrl(msg.media_url)) return json({ ok: true, url: msg.media_url });

  const inst = conversationInstance;
  if (!inst?.server_url || !inst?.instance_token) {
    return json({ ok: false, error: "Instância WhatsApp não encontrada" });
  }
  if (!msg.external_id) {
    return json({ ok: false, error: "Áudio sem identificador para baixar" });
  }

  const url = await persistWhatsappMedia({
    admin,
    userId: msg.user_id,
    instanceId: inst.id,
    serverUrl: inst.server_url,
    instanceToken: inst.instance_token,
    messageId: msg.external_id,
    mediaType: msg.media_type,
    fallbackUrl: msg.media_url,
  });
  const storedPath = storagePath(url);
  if (!url || (!isPlayableMediaUrl(url) && !storedPath)) {
    return json({ ok: false, error: "Falha ao baixar o áudio" });
  }
  await admin.from("messages").update({ media_url: url }).eq("id", msg.id);
  if (storedPath) {
    await admin.from("messages").update({ media_url: url }).eq("id", msg.id);
    const signed = await admin.storage.from("chat-media").createSignedUrl(storedPath, 300);
    if (signed.error || !signed.data?.signedUrl) return json({ ok: false, error: "Arquivo indisponível" }, 404);
    const signedUrl = signed.data.signedUrl.startsWith("http") ? signed.data.signedUrl : `${Deno.env.get("SUPABASE_URL")}${signed.data.signedUrl}`;
    return json({ ok: true, url: signedUrl });
  }
  await admin.from("messages").update({ media_url: url }).eq("id", msg.id);
  return json({ ok: true, url });
}

async function handleEnrichContactAvatar(req: Request, body: any) {
  const ctx = await memberContext(req);
  if (!ctx) return json({ ok: false, error: "Não autenticado ou membro inativo" }, 401);
  const { admin } = ctx;

  const conversationId = String(body.conversation_id || "").trim();
  const number = String(body.number || "").replace(/\D/g, "");
  if (!conversationId || !number) {
    return json({ ok: false, error: "Conversa ou número inválido" });
  }

  const { data: conv } = await admin
    .from("conversations")
    .select("id, user_id, instance_id, contact_avatar_url, wa_phone, contact_phone")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return json({ ok: false, error: "Conversa não encontrada" }, 404);

  if (!(await hasModule(ctx, "crm_conversations"))) return json({ ok: false, error: "Sem permissão" }, 403);
  const { data: owner } = await admin.from("organization_members").select("user_id")
    .eq("org_id", ctx.orgId).eq("user_id", conv.user_id).maybeSingle();
  if (!owner) return json({ ok: false, error: "Sem permissão" }, 403);
  const inst = conv.instance_id ? await authorizedInstance(ctx, conv.instance_id) : null;
  if (conv.instance_id && !inst) {
    return json({ ok: false, error: "Sem acesso à instância desta conversa" }, 403);
  }

  if (conv.contact_avatar_url) {
    return json({ ok: true, avatar_url: conv.contact_avatar_url, cached: true });
  }

  if (!inst?.server_url || !inst?.instance_token) {
    return json({ ok: false, error: "Instância WhatsApp não encontrada" });
  }

  const baseUrl = String(inst.server_url).replace(/\/$/, "");
  const uazRes = await fetch(`${baseUrl}/chat/details`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: inst.instance_token },
    body: JSON.stringify({ number, preview: true }),
  });
  const responseText = await uazRes.text();
  if (!uazRes.ok) {
    return json({ ok: false, error: "Falha ao buscar foto", details: responseText.slice(0, 200) });
  }

  let chat: Record<string, unknown> = {};
  try {
    chat = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Resposta inválida da Uazapi" });
  }

  const avatarUrl = contactAvatarFromUazapiChat(chat);
  if (!avatarUrl) return json({ ok: true, avatar_url: null });

  await admin.from("conversations").update({ contact_avatar_url: avatarUrl }).eq("id", conv.id);
  return json({ ok: true, avatar_url: avatarUrl });
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, name, phone } = body;

    if (action === "set_webhook" || action === "get_webhooks") {
      return await handleWebhookAction(req, body);
    }

    if (action === "download_media") {
      return await handleDownloadMedia(req, body);
    }

    if (action === "enrich_contact_avatar") {
      return await handleEnrichContactAvatar(req, body);
    }
    const ctx = await memberContext(req);
    if (!ctx) return json({ ok: false, error: "Não autenticado ou membro inativo" }, 401);

    if (action === "get_config") {
      if (!ctx.isAdmin) return json({ ok: false, error: "Apenas admin" }, 403);
      const { data: inst } = await ctx.admin.from("whatsapp_instances")
        .select("id,name,phone,status,server_url,instance_token")
        .eq("user_id", ctx.userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      return json({ ok: true, instance: inst ? {
        id: inst.id, name: inst.name, phone: inst.phone, status: inst.status,
        server_url: inst.server_url, has_instance_token: !!inst.instance_token,
      } : null });
    }

    if (action === "save_config") {
      if (!ctx.isAdmin) return json({ ok: false, error: "Apenas admin" }, 403);
      const serverUrl = typeof body.server_url === "string" ? body.server_url.trim().replace(/\/$/, "") : "";
      const instanceToken = typeof body.instance_token === "string" ? body.instance_token.trim() : "";
      if (!serverUrl || !/^https?:\/\//i.test(serverUrl)) return json({ ok: false, error: "Server URL inválida" }, 400);
      if (body.instance_id && !instanceToken) {
        const { data: existing } = await ctx.admin.from("whatsapp_instances").select("instance_token")
          .eq("id", body.instance_id).eq("user_id", ctx.userId).maybeSingle();
        if (!existing?.instance_token) return json({ ok: false, error: "Instance Token obrigatório" }, 400);
      }
      const values = { server_url: serverUrl, ...(instanceToken ? { instance_token: instanceToken } : {}), status: "disconnected" };
      const write = body.instance_id
        ? await ctx.admin.from("whatsapp_instances").update(values).eq("id", body.instance_id).eq("user_id", ctx.userId).select("id").maybeSingle()
        : await ctx.admin.from("whatsapp_instances").insert({ ...values, user_id: ctx.userId, name: "Instância WhatsApp" }).select("id").single();
      if (write.error || !write.data) return json({ ok: false, error: "Falha ao salvar instância" }, 400);
      if (typeof body.admin_token === "string" && body.admin_token.trim()) {
        const { error } = await ctx.admin.from("app_settings").upsert([
          { key: "uazapi_server_url", value: serverUrl },
          { key: "uazapi_admin_token", value: body.admin_token.trim() },
        ], { onConflict: "key" });
        if (error) return json({ ok: false, error: "Falha ao salvar configuração Uazapi" }, 400);
      }
      return json({ ok: true, instance_id: write.data.id });
    }

    if (!action) return json({ ok: false, error: "Ação não informada" }, 400);
    const adminOnly = ["create", "connect", "disconnect", "delete"].includes(action);
    const inst = action === "create" ? null : await authorizedInstance(ctx, body.instance_id, { adminOnly });
    if (action !== "create" && !inst) return json({ ok: false, error: "Instância não encontrada ou sem permissão" }, 403);
    const instance_token = inst?.instance_token || null;
    let baseUrl = inst?.server_url?.replace(/\/$/, "") || null;
    let UAZAPI_ADMIN_TOKEN: string | null = null;
    if (action === "create") {
      if (!ctx.isAdmin) return json({ ok: false, error: "Apenas admin" }, 403);
      const globalConfig = await getUazapiConfig();
      if (!globalConfig) return json({ ok: false, error: "Uazapi não configurado" }, 400);
      baseUrl = globalConfig.serverUrl;
      UAZAPI_ADMIN_TOKEN = globalConfig.adminToken;
    }
    if (!baseUrl || !instance_token && action !== "create") return json({ ok: false, error: "Instância sem credenciais configuradas" }, 400);

    console.log(`[manage-instance] action=${action}, name=${name || ""}, phone=${phone || ""}`);

    // === CREATE (init) ===
    if (action === "create") {
      if (!name) {
        return json({ ok: false, error: "Nome da instância não informado" });
      }


      const uazRes = await fetch(`${baseUrl}/instance/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json", AdminToken: UAZAPI_ADMIN_TOKEN! },
        body: JSON.stringify({ name }),
      });

      const responseText = await uazRes.text();
      console.log(`[create] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        return json({ ok: false, error: "Falha ao criar instância", details: responseText });
      }

      const data = JSON.parse(responseText);
      return json({ ok: true, success: true, instance: data });
    }

    // === CONNECT ===
    if (action === "connect") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }


      const connectBody: Record<string, string> = {};
      if (phone) connectBody.phone = phone;

      const uazRes = await fetch(`${baseUrl}/instance/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: instance_token },
        body: JSON.stringify(connectBody),
      });

      const responseText = await uazRes.text();
      console.log(`[connect] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        // Token inválido/expirado no Uazapi — instância precisa ser recriada
        if (uazRes.status === 401) {
          return json({
            ok: false,
            error:
              "A instância do WhatsApp expirou no servidor. Remova a instância atual e crie uma nova.",
            code: "INSTANCE_TOKEN_INVALID",
            details: responseText,
          });
        }
        return json({ ok: false, error: "Falha ao conectar", details: responseText });
      }

      const data = JSON.parse(responseText);
      const inst = data.instance ?? {};
      const paircode = inst.paircode || data.paircode || null;
      const qrcode = inst.qrcode || data.qrcode || null;
      const alreadyConnected = data.connected === true || data.status?.connected === true || data.loggedIn === true;

      return json({
        ok: true,
        success: true,
        paircode: paircode || null,
        qrcode: qrcode || null,
        already_connected: alreadyConnected,
      });
    }

    // === DISCONNECT ===
    if (action === "disconnect") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      const uazRes = await fetch(`${baseUrl}/instance/disconnect`, {
        method: "POST",
        headers: { token: instance_token },
      });
      const responseText = await uazRes.text();
      console.log(`[disconnect] status=${uazRes.status}, body=${responseText}`);

      return json({ ok: true, success: true });
    }

    // === DELETE ===
    if (action === "delete") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      try {
        const uazRes = await fetch(`${baseUrl}/instance`, {
          method: "DELETE",
          headers: { token: instance_token },
        });
        const responseText = await uazRes.text();
        console.log(`[delete] status=${uazRes.status}, body=${responseText}`);
      } catch {
        // best effort
      }

      return json({ ok: true, success: true });
    }

    // === STATUS ===
    if (action === "status") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      const uazRes = await fetch(`${baseUrl}/instance/status`, {
        method: "GET",
        headers: { token: instance_token },
      });

      const responseText = await uazRes.text();
      console.log(`[status] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        if (uazRes.status === 401) {
          return json({
            ok: false,
            error:
              "Instance Token inválido neste Server URL. Use o token da instância criada nesse servidor — não o Admin Token e não o token do servidor antigo.",
            code: "INSTANCE_TOKEN_INVALID",
          });
        }
        return json({ ok: false, error: "Falha ao verificar status", details: responseText.slice(0, 200) });
      }

      const data = JSON.parse(responseText);

      // Normalize status from various Uazapi response formats
      // data.status can be an object like { connected: true } or a string like "connected"
      const statusObj = data?.status;
      const instanceStatus = data?.instance?.status;
      const isConnected =
        (typeof statusObj === 'object' && statusObj?.connected === true) ||
        (typeof statusObj === 'string' && (statusObj === "open" || statusObj === "connected" || statusObj === "CONNECTED")) ||
        (typeof instanceStatus === 'string' && (instanceStatus === "open" || instanceStatus === "connected" || instanceStatus === "CONNECTED")) ||
        data?.loggedIn === true ||
        data?.instance?.loggedIn === true;

      // O token já identifica a instância: nome, telefone e perfil vêm de graça.
      // Isso dispensa o usuário de digitar o nome à mão.
      const inst = data?.instance ?? {};
      await ctx.admin.from("whatsapp_instances").update({
        status: isConnected ? "connected" : "disconnected",
        ...(inst.owner || data?.owner ? { phone: inst.owner || data?.owner } : {}),
        ...(inst.name || data?.name ? { name: inst.name || data?.name } : {}),
        ...(inst.profileName ? { profile_name: inst.profileName } : {}),
      }).eq("id", body.instance_id);
      return json({
        ok: true,
        connected: isConnected,
        name: inst.name || data?.name || null,
        phone: inst.owner || data?.owner || null,
        profile_name: inst.profileName || null,
      });
    }

    // === SEND TEXT ===
    if (action === "send_text") {
      const billingAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const billing = await getBillingAccess(billingAdmin);
      if (!billing.allowed) return json({ ok: false, error: "Envios bloqueados por cobrança", code: "BILLING_BLOCKED" }, 402);
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      const { number, text, delay: msgDelay, readchat } = body;
      if (!number || !text) {
        return json({ ok: false, error: "Número e texto são obrigatórios" });
      }

      const sendBody: Record<string, any> = { number, text };
      if (msgDelay) sendBody.delay = msgDelay;
      if (readchat !== undefined) sendBody.readchat = readchat;

      const uazRes = await fetch(`${baseUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: instance_token },
        body: JSON.stringify(sendBody),
      });

      const responseText = await uazRes.text();
      console.log(`[send_text] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        return json({ ok: false, error: "Falha ao enviar mensagem", details: responseText });
      }

      const data = JSON.parse(responseText);
      return json({ ok: true, success: true, data });
    }

    // === SEND MEDIA (imagem, vídeo, documento, áudio, ptt, sticker) ===
    if (action === "send_media") {
      const billingAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const billing = await getBillingAccess(billingAdmin);
      if (!billing.allowed) return json({ ok: false, error: "Envios bloqueados por cobrança", code: "BILLING_BLOCKED" }, 402);
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }
      const { number, type, file, text, docName, delay: mediaDelay, readchat } = body;
      const allowed = ["image", "video", "document", "audio", "ptt", "sticker"];
      if (!number || !file || !allowed.includes(type)) {
        return json({ ok: false, error: "Número, tipo e arquivo são obrigatórios" });
      }
      if (typeof file === "string" && file.startsWith("data:") && file.length > 6_000_000) {
        return json({ ok: false, error: "Arquivo grande demais para envio direto" });
      }

      const sendBody: Record<string, any> = { number, type, file };
      if (text) sendBody.text = text;
      if (docName) sendBody.docName = docName;
      if (mediaDelay) sendBody.delay = mediaDelay;
      if (readchat !== undefined) sendBody.readchat = readchat;

      const uazRes = await fetch(`${baseUrl}/send/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: instance_token },
        body: JSON.stringify(sendBody),
      });
      const responseText = await uazRes.text();
      const fileHint = typeof file === "string" ? file.slice(0, 80) : "";
      console.log(`[send_media] type=${type} status=${uazRes.status} file=${fileHint}`);

      if (!uazRes.ok) {
        return json({ ok: false, error: "Falha ao enviar mídia", details: responseText.slice(0, 400) });
      }
      let data: unknown = {};
      try {
        data = JSON.parse(responseText);
      } catch {
        data = responseText;
      }
      return json({ ok: true, success: true, data });
    }

    return json({ ok: false, error: "Ação inválida" });
  } catch (error) {
    console.error("manage-instance error:", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
}

serve(handle);
