// I/O de um turno do cérebro (design.md §4.2): reivindicação já feita por quem chama
// (brain_claim_inbound); aqui mora o commit por RPC (ADR-04), a despedida de optout, o aviso
// ao dono, o envio com releitura entre bolhas (AC-A20) e o agendamento de follow-up.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getAgentConfig, type AIConfig } from "./get-ai-config.ts";
import { getUazapiConfig } from "./get-uazapi-config.ts";
import { cancelPendingFollowups, scheduleInactivityFollowup } from "./followups.ts";
import { runBrainTurn, deveEscalarPorConfirmacoes, ModeloSemToolsError, type ConversaState } from "./brain.ts";

type Admin = ReturnType<typeof createClient>;

/** Despedida do optout: fixa, nunca gerada pelo modelo (AC-A5c). */
export const DESPEDIDA_OPTOUT = "Beleza, não te mando mais nada. Desculpa o incômodo!";

/** design.md §5: pior caso de HTTP por turno é 2 `pensar` × teto de AC-A9 — sem um prazo geral,
 * uma cadeia de timeouts individuais da Groq (20s cada, get-ai-config.ts) ainda pode passar do
 * wall-clock da edge function. Estoura ⇒ tratado como "IA falhou" (D4) ⇒ escala (mesmo catch). */
export const TURN_DEADLINE_MS = 120_000;

function comPrazo<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Sem limpar o timer do lado perdedor, toda chamada que NÃO estourou o prazo (o caso comum)
  // deixa um setTimeout de `ms` pendurado até disparar sozinho — achado real: em teste, ~10
  // turnos com o default de 120s cada travavam o processo por ~120s no fim da suíte inteira.
  let timer: ReturnType<typeof setTimeout>;
  const prazo = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`prazo do turno esgotado (${ms}ms)`)), ms);
  });
  return Promise.race([promise, prazo]).finally(() => clearTimeout(timer));
}

export interface ClaimedMessage {
  id: string;
  content: string;
}

export interface TurnoParams {
  admin: Admin;
  userId: string;
  conversationId: string;
  /** Já reivindicado por `brain_claim_inbound` — turno.ts não reivindica nada sozinho. */
  claim: ClaimedMessage[];
  /** Só pra teste: encurta a espera de 2-4s entre bolhas (AC-A16) sem mudar o mecanismo. */
  esperarEntreBolhasMs?: [number, number];
  /** Só pra teste: encurta o prazo geral do turno (design §5) sem mudar o mecanismo. */
  prazoTurnoMs?: number;
}

interface ConversaRow {
  id: string;
  user_id: string;
  instance_id: string | null;
  contact_phone: string;
  wa_phone: string | null;
  contact_name: string | null;
  ai_stage: string;
  qualification: Record<string, unknown>;
  confirmacoes: number;
  optout: boolean;
  ai_enabled: boolean;
  auto_followup_count: number;
}

async function lerConversa(admin: Admin, userId: string, conversationId: string): Promise<ConversaRow | null> {
  const { data, error } = await admin
    .from("conversations")
    .select(
      "id, user_id, instance_id, contact_phone, wa_phone, contact_name, ai_stage, qualification, confirmacoes, optout, ai_enabled, auto_followup_count",
    )
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  // Erro de leitura (rede/RLS/transiente) e "conversa não existe" davam o mesmo `null` — quem
  // chama não conseguia distinguir "aborta em silêncio" de "não há o que fazer" (achado de
  // code-review). Aqui só loga; quem chama decide o que fazer sem conversa pra trabalhar.
  if (error) console.error("[turno] lerConversa falhou", { conversationId, erro: error.message });
  return (data as ConversaRow) ?? null;
}

async function lerHistorico(admin: Admin, userId: string, conversationId: string) {
  // security r3 W6: filtra por user_id também, não só conversation_id (service role ignora RLS).
  const { data } = await admin
    .from("messages")
    .select("direction, content")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data || []).reverse().map((m: any) => ({
    role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
    content: m.content,
  }));
}

async function resolverInstancia(admin: Admin, instanceId: string | null) {
  const inst = instanceId
    ? (await admin.from("whatsapp_instances").select("instance_token, server_url").eq("id", instanceId).maybeSingle()).data
    : null;
  const uaz = await getUazapiConfig();
  const serverUrl = ((inst as any)?.server_url as string | null | undefined)?.replace(/\/$/, "") || uaz?.serverUrl || null;
  const token = (inst as any)?.instance_token || uaz?.instanceToken || null;
  return { serverUrl, token };
}

async function enviarTexto(serverUrl: string, token: string, numero: string, texto: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: numero, text: texto }),
    });
    if (!res.ok) console.error("[turno] uazapi send failed", { status: res.status });
    return res.ok;
  } catch (e: any) {
    console.error("[turno] uazapi send exception", e?.message);
    return false;
  }
}

