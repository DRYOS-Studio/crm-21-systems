// O "cérebro": monta o prompt, roda o loop de tool-calling contra a Groq, e
// aplica os guardrails em código (gate NAVT, contagem de "vou confirmar",
// opt-out) — porta de codigo/src/{cerebro,ia,fluxo,conhecimento,tempo}.js do
// 02.dryos_sdr_prospeccao para a stack multi-tenant do Q7 (Groq em vez de
// OpenAI/OpenRouter, knowledge_base em tabela em vez de markdown bundlado).
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { CEREBRO } from "./cerebro.ts";
import { callGroq, type AIConfig, type ChatMessage, type ToolDef } from "./get-ai-config.ts";

const FUSO_HORAS = -3; // Brasília. Mesma constante do tempo.js original.
const NOMES_DIA = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado",
];

function agoraLocal(): Date {
  return new Date(Date.now() + FUSO_HORAS * 3600 * 1000);
}

function calendario(dias = 10) {
  const base = agoraLocal();
  const diaSemanaBase = base.getUTCDay();
  const out: { data: string; dia_semana: string; rotulo?: string }[] = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const item: { data: string; dia_semana: string; rotulo?: string } = {
      data: d.toISOString().slice(0, 10),
      dia_semana: NOMES_DIA[(diaSemanaBase + i) % 7],
    };
    if (i === 0) item.rotulo = "hoje";
    else if (i === 1) item.rotulo = "amanha";
    out.push(item);
  }
  return out;
}

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "consultar_calendario",
      description:
        'Devolve os próximos dias a partir de hoje, cada um com "data" (YYYY-MM-DD) e ' +
        '"dia_semana" (nome, por extenso). Os dois primeiros vêm com "rotulo": "hoje" ou ' +
        '"amanha". Chame isso SEMPRE antes de propor, confirmar ou comparar qualquer dia da ' +
        "semana ou data com o lead — nunca calcule ou adivinhe de cabeça.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_conhecimento",
      description:
        "Detalhe sobre a empresa que NÃO está no CONTEXTO. Chame quando o lead perguntar algo " +
        'específico que você não sabe responder com o que já tem — em vez de inventar ou de ' +
        'dizer "vou confirmar". Se a resposta já está no CONTEXTO, responda direto, sem chamar.',
      parameters: {
        type: "object",
        properties: { assunto: { type: "string", description: "O tópico da base de conhecimento." } },
        required: ["assunto"],
      },
    },
  },
];

const MAX_RODADAS_TOOL = 4;

async function executarTool(
  admin: ReturnType<typeof createClient>,
  userId: string,
  nome: string,
  argumentosJson: string,
): Promise<string> {
  if (nome === "consultar_calendario") return JSON.stringify(calendario(10));
  if (nome === "consultar_conhecimento") {
    let assunto: string | null = null;
    try {
      assunto = JSON.parse(argumentosJson || "{}").assunto ?? null;
    } catch {
      // segue com null
    }
    const chave = String(assunto || "").trim().toLowerCase();
    const { data: todos } = await admin
      .from("knowledge_base")
      .select("topic")
      .eq("user_id", userId);
    const assuntosValidos = (todos || []).map((r: { topic: string }) => r.topic);
    if (!chave || !assuntosValidos.includes(chave)) {
      return JSON.stringify({
        encontrado: false,
        assunto: chave || null,
        assuntos_validos: assuntosValidos,
        instrucao:
          "Assunto inválido. Se a resposta não estiver no CONTEXTO nem em um destes assuntos, " +
          "diga que vai confirmar. Não invente.",
      });
    }
    const { data: bloco } = await admin
      .from("knowledge_base")
      .select("content")
      .eq("user_id", userId)
      .eq("topic", chave)
      .maybeSingle();
    return JSON.stringify({ encontrado: true, assunto: chave, conteudo: bloco?.content || "" });
  }
  return JSON.stringify({ erro: `tool desconhecida: ${nome}` });
}

function extrairJson(texto: string | undefined): Record<string, unknown> {
  if (!texto) throw new Error("IA devolveu vazio");
  const limpo = String(texto).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const m = limpo.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        // cai fora
      }
    }
    throw new Error("IA devolveu JSON quebrado");
  }
}

export interface BrainResult {
  mensagens: string[];
  etapa: string;
  qualificacao: Record<string, string>;
  qualificado: boolean;
  resumo: string | null;
  optout: boolean;
  escalar: boolean;
  motivo_escalar: string | null;
}

