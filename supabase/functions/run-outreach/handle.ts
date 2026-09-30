import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getAgentConfig, type AIConfig } from "../_shared/get-ai-config.ts";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";
import { getBillingAccess } from "../_shared/billing-access.ts";
import { runBrainTurn, type ConversaState } from "../_shared/brain.ts";
import {
  intervaloMs,
  devePularTick,
  freio,
  montarToque1,
  montarToqueCadencia,
  podeDispararAgora,
  proximoToque,
  sortearVariacao,
  tetoEfetivo,
  wallSP,
  TOQUE1_PADRAO,
  TOQUE2_PADRAO,
  TOQUE3_PADRAO,
} from "../_shared/outreach.ts";

export const ORCAMENTO_TICK_MS = 90_000;
export const CRON_HEADER = "x-cron-secret";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  const n = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < n; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function numeroForaDoWhatsapp(errText: string): boolean {
  return /not on whatsapp|not a valid whatsapp|number.*not exist|exists.?false/i.test(errText);
}

function openerValida(text: string, company: string | null): boolean {
  if (!text?.trim() || text.length > 280) return false;
  if (/(https?:\/\/|www\.|wa\.me)/i.test(text)) return false;
  if (text.includes("{empresa}") && !company?.trim()) return false;
  return true;
}

function instrucaoDoToque(n: number): string {
  if (n === 2) {
    return "Este é o TOQUE 2: o toque 1 foi só um olá e ela não respondeu. Não mande outro cumprimento. Uma bolha: quem você é + o que o CONTEXTO pede (presente / oferta), sem cobrança. Se o CONTEXTO tiver página de conversão, o link pode ir.";
  }
  return "Este é o TOQUE 3, o último. Despedida curta, porta aberta, sem cobrança e sem cara de campanha. Se o CONTEXTO tiver página, manda o link uma última vez.";
}

function hojeSP(agora: Date): string {
  return wallSP(agora).iso;
}

export type TickDeps = { agora?: Date; rng?: () => number };