async function commit(
  admin: Admin,
  userId: string,
  conversationId: string,
  args: {
    stage?: string | null;
    qualificationDelta?: Record<string, unknown>;
    summary?: string | null;
    desligar?: boolean;
    optout?: boolean;
    motivo?: string | null;
  },
): Promise<{ ai_enabled: boolean; optout: boolean; flipped_off: boolean; flipped_optout: boolean }> {
  const { data, error } = await admin.rpc("brain_commit_turn", {
    p_user: userId,
    p_conv: conversationId,
    p_stage: args.stage ?? null,
    p_qualification_delta: args.qualificationDelta ?? {},
    p_summary: args.summary ?? null,
    p_desligar: args.desligar ?? false,
    p_optout: args.optout ?? false,
    p_motivo: args.motivo ?? null,
  });
  if (error) throw new Error(`brain_commit_turn falhou: ${error.message}`);
  return data[0];
}

async function avisarDono(
  admin: Admin,
  serverUrl: string | null,
  token: string | null,
  ownerNotifyPhone: string | null,
  conv: ConversaRow,
  motivo: string | null,
) {
  if (!ownerNotifyPhone || !serverUrl || !token) return;
  const { data: ultimas } = await admin
    .from("messages")
    .select("direction, content")
    .eq("conversation_id", conv.id)
    .eq("user_id", conv.user_id)
    .order("created_at", { ascending: false })
    .limit(3);
  const resumoUltimas = (ultimas || [])
    .reverse()
    .map((m: any) => `${m.direction === "inbound" ? "Cliente" : "Você"}: ${m.content}`)
    .join("\n");
  const texto = [
    "⚠️ Uma conversa precisa de você.",
    `Contato: ${conv.contact_name || conv.contact_phone}`,
    `Telefone: ${conv.contact_phone}`,
    `Motivo: ${motivo || "não especificado"}`,
    resumoUltimas ? `\nÚltimas mensagens:\n${resumoUltimas}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  await enviarTexto(serverUrl, token, ownerNotifyPhone, texto);
}

/** Mesmo ramo optout de §4.2, sem passar pela IA — handle.ts passo 9 (IA desligada / agente off). */
export async function aplicarOptout(params: TurnoParams): Promise<void> {
  const { admin, userId, conversationId } = params;
  const estado0 = await lerConversa(admin, userId, conversationId);
  if (!estado0) return;
  await ramoOptout(admin, userId, conversationId, estado0);
}

/** Roda um turno completo: monta o cérebro, decide o ramo (optout/escalar/legado/responder) e
 * faz o I/O de cada um — commit atômico, despedida, aviso ao dono, envio das bolhas com
 * releitura entre cada uma (AC-A20), agendamento de follow-up. */
export async function responderTurno(params: TurnoParams): Promise<void> {
  const { admin, userId, conversationId, claim } = params;
  if (!claim.length) return;

  const estado0 = await lerConversa(admin, userId, conversationId);
  if (!estado0) return;
  const optout0 = estado0.optout;

  const agent: AIConfig | null = await getAgentConfig(userId);
  if (!agent || !agent.enabled) {
    // Config ausente/desligada não é "IA falhou" no sentido de D4, mas o lado seguro é o
    // mesmo: nunca deixar a mensagem sem resposta nem decisão — escala.
    await ramoEscalar(admin, userId, conversationId, estado0, "agente sem configuração ou desligado");
    return;
  }

  const janela = claim.map((m) => m.content);
  const historyMessages = await lerHistorico(admin, userId, conversationId);
  const conversa: ConversaState = { etapa: estado0.ai_stage, dados: estado0.qualification, confirmacoes: estado0.confirmacoes };

  try {
    const outcome = await comPrazo(
      runBrainTurn({ admin, userId, agent, conversa, historyMessages, janela }),
      params.prazoTurnoMs ?? TURN_DEADLINE_MS,
    );

    if (outcome.optout) {
      await ramoOptout(admin, userId, conversationId, estado0);
      return;
    }

    // responder
    const { data: bumped, error: bumpErr } = await admin.rpc("brain_bump_confirmacoes", {
      p_user: userId,
      p_conv: conversationId,
      p_delta: outcome.prometeu ? 1 : 0,
    });
    if (bumpErr) throw new Error(`brain_bump_confirmacoes falhou: ${bumpErr.message}`);
    const n: number = bumped;
    const escalouSoPorContadorAtomico = !outcome.escalarSemContador && deveEscalarPorConfirmacoes(n);
    const desligar = outcome.escalarSemContador || deveEscalarPorConfirmacoes(n);
    // O contador local de runBrainTurn pode não ter cruzado o limiar (só via o bump atômico,
    // sob concorrência — AC-A20) e nesse caso motivoEscalar fica null: sem isto, o aviso ao
    // dono saía com "não especificado" apesar do motivo real ser conhecido.
    const motivo = desligar
      ? outcome.motivoEscalar ?? (escalouSoPorContadorAtomico ? 'disse "vou confirmar" duas vezes' : null)
      : null;

    const c = await commit(admin, userId, conversationId, {
      stage: outcome.etapa,
      qualificationDelta: outcome.qualificacaoDoTurno,
      summary: outcome.resumo,
      desligar,
      optout: false,
      motivo,
    });

    const { serverUrl, token } = await resolverInstancia(admin, estado0.instance_id);
    const numero = estado0.wa_phone || estado0.contact_phone;
    const [minMs, maxMs] = params.esperarEntreBolhasMs ?? [2000, 4000];

    for (let i = 0; i < outcome.mensagens.length; i++) {
      const atual = await lerConversa(admin, userId, conversationId);
      if (!atual) {
        console.error("[turno] releitura entre bolhas falhou ou conversa sumiu — parando o envio", { conversationId, bolha: i });
        break;
      }
      const outroDeuOptout = atual.optout && !optout0;
      const outroDesligou = !atual.ai_enabled && !(desligar && c.flipped_off);
      if (outroDeuOptout || outroDesligou) {
        console.warn("[turno] bolha suprimida — outro turno mudou o estado", { conversationId, outroDeuOptout, outroDesligou });
        break;
      }
      if (serverUrl && token) {
        const enviado = await enviarTexto(serverUrl, token, numero, outcome.mensagens[i]);
        if (enviado) {
          await admin.from("messages").insert({
            conversation_id: conversationId,
            user_id: userId,
            direction: "outbound",
            sender: "ai",
            content: outcome.mensagens[i],
          });
        }
      } else {
        console.error("[turno] sem servidor/token da instância — bolha não enviada", { conversationId });
      }
      if (i < outcome.mensagens.length - 1) {
        const espera = minMs + Math.random() * (maxMs - minMs);
        await new Promise((r) => setTimeout(r, espera));
      }
    }

    if (desligar && c.flipped_off) {
      await avisarDono(admin, serverUrl, token, agent.ownerNotifyPhone, estado0, motivo);
    }

    await scheduleInactivityFollowup({ admin, userId, conversationId, currentAutoCount: estado0.auto_followup_count });
  } catch (e: any) {
    if (e instanceof ModeloSemToolsError) {
      // ADR-02/Q3: nunca medido em produção — deixa o claim como está (o webhook decide o que
      // fazer no legado; turno.ts não reimplementa o caminho legado aqui).
      console.warn("[turno] modelo não suporta tools, turno não respondido pelo modo novo", {
        conversationId,
        motivo: e.message,
      });
      return;
    }
    // D4/fool W3: qualquer outro erro (IA falhou, erro fora da IA) escala — a mensagem do lead
    // já está salva (claim já rodou antes de chamar isto), nunca fica em silêncio.
    console.error("[turno] erro no turno, escalando", { conversationId, erro: e?.message });
    await ramoEscalar(admin, userId, conversationId, estado0, e?.message || "erro no turno", agent);
  }
}

async function ramoOptout(admin: Admin, userId: string, conversationId: string, estado0: ConversaRow) {
  const c = await commit(admin, userId, conversationId, { optout: true, desligar: false, motivo: "pedido de saída" });
  await cancelPendingFollowups(admin, conversationId);
  if (c.flipped_optout || c.flipped_off) {
    const { serverUrl, token } = await resolverInstancia(admin, estado0.instance_id);
    const numero = estado0.wa_phone || estado0.contact_phone;
    if (serverUrl && token) {
      const enviado = await enviarTexto(serverUrl, token, numero, DESPEDIDA_OPTOUT);
      if (enviado) {
        await admin.from("messages").insert({
          conversation_id: conversationId,
          user_id: userId,
          direction: "outbound",
          sender: "ai",
          content: DESPEDIDA_OPTOUT,
        });
      }
    }
  }
}

async function ramoEscalar(
  admin: Admin,
  userId: string,
  conversationId: string,
  estado0: ConversaRow,
  motivo: string,
  agentConhecido?: AIConfig | null,
) {
  const c = await commit(admin, userId, conversationId, { desligar: true, optout: false, motivo });
  if (c.flipped_off) {
    const agent = agentConhecido !== undefined ? agentConhecido : await getAgentConfig(userId);
    const { serverUrl, token } = await resolverInstancia(admin, estado0.instance_id);
    await avisarDono(admin, serverUrl, token, agent?.ownerNotifyPhone ?? null, estado0, motivo);
  }
}
