import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getAgentConfig, callGroq, type AIConfig } from "../_shared/get-ai-config.ts";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";
import { cancelPendingFollowups, scheduleInactivityFollowup } from "../_shared/followups.ts";
import { aplicarOptout, responderTurno } from "../_shared/turno.ts";
import { pediuParaSair } from "../_shared/brain.ts";

type Admin = ReturnType<typeof createClient>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, token",
};

function normalizeName(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function ok(body: any = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function modoCerebro(agent: AIConfig | null): boolean {
  return !!agent?.businessContext?.trim();
}

/** Query `?s=` ou, se a Uazapi descartar query, `/whatsapp-webhook/s/<secret>` (design §4.1 plano B). */
function extractSecret(req: Request): string | null {
  const url = new URL(req.url);
  if (url.searchParams.has("s")) return url.searchParams.get("s") ?? "";
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.lastIndexOf("s");
  if (i >= 0 && parts[i + 1]) return decodeURIComponent(parts[i + 1]);
  return null;
}

function waitUntil(promise: Promise<unknown>) {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(promise);
  else void promise;
}

/** Converte JID do WhatsApp em telefone. Retorna "" quando o JID não é um número (@g.us, @lid). */
function jidToPhone(jid: string | null | undefined) {
  const raw = String(jid || "");
  if (!raw) return "";
  if (raw.includes("@g.us") || raw.includes("@lid")) return "";
  return raw.replace(/@.*/, "").replace(/:.*/, "").replace(/\D/g, "");
}

/** O campo `content` da Uazapi chega como string JSON (ex: '{"text":"oi"}') em vários tipos. */
function readContent(content: any): string | null {
  if (!content) return null;
  if (typeof content === "object") return content.text ?? null;
  const s = String(content).trim();
  if (!s.startsWith("{")) return s || null;
  try {
    return JSON.parse(s)?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Mídia sem legenda chega sem texto nenhum (áudio, foto pura, figurinha). Sem um marcador
 * essas mensagens caíam na guarda de "sem_texto" e o lead que só manda áudio — o padrão no
 * Brasil — nunca virava card nem recebia resposta.
 */
function mediaLabel(m: any): string | null {
  const t = String(m?.messageType || m?.mediaType || m?.type || "").toLowerCase();
  if (!t) return null;
  if (t.includes("audio") || t.includes("ptt")) return "[áudio]";
  if (t.includes("image")) return "[imagem]";
  if (t.includes("video")) return "[vídeo]";
  if (t.includes("sticker")) return "[figurinha]";
  if (t.includes("document")) return "[documento]";
  if (t.includes("location")) return "[localização]";
  if (t.includes("contact") || t.includes("vcard")) return "[contato]";
  return null;
}

function isReaction(m: any): boolean {
  return String(m?.messageType || "") === "ReactionMessage" || String(m?.type || "").toLowerCase() === "reaction";
}

function extractText(body: any) {
  // Uazapi atual: { EventType, message: {campos planos}, chat: {...}, owner, token }
  // Legado/Baileys: { data: { message: { conversation }, key: { remoteJid, fromMe } } }
  const envelope = body.data || body;
  const m = envelope?.message ?? body.message ?? envelope ?? {};
  const chat = body.chat || envelope?.chat || {};

  const media = mediaLabel(m);
  const text =
    m?.text ||                                  // Uazapi: campo canônico
    readContent(m?.content) ||                  // Uazapi: content como JSON string
    m?.message?.conversation ||                 // Baileys puro
    m?.message?.extendedTextMessage?.text ||
    m?.body ||
    media ||                                    // mídia sem legenda → "[áudio]", "[imagem]"...
    null;

  const fromMe = m?.fromMe ?? m?.key?.fromMe ?? false;
  const rawJid = m?.chatid || m?.key?.remoteJid || chat?.wa_chatid || m?.from || "";
  const isGroup =
    m?.isGroup === true || chat?.wa_isGroup === true || String(rawJid).includes("@g.us");

  // chatid pode vir como @lid (id opaco). Os campos do `chat` sempre apontam para o
  // contato; `sender_pn` aponta para quem enviou — em mensagem nossa (fromMe) esse é
  // o dono da instância, então só serve como fallback quando a mensagem é do contato.
  const phone =
    jidToPhone(rawJid) ||
    jidToPhone(chat?.wa_chatid) ||
    jidToPhone(chat?.lead_phone) ||
    jidToPhone(chat?.phone) ||
    (fromMe ? "" : jidToPhone(m?.sender_pn)) ||
    "";

  // `senderName`/`pushName` descrevem quem ENVIOU: em mensagem nossa (fromMe) são o dono
  // da instância, então usá-los renomeia o lead com o nome do operador a cada resposta.
  const contactName = fromMe
    ? chat?.lead_name || chat?.wa_name || null
    : m?.senderName || chat?.lead_name || chat?.wa_name || m?.pushName || null;
  const instanceName = body.instance?.name || body.instanceName || "";
  const instanceToken = body.token || body.instance?.token || m?.token || null;
  // `owner` é o telefone da instância: último recurso pra achar o dono sem token nem nome
  const instanceOwner = jidToPhone(body.owner || m?.owner || chat?.owner);
  // id do EVENTO (T3): nunca content.key.ID — numa reação esse é o alvo, não o evento.
  const externalId = m?.messageid != null && String(m.messageid) !== "" ? String(m.messageid) : null;

  return {
    text,
    media,
    fromMe,
    phone,
    isGroup,
    contactName,
    instanceName,
    instanceToken,
    instanceOwner,
    message: m,
    externalId,
    reaction: isReaction(m),
  };
}

async function resolveByTokenNameOwner(
  supabase: Admin,
  instanceToken: string | null,
  instanceName: string,
  instanceOwner: string,
) {
  let instRow: any = null;
  if (instanceToken) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("instance_token", instanceToken)
      .maybeSingle();
    instRow = data;
  }
  if (!instRow && instanceName) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("name", instanceName)
      .maybeSingle();
    instRow = data;
  }
  if (!instRow && instanceName) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .not("instance_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(20);

    instRow = (data || []).find((row: any) => normalizeName(row.name) === normalizeName(instanceName)) || null;
  }
  if (!instRow && instanceOwner) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("phone", instanceOwner)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    instRow = data;
  }
  return instRow;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const event = body.EventType || body.event || body.type || "messages";
    const secret = extractSecret(req);

    // test/connection sem `s` não tocam o banco (T1 smoke; Uazapi ping). Com `s`, a auth abaixo vale.
    if (secret === null && event === "test") return ok({ ok: true, message: "webhook ok" });
    if (secret === null && (event === "connection" || event === "connection.update")) return ok();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Auth (ADR-11)
    const parsed = extractText(body);
    let instRow: any = null;
    let autenticado = false;

    if (secret !== null) {
      if (!secret) return unauthorized();
      const { data: resolved, error: resolveErr } = await supabase.rpc("webhook_resolve", { p_secret: secret });
      if (resolveErr || !resolved?.length) return unauthorized();
      const { data: bySecret } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .eq("id", resolved[0].instance_id)
        .maybeSingle();
      if (!bySecret) return unauthorized();
      instRow = bySecret;
      autenticado = true;
    } else {
      instRow = await resolveByTokenNameOwner(
        supabase,
        parsed.instanceToken,
        parsed.instanceName,
        parsed.instanceOwner,
      );
      if (instRow) {
        const { data: confirmed } = await supabase.rpc("webhook_is_confirmed", { p_instance: instRow.id });
        if (confirmed) {
          console.warn("[webhook] instância confirmada sem s", { id: instRow.id });
          return unauthorized();
        }
      }
    }

    if (event === "test") return ok({ ok: true, message: "webhook ok" });
    if (event === "connection" || event === "connection.update") return ok();
    if (event === "dry_run") return await runDryRun(body, instRow);

    // confirmed_at só em `messages` real com s válido — dry_run/test/connection nunca confirmam.
    if (autenticado && event === "messages") {
      await supabase.rpc("webhook_confirm", { p_instance: instRow.id });
    }

    const { text, media, fromMe, phone, isGroup, contactName, instanceName, instanceToken, instanceOwner, externalId, reaction } =
      parsed;

    console.log("[webhook] in", {
      event,
      body_keys: Object.keys(body || {}).join(","),
      has_text: !!text,
      media: media || null,
      phone: phone || null,
      is_group: isGroup,
      from_me: fromMe,
      has_token: !!instanceToken,
      owner: instanceOwner || null,
      autenticado,
    });

    // Reação: texto vem preenchido (emoji) sem ser mensagem do usuário (achado T3).
    if (isGroup || reaction || !text || !phone) {
      console.log("[webhook] ignorado", {
        reason: isGroup ? "grupo" : reaction ? "reacao" : !text ? "sem_texto" : "sem_telefone",
      });
      return ok();
    }

    if (!instRow) {
      console.warn("[webhook] instance not found", {
        instanceName,
        hasToken: !!instanceToken,
        owner: instanceOwner,
      });
      return ok();
    }
    console.log("[webhook] instancia resolvida", { id: instRow.id, name: instRow.name });

    const userId = instRow.user_id;
    const agent = await getAgentConfig(userId);
    const cerebro = autenticado && modoCerebro(agent);

    // 2. chave canônica
    const { data: keyRaw, error: keyErr } = await supabase.rpc("canon_phone", { p_phone: phone });
    if (keyErr) console.error("[webhook] canon_phone falhou", keyErr.message);
    const key = (keyRaw as string | null) || phone;

    // 3. filtro do dono — só no modo novo (AC-A15)
    if (cerebro && agent?.ownerNotifyPhone && key === agent.ownerNotifyPhone) {
      return ok();
    }

    if (instanceName && instRow.name !== instanceName) {
      await supabase
        .from("whatsapp_instances")
        .update({ name: instanceName })
        .eq("id", instRow.id);
      instRow.name = instanceName;
    }

    // 4. Upsert por chave canônica; ai_stage no insert (AC-A18/A18c)
    const { data: convExisting } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", userId)
      .eq("contact_phone", key)
      .maybeSingle();

    let conv = convExisting;
    if (!conv) {
      const { data: novoLead } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("user_id", userId)
        .eq("name", "Novo Lead")
        .limit(1)
        .maybeSingle();
      let firstStage = novoLead;
      if (!firstStage) {
        const { data: fallback } = await supabase
          .from("pipeline_stages")
          .select("id")
          .eq("user_id", userId)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle();
        firstStage = fallback;
      }
      if (!firstStage) {
        console.log("[webhook] kanban vazio, criando etapas padrao", { userId });
        await supabase.from("pipeline_stages").insert([
          { user_id: userId, name: "Novo Lead", position: 0, color: "#3FB8BE" },
          { user_id: userId, name: "Em Negociação", position: 1, color: "#F59E0B" },
          { user_id: userId, name: "Fechado", position: 2, color: "#10B981" },
        ]);
        const { data: seeded } = await supabase
          .from("pipeline_stages")
          .select("id")
          .eq("user_id", userId)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle();
        firstStage = seeded;
      }
      const { data: created, error: createErr } = await supabase
        .from("conversations")
        .insert({
          user_id: userId,
          instance_id: instRow.id,
          contact_phone: key,
          wa_phone: phone,
          contact_name: contactName,
          ai_enabled: fromMe ? false : true,
          ai_stage: fromMe ? "abordar" : "descobrir",
          human_takeover_at: fromMe ? new Date().toISOString() : null,
          last_message_at: new Date().toISOString(),
          stage_id: firstStage?.id ?? null,
        })
        .select()
        .single();
      if (createErr) {
        console.log("[webhook] corrida na criacao, relendo conversa", { phone: key });
        const { data: raced } = await supabase
          .from("conversations")
          .select("*")
          .eq("user_id", userId)
          .eq("contact_phone", key)
          .maybeSingle();
        conv = raced;
      } else {
        conv = created;
      }
    } else {
      const update: Record<string, any> = {
        last_message_at: new Date().toISOString(),
        contact_name: contactName || conv.contact_name,
        wa_phone: phone,
      };
      if (fromMe) {
        update.ai_enabled = false;
        update.human_takeover_at = new Date().toISOString();
        conv.ai_enabled = false;
        conv.human_takeover_at = update.human_takeover_at;
      }
      await supabase.from("conversations").update(update).eq("id", conv.id);
    }
    if (!conv) return ok();

    // 6. fromMe ⇒ takeover atual (grava outbound, não inbound)
    if (fromMe) {
      console.log("[webhook] takeover humano", { phone: key, conversa: conv.id, ia: "desligada" });
      await cancelPendingFollowups(supabase, conv.id);
      await supabase
        .from("conversations")
        .update({ inactivity_followup_at: null, auto_followup_count: 0 })
        .eq("id", conv.id);
      await supabase.from("messages").insert({
        conversation_id: conv.id,
        user_id: userId,
        direction: "outbound",
        sender: "human",
        content: text,
      });
      return ok();
    }

    await cancelPendingFollowups(supabase, conv.id);
    await supabase
      .from("conversations")
      .update({ inactivity_followup_at: null, auto_followup_count: 0 })
      .eq("id", conv.id);

    // 5. inbound com external_id + processed_at null; 23505 = reenvio
    if (!externalId) console.log("[webhook] inbound sem messageid — inserindo sem external_id");
    const { error: inboundErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: conv.id,
        user_id: userId,
        direction: "inbound",
        sender: "contact",
        content: text,
        external_id: externalId,
        processed_at: null,
      });
    if (inboundErr) {
      if (inboundErr.code === "23505") {
        console.log("[webhook] reenvio (external_id)", { conversa: conv.id });
        return ok();
      }
      console.error("[webhook] insert inbound falhou", inboundErr.message);
      return ok();
    }

    // 7. claim sempre
    const { data: claimed, error: claimErr } = await supabase.rpc("brain_claim_inbound", {
      p_user: userId,
      p_conv: conv.id,
    });
    if (claimErr) console.error("[webhook] brain_claim_inbound falhou", claimErr.message);
    const claim = (claimed || []).map((m: { id: string; content: string }) => ({ id: m.id, content: m.content }));

    // 8. legado byte a byte se não autenticado ou sem cérebro
    if (!autenticado || !modoCerebro(agent)) {
      return await caminhoLegado({ supabase, userId, conv, instRow, phone: key, agent });
    }

    // 9. modo novo, IA desligada na conversa ou agente off: só regra de saída
    if (!conv.ai_enabled || !agent?.enabled) {
      if (claim.some((m: { content: string }) => pediuParaSair(m.content))) {
        await aplicarOptout({ admin: supabase, userId, conversationId: conv.id, claim });
      }
      return ok();
    }

    // 10. modo novo, IA ligada
    if (claim.length) {
      waitUntil(responderTurno({ admin: supabase, userId, conversationId: conv.id, claim }));
    }
    return ok();
  } catch (e: any) {
    console.error("[webhook] error", e);
    return ok({ ok: false, error: e.message });
  }
}