export async function handle(req: Request, deps: TickDeps = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const agora = deps.agora ?? new Date();
  const rng = deps.rng ?? Math.random;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: secretRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "outreach_cron_secret")
    .maybeSingle();
  const stored = (secretRow?.value ?? "").trim();
  if (!stored) return json(500, { ok: false, enviados: 0, error: "outreach_cron_secret vazio" });

  const provided = req.headers.get(CRON_HEADER) ?? "";
  if (!timingSafeEqual(provided, stored)) return json(401, { ok: false, enviados: 0 });
  if (!(await getBillingAccess(supabase)).allowed) return json(402, { ok: false, enviados: 0, blocked: true });

  const inicio = Date.now();
  const { data: agents } = await supabase
    .from("agent_configs")
    .select(
      "user_id, business_context, company_name, owner_notify_phone, outreach_enabled, outreach_paused_reason, outreach_instance_id, outreach_daily_cap, outreach_interval_sec, outreach_ramp_start, outreach_saturday_morning, outreach_weekdays_only, outreach_last_tick_at",
    )
    .eq("outreach_enabled", true)
    .is("outreach_paused_reason", null)
    .order("outreach_last_tick_at", { ascending: true, nullsFirst: true });

  let enviados = 0;
  const skip: string[] = [];
  if (!(agents ?? []).length) skip.push("sem_agente");
  for (const agent of agents ?? []) {
    if (Date.now() - inicio >= ORCAMENTO_TICK_MS) {
      skip.push("orcamento");
      break;
    }

    await supabase
      .from("agent_configs")
      .update({ outreach_last_tick_at: new Date().toISOString() })
      .eq("user_id", agent.user_id);

    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_token, server_url, status, user_id")
      .eq("user_id", agent.user_id)
      .not("instance_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const uaz = await getUazapiConfig();
    const token = inst?.instance_token || uaz?.instanceToken;
    const serverUrl = (inst?.server_url || uaz?.serverUrl || "").replace(/\/$/, "");
    if (!inst?.id || !token || !serverUrl || inst.status === "disconnected") {
      skip.push(inst?.status === "disconnected" ? "desconectado" : "sem_instancia");
      continue;
    }
    const { data: confirmed } = await supabase.rpc("webhook_is_confirmed", { p_instance: inst.id });
    if (confirmed !== true) {
      skip.push("webhook");
      continue;
    }

    if (!podeDispararAgora(agora, {
      saturdayMorning: !!agent.outreach_saturday_morning,
      weekdaysOnly: agent.outreach_weekdays_only !== false,
    })) {
      skip.push("fora_janela");
      continue;
    }
    if (devePularTick(rng)) {
      skip.push("pular");
      continue;
    }

    const teto = tetoEfetivo(agent.outreach_daily_cap, agent.outreach_ramp_start, agora);
    const reserved = await supabase.rpc("outreach_reserve", {
      p_user: agent.user_id,
      p_teto: teto,
      p_intervalo: `${intervaloMs(agent.outreach_interval_sec)} milliseconds`,
    });
    if (reserved.error) {
      console.error("[outreach] reserve", reserved.error.message);
      skip.push("reserve_erro");
      continue;
    }
    const row = reserved.data?.[0];
    if (!row?.send_id) {
      skip.push("sem_reserva");
      continue;
    }

    const prospect = row.prospect ?? {};
    const conv = row.conversation ?? {};
    const toque = Number(prospect.tentativas ?? 0) + 1;

    if (row.conversation == null && prospect.conversation_id == null) {
      await supabase.rpc("outreach_release", { p_user: agent.user_id, p_send: row.send_id, p_motivo: "sem conversa" });
      continue;
    }

    const { data: sendRow } = await supabase
      .from("outreach_sends")
      .select("status, cadencia_aplicada, toque")
      .eq("id", row.send_id)
      .maybeSingle();
    if (sendRow?.status === "incerto" && sendRow.cadencia_aplicada === false) {
      const n = sendRow.toque ?? toque;
      await supabase.rpc("outreach_mark_uncertain", {
        p_user: agent.user_id,
        p_send: row.send_id,
        p_proximo_toque: proximoToque(n, hojeSP(agora)),
        p_tentativas: n,
      });
      continue;
    }

    let texto = "";
    if ((prospect.tentativas ?? 0) === 0) {
      const { data: openers } = await supabase
        .from("outreach_openers")
        .select("text, active")
        .eq("user_id", agent.user_id)
        .eq("active", true);
      const validas = (openers ?? []).map((o) => o.text).filter((t) => openerValida(t, agent.company_name));
      if (validas.length === 1) {
        await supabase.rpc("outreach_release", {
          p_user: agent.user_id,
          p_send: row.send_id,
          p_motivo: "menos de 2 variações válidas",
        });
        skip.push("openers");
        continue;
      }
      const pool = validas.length >= 2 ? validas : TOQUE1_PADRAO;
      texto = montarToque1(
        sortearVariacao(pool, rng),
        { nome: prospect.name ?? prospect.nome, empresa: prospect.company ?? prospect.empresa },
        agent.company_name,
      );
    } else {
      texto = await textoToqueCadencia(supabase, agent, conv, prospect, toque, rng);
      if (!texto) {
        await supabase.rpc("outreach_release", { p_user: agent.user_id, p_send: row.send_id, p_motivo: "sem texto do toque" });
        continue;
      }
    }

    const { data: freshP } = await supabase
      .from("prospects")
      .select("optout, conversation_id")
      .eq("id", prospect.id)
      .maybeSingle();
    const { data: freshC } = await supabase
      .from("conversations")
      .select("optout, ai_enabled, wa_phone, contact_phone")
      .eq("id", conv.id ?? freshP?.conversation_id)
      .maybeSingle();
    if (freshP?.optout || freshC?.optout || freshC?.ai_enabled === false) {
      await supabase.rpc("outreach_release", { p_user: agent.user_id, p_send: row.send_id, p_motivo: null });
      continue;
    }

    const numero = freshC?.wa_phone || freshC?.contact_phone;
    if (!(await getBillingAccess(supabase)).allowed) {
      await supabase.rpc("outreach_release", { p_user: agent.user_id, p_send: row.send_id, p_motivo: "billing blocked" });
      break;
    }
    let sendRes: Response;
    try {
      sendRes = await fetch(`${serverUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify({ number: numero, text: texto }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      await supabase.rpc("outreach_mark_uncertain", {
        p_user: agent.user_id,
        p_send: row.send_id,
        p_proximo_toque: proximoToque(toque, hojeSP(agora)),
        p_tentativas: toque,
      });
      continue;
    }
    if (!sendRes.ok) {
      const errText = await sendRes.text();
      const motivo = `uazapi ${sendRes.status}: ${errText.slice(0, 200)}`;
      if (numeroForaDoWhatsapp(errText) && prospect.id) {
        await supabase
          .from("prospects")
          .update({ estado: "descartado", proximo_toque: null, ultima_falha_motivo: motivo })
          .eq("id", prospect.id)
          .eq("user_id", agent.user_id);
      }
      await supabase.rpc("outreach_release", {
        p_user: agent.user_id,
        p_send: row.send_id,
        p_motivo: motivo,
      });
      skip.push(numeroForaDoWhatsapp(errText) ? "numero_fora" : "uazapi");
      continue;
    }

    await supabase.from("messages").insert({
      conversation_id: conv.id ?? freshP?.conversation_id,
      user_id: agent.user_id,
      direction: "outbound",
      sender: "ai",
      content: texto,
    });
    await supabase.rpc("outreach_mark_sent", {
      p_user: agent.user_id,
      p_send: row.send_id,
      p_proximo_toque: proximoToque(toque, hojeSP(agora)),
      p_tentativas: toque,
    });
    enviados++;

    const stats = await supabase.rpc("outreach_day_stats", { p_user: agent.user_id });
    const day = stats.data?.[0] ?? { enviados: 0, responderam: 0 };
    const brake = freio(day);
    if (brake.pausar) {
      await supabase
        .from("agent_configs")
        .update({ outreach_enabled: false, outreach_paused_reason: brake.motivo })
        .eq("user_id", agent.user_id);
      if (agent.owner_notify_phone) {
        await fetch(`${serverUrl}/send/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token: inst.instance_token },
          body: JSON.stringify({
            number: agent.owner_notify_phone,
            text: `Desliguei o disparo sozinho.\n\n${brake.motivo}.`,
          }),
        }).catch(() => {});
      }
    }
  }

  return json(200, { ok: true, enviados, skip });
}

