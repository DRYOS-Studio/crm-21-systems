import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getAgentConfig, type AIConfig } from "../_shared/get-ai-config.ts";
import { runBrainTurn, type ConversaState } from "../_shared/brain.ts";
import {
  INTERVALO_MS,
  devePularTick,
  freio,
  montarToque1,
  podeDispararAgora,
  proximoToque,
  sortearVariacao,
  tetoEfetivo,
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

function modoCerebro(ctx: string | null | undefined): boolean {
  return !!ctx?.trim();
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

function openerValida(text: string, company: string | null): boolean {
  if (!text?.trim() || text.length > 120) return false;
  if (/(https?:\/\/|www\.|wa\.me)/i.test(text)) return false;
  if (text.includes("{empresa}") && !company?.trim()) return false;
  return true;
}

function instrucaoDoToque(n: number): string {
  if (n === 2) {
    return "Este é o TOQUE 2, três dias depois da abordagem, e ela não respondeu. Ângulo diferente do primeiro. Uma bolha só, curta.";
  }
  return "Este é o TOQUE 3, o último. Despedida: deixa a porta aberta e encerra. Sem cobrança. Uma bolha só.";
}

function hojeSP(agora: Date): string {
  return agora.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
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

  const inicio = Date.now();
  const { data: agents } = await supabase
    .from("agent_configs")
    .select(
      "user_id, business_context, company_name, owner_notify_phone, outreach_enabled, outreach_paused_reason, outreach_instance_id, outreach_daily_cap, outreach_ramp_start, outreach_saturday_morning, outreach_last_tick_at",
    )
    .eq("outreach_enabled", true)
    .is("outreach_paused_reason", null)
    .order("outreach_last_tick_at", { ascending: true, nullsFirst: true });

  let enviados = 0;
  for (const agent of agents ?? []) {
    if (Date.now() - inicio >= ORCAMENTO_TICK_MS) break;
    if (!modoCerebro(agent.business_context)) continue;

    await supabase
      .from("agent_configs")
      .update({ outreach_last_tick_at: new Date().toISOString() })
      .eq("user_id", agent.user_id);

    if (!agent.outreach_instance_id) continue;
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_token, server_url, status, user_id")
      .eq("id", agent.outreach_instance_id)
      .eq("user_id", agent.user_id)
      .maybeSingle();
    if (!inst || inst.status !== "connected" || !inst.instance_token || !inst.server_url) continue;
    const { data: confirmed } = await supabase.rpc("webhook_is_confirmed", { p_instance: inst.id });
    if (confirmed !== true) continue;

    if (!podeDispararAgora(agora, { saturdayMorning: !!agent.outreach_saturday_morning })) continue;
    if (devePularTick(rng)) continue;

    const teto = tetoEfetivo(agent.outreach_daily_cap, agent.outreach_ramp_start, agora);
    const reserved = await supabase.rpc("outreach_reserve", {
      p_user: agent.user_id,
      p_teto: teto,
      p_intervalo: `${INTERVALO_MS} milliseconds`,
    });
    const row = reserved.data?.[0];
    if (!row?.send_id) continue;

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
      if (validas.length < 2) {
        await supabase.rpc("outreach_release", {
          p_user: agent.user_id,
          p_send: row.send_id,
          p_motivo: "menos de 2 variações válidas",
        });
        continue;
      }
      texto = montarToque1(
        sortearVariacao(validas, rng),
        { nome: prospect.name ?? prospect.nome, empresa: prospect.company ?? prospect.empresa },
        agent.company_name,
      );
    } else {
      const cfg = await getAgentConfig(agent.user_id);
      if (!cfg) {
        await supabase.rpc("outreach_release", { p_user: agent.user_id, p_send: row.send_id, p_motivo: "IA: sem chave" });
        continue;
      }
      texto = await textoToqueIA(supabase, cfg, conv, prospect, toque);
      if (!texto) {
        await supabase.rpc("outreach_release", { p_user: agent.user_id, p_send: row.send_id, p_motivo: "IA nao devolveu mensagem" });
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
    const serverUrl = inst.server_url.replace(/\/$/, "");
    let sendRes: Response;
    try {
      sendRes = await fetch(`${serverUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: inst.instance_token },
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
      await supabase.rpc("outreach_release", {
        p_user: agent.user_id,
        p_send: row.send_id,
        p_motivo: `uazapi ${sendRes.status}: ${errText.slice(0, 200)}`,
      });
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

  return json(200, { ok: true, enviados });
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
