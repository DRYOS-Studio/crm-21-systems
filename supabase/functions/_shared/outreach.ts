/** Regras puras do disparo (T28). Relógio e RNG entram por argumento. */

export const P_PULAR = 0.3;
export const INTERVALO_MS = 60_000;
export const FREIO_MIN_ENVIADOS = 30;
export const FREIO_TAXA = 0.05;

export type FlagsDisparo = {
  saturdayMorning?: boolean;
};

function wallSP(agora: Date) {
  const s = agora.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [date, time] = s.split(" ");
  const [y, mo, da] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
  return { y, mo, da, h, mi, dow, iso: date };
}

/** AC-B5 — domingo nunca; sábado só com flag e 9–13h SP; dia útil 9–18h SP. */
export function podeDispararAgora(agora: Date, flags: FlagsDisparo = {}): boolean {
  const { h, dow } = wallSP(agora);
  if (dow === 0) return false;
  if (dow === 6) {
    if (!flags.saturdayMorning) return false;
    return h >= 9 && h < 13;
  }
  return h >= 9 && h < 18;
}

function ymdSP(agora: Date | string): string {
  if (typeof agora === "string") return agora.slice(0, 10);
  return wallSP(agora).iso;
}

function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de}T12:00:00Z`);
  const b = Date.parse(`${ate}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * AC-B6 — `min(10 + 5·semanas, cap)` depois do 1º envio; `min(10, cap)` antes.
 * Sem `Math.max(1, …)`: cap 0 no banco é recusado pelo check, não por aqui.
 */
export function tetoEfetivo(cap: number, rampStart: string | null, hoje: Date | string): number {
  if (!rampStart) return Math.min(10, cap);
  const semanas = Math.max(0, Math.floor(diasEntre(rampStart.slice(0, 10), ymdSP(hoje)) / 7));
  return Math.min(10 + 5 * semanas, cap);
}

/** AC-B7 — enviados do dia SP ≥ teto ⇒ não manda. */
export function atingiuTeto(enviados: number, teto: number): boolean {
  return enviados >= teto;
}

/** AC-B9 — toque 1 → +3d; toque 2 → +7d; toque 3 ⇒ sem 4º. */
export function proximoToque(toqueEnviado: number, dia: string): string | null {
  if (toqueEnviado === 1) return diaMais(dia, 3);
  if (toqueEnviado === 2) return diaMais(dia, 7);
  return null;
}

function diaMais(dia: string, dias: number): string {
  const d = new Date(`${dia.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** AC-B10 — ≥30 enviados e taxa < 5% ⇒ pausar. */
export function freio(stats: { enviados: number; responderam: number }): {
  pausar: boolean;
  taxa: number;
  motivo: string | null;
} {
  const { enviados, responderam } = stats;
  const taxa = enviados > 0 ? responderam / enviados : 0;
  if (enviados < FREIO_MIN_ENVIADOS || taxa >= FREIO_TAXA) {
    return { pausar: false, taxa, motivo: null };
  }
  const pct = (taxa * 100).toFixed(1);
  return {
    pausar: true,
    taxa,
    motivo: `taxa de resposta em ${pct}% com ${enviados} enviados hoje`,
  };
}

/** AC-B17 — RNG injetado. */
export function devePularTick(rng: () => number = Math.random): boolean {
  return rng() < P_PULAR;
}

/** AC-B23 — sorteio, nunca variação fixa. */
export function sortearVariacao<T>(variacoes: T[], rng: () => number = Math.random): T {
  return variacoes[Math.floor(rng() * variacoes.length) % variacoes.length];
}

/**
 * AC-B21 — `{nome}` do prospect, `{empresa}` do tenant.
 * Placeholder vazio some com a vírgula/espaço vizinho; nada de `{nome}` literal.
 */
export function montarToque1(
  variacao: string,
  prospect: { nome?: string | null; empresa?: string | null },
  companyName?: string | null,
): string {
  const nome = (prospect.nome ?? "").trim();
  const empresa = (companyName ?? prospect.empresa ?? "").trim();
  return preencher(preencher(variacao, "nome", nome), "empresa", empresa).trim();
}

function preencher(texto: string, chave: string, valor: string): string {
  const token = `{${chave}}`;
  if (!texto.includes(token)) return texto;
  if (valor) return texto.split(token).join(valor);
  return texto
    .replace(new RegExp(`\\s*,\\s*\\{${chave}\\}`, "g"), "")
    .replace(new RegExp(`\\{${chave}\\}\\s*,\\s*`, "g"), "")
    .replace(new RegExp(`\\s*\\{${chave}\\}\\s*`, "g"), " ")
    .replace(/[ \t]{2,}/g, " ");
}