async function caminhoLegado(params: {
  supabase: Admin;
  userId: string;
  conv: any;
  instRow: any;
  phone: string;
  agent: AIConfig | null;
}) {
  const { supabase, userId, conv, instRow, phone, agent } = params;
  if (!conv.ai_enabled) return ok();
  if (!agent || !agent.enabled) return ok();

  const { data: history } = await supabase
    .from("messages")
    .select("direction, sender, content")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const chat = [
    { role: "system" as const, content: agent.systemPrompt },
    ...(history || []).reverse().map((m: any) => ({
      role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    })),
  ];

  const groq = await callGroq(agent.apiKey, agent.model, chat);
  if (!groq.ok || !groq.reply) {
    console.error("[webhook] groq failed", groq.error);
    return ok();
  }

  const uaz = await getUazapiConfig();
  const serverUrl = (instRow.server_url as string | null)?.replace(/\/$/, "") || uaz?.serverUrl;
  const token = instRow.instance_token || uaz?.instanceToken;
  if (!serverUrl || !token) {
    console.error("[webhook] uazapi server/token missing", { hasServer: !!serverUrl, hasToken: !!token });
    return ok();
  }
  const sendRes = await fetch(`${serverUrl}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number: phone, text: groq.reply }),
  });
  if (!sendRes.ok) {
    console.error("[webhook] uazapi send failed", await sendRes.text());
    return ok();
  }

  await supabase.from("messages").insert({
    conversation_id: conv.id,
    user_id: userId,
    direction: "outbound",
    sender: "ai",
    content: groq.reply,
  });
  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conv.id);

  await scheduleInactivityFollowup({
    admin: supabase,
    userId,
    conversationId: conv.id,
    currentAutoCount: conv.auto_followup_count ?? 0,
  });

  return ok();
}

async function runDryRun(body: any, instRowPre: any) {
  const inName: string = String(body?.instance?.name || "").trim();
  const inToken: string = String(body?.instance?.token || "").trim();
  const checks: any = {
    instance: { ok: false, matched_by: null, name_mismatch: false, instance_name: null },
    agent: { ok: false, has_key: false, enabled: false },
    groq: { ok: false },
    uazapi: { ok: false },
  };

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let instRow: any = instRowPre;
  if (instRow) {
    checks.instance.ok = true;
    checks.instance.matched_by = "secret";
    checks.instance.instance_name = instRow.name;
    checks.instance.name_mismatch = !!(inName && instRow.name !== inName);
  } else {
    if (inToken) {
      const { data } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .eq("instance_token", inToken)
        .maybeSingle();
      if (data) {
        instRow = data;
        checks.instance.matched_by = "token";
      }
    }
    if (!instRow && inName) {
      const { data } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .not("instance_token", "is", null)
        .order("updated_at", { ascending: false })
        .limit(20);
      instRow = (data || []).find((r: any) => normalizeName(r.name) === normalizeName(inName)) || null;
      if (instRow) checks.instance.matched_by = "name";
    }
    if (instRow) {
      checks.instance.ok = true;
      checks.instance.instance_name = instRow.name;
      checks.instance.name_mismatch = !!(inName && instRow.name !== inName);
    } else {
      checks.instance.error = "Nenhuma instância encontrada com esse token/nome";
      return ok({ ok: false, checks });
    }
  }

  const agent = await getAgentConfig(instRow.user_id);
  checks.agent.has_key = !!agent?.apiKey;
  checks.agent.enabled = !!agent?.enabled;
  checks.agent.ok = checks.agent.has_key && checks.agent.enabled;
  if (!checks.agent.has_key) checks.agent.error = "Chave da Groq não configurada";
  else if (!checks.agent.enabled) checks.agent.error = "Agente não está ativo";

  if (agent?.apiKey) {
    const r = await callGroq(agent.apiKey, agent.model, [
      { role: "system", content: "Responda apenas: ok" },
      { role: "user", content: "ping" },
    ]);
    checks.groq.ok = r.ok;
    if (!r.ok) checks.groq.error = r.error;
  } else {
    checks.groq.error = "Sem chave para testar";
  }

  const uaz = await getUazapiConfig();
  const serverUrl = (instRow.server_url as string | null)?.replace(/\/$/, "") || uaz?.serverUrl;
  const token = instRow.instance_token || uaz?.instanceToken;
  if (!serverUrl || !token) {
    checks.uazapi.error = "Server URL ou token da instância ausente";
  } else {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${serverUrl}/instance/status`, {
        method: "GET",
        headers: { token },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      await res.text().catch(() => "");
      checks.uazapi.ok = res.ok;
      checks.uazapi.status = res.status;
      if (!res.ok) checks.uazapi.error = `Uazapi retornou HTTP ${res.status}`;
    } catch (e: any) {
      checks.uazapi.error = e?.message || "Falha ao conectar na Uazapi";
    }
  }

  const allOk = checks.instance.ok && checks.agent.ok && checks.groq.ok && checks.uazapi.ok;
  return ok({ ok: allOk, checks });
}
