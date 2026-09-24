// O "cérebro": monta o prompt, roda o loop de tool-calling contra a Groq, e
// aplica os guardrails em código (gate NAVT, contagem de "vou confirmar",
// opt-out) — porta de codigo/src/{cerebro,ia,fluxo,conhecimento,tempo}.js do
// 02.dryos_sdr_prospeccao para a stack multi-tenant do Q7 (Groq em vez de
// OpenAI/OpenRouter, knowledge_base em tabela em vez de markdown bundlado).
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { CEREBRO } from "./cerebro.ts";
import { callGroq, type AIConfig, type ChatMessage, type ToolDef, type GroqResult } from "./get-ai-config.ts";

const FUSO_HORAS = 0; // Brasília. Mesma constante do tempo.js original.
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

/** Como `extrairJson`, mas devolve `null` em vez de lançar — pra tentar uma correção em vez de desistir. */
function tentarExtrairJson(texto: string | undefined): Record<string, unknown> | null {
  try {
    return extrairJson(texto);
  } catch {
    return null;
  }
}

function temFormatoValido(j: Record<string, unknown> | null): j is Record<string, unknown> & { mensagens: unknown[] } {
  return j !== null && Array.isArray(j.mensagens);
}

/** ADR-02/Q3: sinal de legado — nunca medido em produção (design.md §0: "palpite"), por isso
 * exige um erro EXPLÍCITO sobre suporte a tools/function calling, nunca `tool_use_failed`
 * (esse é rodada perdida, não falta de suporte). */
export class ModeloSemToolsError extends Error {}

