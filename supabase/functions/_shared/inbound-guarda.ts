/** Espera depois do último inbound antes de a IA responder — o lead ainda pode estar digitando. */
export const DEBOUNCE_INBOUND_MS_DEFAULT = 12_000;

export function debounceInboundMs(raw: string | undefined = Deno.env.get("DEBOUNCE_INBOUND_MS")): number {
  if (raw === undefined || raw === "") return DEBOUNCE_INBOUND_MS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEBOUNCE_INBOUND_MS_DEFAULT;
  return n;
}

/** Outro inbound chegou depois deste: este webhook não responde (o mais novo espera e junta a janela). */
export function aindaDigitando(meuId: string, ultimoInboundId: string | null | undefined): boolean {
  return !!ultimoInboundId && ultimoInboundId !== meuId;
}

/**
 * Greeting/ausência/auto-reply do WhatsApp Business — não é o prospect falando.
 * Conservador: frase curta humana ("oi", "estou ocupado amanhã") não casa.
 */
export function pareceRespostaAutomatica(texto: string | null | undefined): boolean {
  const t = String(texto || "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (!t) return false;
  if (/^\[(audio|imagem|video|figurinha|documento|localizacao|contato)\]$/.test(t)) return false;

  return [
    /mensagem automatica/,
    /resposta automatica/,
    /esta e uma (mensagem|resposta) automatica/,
    /automatic (message|reply)/,
    /auto[- ]?reply/,
    /away message/,
    /i('?m| am) (currently )?away/,
    /out of (the )?office/,
    /fora do (escritorio|expediente)/,
    /nao estou (disponivel|atendendo)/,
    /estou (indisponivel|ausente)( no momento)?$/,
    /no momento nao (podemos|consigo|estou) (atender|disponivel)/,
    /horario de atendimento/,
    /retornaremos (em breve|assim que)/,
    /obrigad[oa] por (entrar em contato|sua mensagem).{0,80}(retorn|voltamos|responderemos)/,
    /voce esta falando com (um )?(assistente|atendimento) (virtual|automatico)/,
    /este (numero|whatsapp) (nao )?(recebe|atende)/,
  ].some((re) => re.test(t));
}