async function textoToqueCadencia(
  admin: ReturnType<typeof createClient>,
  agent: { user_id: string; company_name: string | null; business_context: string | null },
  conv: Record<string, unknown>,
  prospect: Record<string, unknown>,
  toque: number,
  rng: () => number,
): Promise<string> {
  const cfg = await getAgentConfig(agent.user_id);
  if (cfg) {
    const ia = await textoToqueIA(admin, cfg, conv, prospect, toque);
    if (ia) return ia;
  }
  const pack = toque === 2 ? TOQUE2_PADRAO : TOQUE3_PADRAO;
  return montarToqueCadencia(
    toque,
    sortearVariacao(pack, rng),
    { nome: prospect.name ?? prospect.nome, empresa: prospect.company ?? prospect.empresa },
    agent.company_name,
    agent.business_context,
  );
}

async function textoToqueIA(
  admin: ReturnType<typeof createClient>,
  cfg: AIConfig,
  conv: Record<string, unknown>,
  prospect: Record<string, unknown>,
  toque: number,
): Promise<string> {
  const conversa: ConversaState = {
    etapa: (conv.ai_stage as string) || "abordar",
    dados: (conv.qualification as Record<string, unknown>) || {},
    confirmacoes: Number(conv.confirmacoes || 0),
  };
  try {
    const outcome = await runBrainTurn({
      admin,
      userId: conv.user_id as string,
      agent: cfg,
      conversa,
      historyMessages: [],
      janela: [],
      extraSistema: `${instrucaoDoToque(toque)}\nProspect: ${JSON.stringify({ nome: prospect.name, empresa: prospect.company })}`,
    });
    return (outcome.mensagens[0] || "").trim();
  } catch {
    return "";
  }
}