function pareceNaoSuportarTools(r: GroqResult): boolean {
  if (r.code === "tool_use_failed") return false;
  const texto = `${r.error || ""} ${r.rawBody || ""}`.toLowerCase();
  return /does not support (tool|function)|tool.?use.*not supported|function calling.*not supported|n[aã]o suporta (tool|function)/i.test(
    texto,
  );
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
  // Conta TODA chamada HTTP (rodada normal, tool_use_failed perdida, e a de formatação) contra
  // o MESMO teto — a de formatação não é "de graça": achado de code-review, sem isto o pior
  // caso vira 2 tentativas × 5 chamadas = 10, estourando o teto de ≤8 de AC-A9 (design §5).
  let chamadas = 0;

  while (chamadas < MAX_RODADAS_TOOL) {
    chamadas++;
    // ADR-01: a Groq não documenta tools + response_format juntos — a chamada com tools
    // nunca leva response_format; a resposta final é parseada por extrairJson.
    const r = await callGroq(apiKey, model, mensagens, {
      tools: TOOLS,
      temperature: 0.7,
      max_tokens: 800,
    });
    if (!r.ok) {
      // ADR-02: 400 tool_use_failed é rodada perdida (o modelo tentou e falhou), não falta de
      // suporte — tenta de novo na próxima rodada, sem consumir a tentativa de `pensar`.
      if (r.code === "tool_use_failed") continue;
      if (pareceNaoSuportarTools(r)) throw new ModeloSemToolsError(r.error || "modelo não suporta tools");
      throw new Error(r.error || "IA falhou");
    }

    if (r.toolCalls?.length) {
      mensagens.push({ role: "assistant", content: r.reply ?? null, tool_calls: r.toolCalls });
      for (const tc of r.toolCalls) {
        const conteudo = await executarTool(admin, userId, tc.function.name, tc.function.arguments);
        mensagens.push({ role: "tool", tool_call_id: tc.id, content: conteudo });
      }
      continue;
    }

    const resultado = tentarExtrairJson(r.reply);
    if (temFormatoValido(resultado)) return resultado as unknown as BrainResult;

    if (chamadas >= MAX_RODADAS_TOOL) {
      throw new Error(`IA devolveu JSON sem "mensagens" e o teto de chamadas acabou: ${String(r.reply).slice(0, 200)}`);
    }
    // ADR-01: shape inválido ⇒ 1 chamada de formatação (json_object, sem tools) — conta contra
    // o mesmo teto de AC-A9 (design §5), não é uma rodada "de graça".
    chamadas++;
    const formatado = await callGroq(
      apiKey,
      model,
      [
        ...mensagens,
        { role: "assistant", content: r.reply ?? "" },
        {
          role: "user",
          content:
            'Sua última resposta não veio no formato pedido. Responda de novo, só o JSON, com "mensagens" como array de strings.',
        },
      ],
      { response_format: { type: "json_object" }, temperature: 0.3, max_tokens: 800 },
    );
    if (formatado.ok) {
      const corrigido = tentarExtrairJson(formatado.reply);
      if (temFormatoValido(corrigido)) return corrigido as unknown as BrainResult;
    }
    throw new Error(`IA devolveu JSON sem "mensagens" mesmo após reformatar: ${String(r.reply).slice(0, 200)}`);
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
  /** Só o que ESTE turno descobriu (delta) — quem persiste faz o merge (RPC, ADR-04). */
  qualificacaoDoTurno: Record<string, unknown>;
  confirmacoes: number;
  qualificado: boolean;
  resumo: string | null;
  optout: boolean;
  precisaEscalar: boolean;
  motivoEscalar: string | null;
  /** `prometeu || modelo.escalar || humano pedido || optout só do modelo` — sem o limiar de
   * confirmações (design §4.2). `turno.ts` recompõe a escalada final com o valor atômico do
   * bump no Postgres (AC-A20); `precisaEscalar` acima já usa o contador local, útil sozinho. */
  escalarSemContador: boolean;
  /** Esta mensagem prometeu "vou confirmar" (já considerando o corte de 2 bolhas, AC-A3o). */
  prometeu: boolean;
}

/** Limiar de escalada por promessa repetida (design §4.2). `n` já inclui a promessa deste
 * turno — `runBrainTurn` soma com o contador local; quem persiste de verdade (turno.ts) soma
 * com o valor devolvido pelo bump atômico no Postgres, não com este contador em memória. */
export function deveEscalarPorConfirmacoes(n: number): boolean {
  return n >= 2;
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
 * Roda um turno completo do cérebro: decide saída/humano por código sobre a janela (D5/D7,
 * antes de qualquer chamada à IA — AC-A5b), monta o prompt, chama a Groq (com tools), aplica
 * o gate NAVT com re-prompt de correção, conta "vou confirmar", e devolve o que o chamador
 * (turno.ts) precisa persistir e enviar.
 *
 * `historyMessages` é o histórico completo (contexto pro modelo). `janela` (D5) é só o texto
 * das mensagens ainda não processadas por um turno — é o único texto que passa pelas regras
 * de saída/humano (AC-A4w/AC-A5w: mensagem antiga na janela errada não pode disparar nada).
 * `extraSistema` é um texto extra opcional só pro modo específico do chamador (ex: instrução
 * de reengajamento do run-followups).
 */
export async function runBrainTurn(params: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  agent: AIConfig;
  conversa: ConversaState;
  historyMessages: { role: "user" | "assistant"; content: string }[];
  janela: string[];
  extraSistema?: string;
}): Promise<BrainTurnOutcome> {
  const { admin, userId, agent, conversa, historyMessages, janela } = params;

  // AC-A5/AC-A5b (D6): decidido por código, antes de qualquer chamada à IA — 0 chamadas.
  if (janela.some((t) => pediuParaSair(t))) {
    return {
      mensagens: [],
      etapa: conversa.etapa,
      qualificacaoDoTurno: {},
      confirmacoes: conversa.confirmacoes || 0,
      qualificado: false,
      resumo: null,
      optout: true,
      precisaEscalar: false,
      motivoEscalar: null,
      escalarSemContador: false,
      prometeu: false,
    };
  }
  // Pedido de humano não pula a IA (a resposta sai e a conversa escala junto).
  const pediuAjuda = janela.some((t) => pediuHumano(t));

  const extra = `${extraDaConversa(conversa.dados)}${params.extraSistema ? `\n\n${params.extraSistema}` : ""}`;

  const mensagens: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(agent, conversa, extra) },
    ...historyMessages,
  ];

  let r = await pensar(admin, userId, agent.apiKey, agent.model, mensagens);

  // Delta deste turno (pode vir de 2 chamadas, se o gate NAVT reprompta) — nunca mesclado com
  // conversa.dados aqui (quem persiste faz esse merge). `dados` é só uso interno pro gate NAVT.
  let qualificacaoDoTurno: Record<string, unknown> =
    r.qualificacao && typeof r.qualificacao === "object" ? r.qualificacao : {};
  let dados = mesclarDados(conversa.dados, qualificacaoDoTurno);
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
      // Acumula com a 1ª tentativa: a resposta corrigida não repete campos já descobertos
      // (o prompt pede só UMA pergunta nova), então perder o merge aqui perde o que a 1ª achou.
      qualificacaoDoTurno = mesclarDados(qualificacaoDoTurno, r.qualificacao);
      dados = mesclarDados(conversa.dados, qualificacaoDoTurno);
      falta = faltaNavt(dados);
    } catch {
      // segunda chamada falhou: segue com a resposta original e só segura a etapa abaixo
    }
  }

  // AC-A3o: a promessa só conta se sobreviver ao corte de 2 bolhas — é isso que sai de verdade.
  const mensagensEnviadas = (r.mensagens || []).slice(0, 2).filter((t) => typeof t === "string" && t.trim());
  const prometeu = mensagensEnviadas.some((t) => /vou (confirmar|ver|checar|verificar)/i.test(t || ""));
  const n = (conversa.confirmacoes || 0) + (prometeu ? 1 : 0);

  const etapa = r.etapa === "convidar" && falta.length ? "descobrir" : r.etapa || conversa.etapa;

  // AC-A5e/D6: optout só do modelo (a janela já não casou AC-A5, senão já teríamos saído acima
  // antes da IA) nunca vira optout permanente — escala.
  const optoutDoModeloSoEscala = r.optout === true;
  const escalarSemContador = pediuAjuda || r.escalar === true || optoutDoModeloSoEscala;
  const precisaEscalar = escalarSemContador || deveEscalarPorConfirmacoes(n);
  const motivoEscalar =
    r.motivo_escalar ||
    (pediuAjuda ? "pediu para falar com humano" : null) ||
    (optoutDoModeloSoEscala ? "optout só do modelo, fora da regra de forma" : null) ||
    (deveEscalarPorConfirmacoes(n) ? 'disse "vou confirmar" duas vezes' : null);

  return {
    mensagens: mensagensEnviadas,
    etapa,
    qualificacaoDoTurno,
    confirmacoes: n,
    qualificado: r.qualificado === true,
    resumo: r.resumo || null,
    optout: false,
    precisaEscalar,
    motivoEscalar,
    escalarSemContador,
    prometeu,
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
