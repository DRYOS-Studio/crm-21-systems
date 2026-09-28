export function soCumprimento(texto: string | undefined): boolean {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[!?.,…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return /^(ola|oi|eai|e ai|hey|hello|bom dia|boa tarde|boa noite|tudo bem|tudo bom|td bem|td bom|beleza|opa)( (ola|oi|tudo bem|tudo bom|e voce|e vc|e ai))*$/.test(
    t,
  );
}

/** A primeira bolha do histórico é nossa — a pessoa não chegou falando. */
export function nosEscrevemosPrimeiro(history: { role: string; content?: string }[]): boolean {
  const first = history.find((m) => String(m.content || "").trim());
  return first?.role === "assistant";
}

export function modoDaConversa(
  etapa: string,
  history: { role: string; content?: string }[],
): string {
  if (nosEscrevemosPrimeiro(history) || etapa === "abordar" || etapa === "romper") {
    return "abordagem (SDR). A gente escreveu primeiro. OBRIGATÓRIO NA FALA vale. IGNORE a seção inbound/receptivo. PROIBIDO perguntar por que ela chegou, se veio pela página ou 'como posso ajudar'.";
  }
  const primeiroDeles = !history.length || history[0]?.role === "user";
  if (primeiroDeles) {
    return "receptivo (atendimento). Descubra por que ela chegou. Você conhece a empresa do CONTEXTO. Não jogue o pitch da campanha se ela não veio por isso.";
  }
  return `etapa ${etapa}`;
}

export function extraAbordagem(history: { role: string; content?: string }[]): string {
  if (!nosEscrevemosPrimeiro(history)) return "";
  const userMsgs = history.filter((m) => m.role === "user" && String(m.content || "").trim());
  const lastUser = userMsgs[userMsgs.length - 1]?.content || "";
  if (userMsgs.length <= 1 && soCumprimento(lastUser)) {
    return `
MODO TRAVADO: abordagem. A primeira mensagem pronta já foi enviada (está no histórico). Ela só devolveu o cumprimento. PROIBIDO perguntar origem, página, se conhece a empresa, se é escritório, "como posso ajudar". Sua bolha: apresente-se e diga por que escreveu, no tom do CONTEXTO. Não repita o olá.`;
  }
  return `
MODO TRAVADO: abordagem. A gente escreveu primeiro. Continue essa conversa. Não vire receptivo.`;
}
