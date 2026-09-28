export type TransferStageOption = { id: string; name: string; position: number };

function normName(name: string) {
  return name.trim().toLowerCase();
}

/** Funil compartilhado na org: uma linha por nome (primeira por position). */
export function dedupeOrgPipelineStages(rows: TransferStageOption[]): TransferStageOption[] {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const byName = new Map<string, TransferStageOption>();
  for (const s of sorted) {
    const key = normName(s.name);
    if (!byName.has(key)) byName.set(key, s);
  }
  return [...byName.values()].sort((a, b) => a.position - b.position);
}

function ehEmContato(nome: string) {
  return /em\s*contato/i.test(nome);
}

function ehPerdido(nome: string) {
  return /perdid/i.test(nome);
}

/** Sugere etapa no funil do destinatário (nome igual ou equivalente semântico). */
export function suggestTransferStageId(
  fromStageName: string | null | undefined,
  targetStages: TransferStageOption[],
): string | null {
  if (!targetStages.length) return null;
  const from = String(fromStageName || "").trim();
  if (from) {
    const exact = targetStages.find((s) => normName(s.name) === normName(from));
    if (exact) return exact.id;
  }
  if (from && ehEmContato(from)) {
    const hit = targetStages.find((s) => ehEmContato(s.name));
    if (hit) return hit.id;
  }
  if (from && ehPerdido(from)) {
    const hit = targetStages.find((s) => ehPerdido(s.name));
    if (hit) return hit.id;
  }
  return null;
}