/** Uma "rodada": chama a Groq, executa tools que ela pedir, até ela responder o JSON final. */
async function chamarComTools(
  admin: ReturnType<typeof createClient>,
  userId: string,
  apiKey: string,
  model: string,
  mensagensIniciais: ChatMessage[],
): Promise<BrainResult> {
  const mensagens: ChatMessage[] = [...mensagensIniciais];

  for (let rodada = 0; rodada < MAX_RODADAS_TOOL; rodada++) {
    const r = await callGroq(apiKey, model, mensagens, {
      tools: TOOLS,
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 800,
    });
    if (!r.ok) throw new Error(r.error || "IA falhou");

    if (r.toolCalls?.length) {
      mensagens.push({ role: "assistant", content: r.reply ?? null, tool_calls: r.toolCalls });
      for (const tc of r.toolCalls) {
        const conteudo = await executarTool(admin, userId, tc.function.name, tc.function.arguments);
        mensagens.push({ role: "tool", tool_call_id: tc.id, content: conteudo });
      }
      continue;
    }

    const resultado = extrairJson(r.reply);
    if (!Array.isArray(resultado.mensagens)) {
      throw new Error(`IA devolveu JSON sem "mensagens": ${JSON.stringify(resultado).slice(0, 200)}`);
    }
    return resultado as unknown as BrainResult;
  }
  throw new Error("IA ficou consultando a tool sem nunca responder");
}

/** Duas tentativas (mesma lógica de pensar() no original): se a primeira falhar, tenta de novo. */
async function pensar(
  admin: ReturnType<typeof createClient>,
  userId: string,
  apiKey: string,
  model: string,
  mensagens: ChatMessage[],
): Promise<BrainResult> {
  let ultimoErro: unknown = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      return await chamarComTools(admin, userId, apiKey, model, mensagens);
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error("IA falhou");
}

// ---- gate NAVT ----
const NAVT_TRAVA_CONVITE = ["necessidade", "autoridade", "volume"];
const NAO_RESPOSTA =
  /^(n[aã]o|n\/?a|nenhum[ao]?|\?+|-+|null|undefined|pendente|desconhecid[ao]|n[aã]o informad[ao]|a confirmar|sem informa[cç][aã]o)$/i;

export function faltaNavt(dados: Record<string, unknown>): string[] {
  return NAVT_TRAVA_CONVITE.filter((chave) => {
    const v = dados?.[chave];
    if (typeof v !== "string") return true;
    const limpo = v.trim();
    return limpo.length < 2 || NAO_RESPOSTA.test(limpo);
  });
}

function mesclarDados(antigo: Record<string, unknown> | null, novo: unknown): Record<string, unknown> {
  return { ...(antigo || {}), ...(novo && typeof novo === "object" ? (novo as Record<string, unknown>) : {}) };
}

export interface ConversaState {
  etapa: string;
  dados: Record<string, unknown>;
  confirmacoes: number;
}

export interface BrainTurnOutcome {
  mensagens: string[];
  etapa: string;
  dados: Record<string, unknown>;
  confirmacoes: number;
  qualificado: boolean;
  resumo: string | null;
  optout: boolean;
  precisaEscalar: boolean;
  motivoEscalar: string | null;
}

function buildSystemPrompt(agent: AIConfig, conversa: ConversaState, extra: string): string {
  const agora = agoraLocal();
  const nomeDia = NOMES_DIA[agora.getUTCDay()];
  const dataHora = `${agora.toISOString().slice(0, 10)} ${agora.toISOString().slice(11, 16)}`;
  return `${CEREBRO}

## CONTEXTO DA EMPRESA
${agent.businessContext || "(não configurado — responda de forma genérica e sugira que o time complete o contexto do negócio)"}

## ESTADO DESTA CONVERSA
Agora: ${dataHora} (${nomeDia})
Etapa: ${conversa.etapa || "abordar"}
Já descobri: ${JSON.stringify(conversa.dados || {})}
${extra}`;
}

function extraDaConversa(dados: Record<string, unknown>): string {
  const falta = faltaNavt(dados);
  const trava = falta.length
    ? `Ainda NÃO dá pra convidar: falta descobrir ${falta.join(", ")}. Não proponha reunião, diagnóstico, dia nem horário antes disso.`
    : "necessidade, autoridade e volume já estão preenchidos: pode convidar quando fizer sentido.";
  return `Número de bolhas: uma ou duas, no máximo. Na abordagem, sempre uma só.\n${trava}`;
}

/**
 * Roda um turno completo do cérebro: monta o prompt, chama a Groq (com tools),
 * aplica o gate NAVT com re-prompt de correção, conta "vou confirmar", e
 * devolve o que o chamador (webhook / run-followups) precisa persistir e enviar.
 *
 * `historyMessages` já vem no formato {role, content} (histórico de mensagens
 * anteriores). `extraSistema` é um texto extra opcional só pro modo específico
 * do chamador (ex: instrução de reengajamento do run-followups).
 */
