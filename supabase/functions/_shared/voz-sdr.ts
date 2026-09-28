/** CONTEXTO pede SDR mulher (Edith) — a flexão dela não fica a cargo do modelo. */
export function sdrFalaNoFeminino(contexto: string | null | undefined): boolean {
  const t = String(contexto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/genero:\s*masculino/.test(t)) return false;
  return /genero:\s*feminino/.test(t) || /nome do sdr:\s*edith/.test(t) || /voce e a edith/.test(t);
}

/**
 * Tira o "estou ótimo" (espelho de "tudo bem?") e força 1ª pessoa no feminino.
 * Não mexe no gênero de quem ela está falando.
 */
export function ajustarFalaFeminina(texto: string): string {
  let s = String(texto || "").trim();
  if (!s) return s;

  s = s.replace(
    /^\s*(ol[aá][,!]?\s+)?(tudo bem\??\s*)?(estou [oó]tim[oa]|tudo [oó]timo( por aqui)?|por aqui tudo (bem|[oó]timo))[!.,]?\s*/i,
    "",
  ).trim();
  s = s.replace(/^\s*ol[aá][,!]?\s+tudo bem\??[!.,]?\s*/i, "").trim();

  const pares: [RegExp, string][] = [
    [/\bestou [oó]timo\b/gi, "estou ótima"],
    [/\bestou pronto\b/gi, "estou pronta"],
    [/\bestou ocupado\b/gi, "estou ocupada"],
    [/\bestou animado\b/gi, "estou animada"],
    [/\bfico grato\b/gi, "fico grata"],
    [/\bgrato pela\b/gi, "grata pela"],
  ];
  for (const [re, to] of pares) s = s.replace(re, to);
  s = s.replace(/\bobrigado\b/gi, (m) => (m[0] === "O" ? "Obrigada" : "obrigada"));

  return s.trim();
}