export async function runBrainTurn(params: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  agent: AIConfig;
  conversa: ConversaState;
  historyMessages: { role: "user" | "assistant"; content: string }[];
  extraSistema?: string;
}): Promise<BrainTurnOutcome> {
  const { admin, userId, agent, conversa, historyMessages } = params;
  const extra = `${extraDaConversa(conversa.dados)}${params.extraSistema ? `\n\n${params.extraSistema}` : ""}`;

  const mensagens: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(agent, conversa, extra) },
    ...historyMessages,
  ];

  let r = await pensar(admin, userId, agent.apiKey, agent.model, mensagens);

  let dados = mesclarDados(conversa.dados, r.qualificacao);
  let falta = faltaNavt(dados);

  // GATE NAVT: tentou "convidar" sem os 3 campos — pede de novo, uma vez, sem o convite.
  if (r.etapa === "convidar" && falta.length) {
    const extraCorrecao = `${extraDaConversa(dados)}

## O SISTEMA RECUSOU A SUA ÚLTIMA RESPOSTA
Você tentou ir pra etapa "convidar", mas ainda falta descobrir: ${falta.join(", ")}.
Não proponha reunião, diagnóstico, dia nem horário nesta mensagem.
Faça UMA pergunta de descoberta sobre o que falta, e devolva "etapa": "descobrir".`;
    try {
      const corrigida = await pensar(admin, userId, agent.apiKey, agent.model, [
        { role: "system", content: buildSystemPrompt(agent, conversa, extraCorrecao) },
        ...historyMessages,
      ]);
      r = corrigida;
      dados = mesclarDados(conversa.dados, r.qualificacao);
      falta = faltaNavt(dados);
    } catch {
      // segunda chamada falhou: segue com a resposta original e só segura a etapa abaixo
    }
  }

  // Contador de "vou confirmar": regra em código, não no prompt.
  let confirmacoes = conversa.confirmacoes || 0;
  const prometeu = (r.mensagens || []).some((t) => /vou (confirmar|ver|checar|verificar)/i.test(t || ""));
  if (prometeu) confirmacoes++;

  const etapa = r.etapa === "convidar" && falta.length ? "descobrir" : r.etapa || conversa.etapa;
  const precisaEscalar = r.escalar === true || confirmacoes >= 2;
  const motivoEscalar = r.motivo_escalar || (confirmacoes >= 2 ? 'disse "vou confirmar" duas vezes' : null);

  return {
    mensagens: (r.mensagens || []).slice(0, 2).filter((t) => typeof t === "string" && t.trim()),
    etapa,
    dados,
    confirmacoes,
    qualificado: r.qualificado === true,
    resumo: r.resumo || null,
    optout: r.optout === true || historyMessages.some((m) => m.role === "user" && pediuParaSair(m.content)),
    precisaEscalar,
    motivoEscalar,
  };
}

/** Sem acento, minúsculas, sem espaço nas pontas — mesma normalização da sonda (D7 é sobre forma, não sobre grafia). */
function normalizarSinal(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/**
 * Regra de FORMA (D7): o pedido de saída precisa ser a mensagem inteira ("pare", "stop")
 * ou uma frase explícita de parada — nunca uma palavra solta dentro de frase de negócio
 * ("para quando fica pronto?", "pode parar o carro na frente?"). Satisfaz os corpora de
 * AC-A5/AC-A5n; prova em `battery/sonda-corpus.mjs`. Não depende do modelo.
 */
const SAIR = [
  /^(pare|para|parar|stop|sair|chega)[\s.!]*$/,
  /\bpar[ae] de (me )?(mandar|enviar)/,
  /\bnao quero mais receber\b/,
  /\bnao tenho interesse\b/,
  /\b(me )?tira (meu numero )?da lista\b/,
  /\bsai(r)? da lista\b/,
  /\bdescadastr/,
  /\bvou (denunciar|bloquear)\b/,
  /\bnao perturbe\b/,
  /\bisso e spam\b/,
];

export function pediuParaSair(texto: string): boolean {
  if (!texto) return false;
  const t = normalizarSinal(texto);
  return SAIR.some((r) => r.test(t));
}

/**
 * Regra de FORMA (D7) pro pedido de humano: frase explícita, nunca palavra solta dentro
 * de frase de negócio ("queria falar com vocês sobre preço"). Satisfaz os corpora de
 * AC-A4/AC-A4n; prova em `battery/sonda-corpus.mjs`. Não depende do modelo.
 */
const HUMANO = [
  /\bfalar com (uma |um )?(pessoa|humano|atendente|vendedor|responsavel)\b/,
  /\btem alguem ai\b/,
  /\bme (passa|transfere) (pra|para) (um |uma |o |a )?(pessoa|humano|atendente|vendedor|responsavel)\b/,
  /\b(isso e|e) (um )?(robo|bot)\b/,
];

export function pediuHumano(texto: string): boolean {
  if (!texto) return false;
  const t = normalizarSinal(texto);
  return HUMANO.some((r) => r.test(t));
}
