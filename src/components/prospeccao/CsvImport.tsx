import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const BATCH = 5000;
const PHONE_KEYS = new Set(["telefone", "phone", "celular"]);
const NAME_KEYS = new Set(["nome", "name"]);
const COMPANY_KEYS = new Set(["empresa", "company"]);
const CITY_KEYS = new Set(["cidade", "city"]);

type ProspectInsert = {
  user_id: string;
  phone: string;
  name: string | null;
  company: string | null;
  city: string | null;
  extra: Record<string, string>;
  origem: string;
};

function normHeader(h: string) {
  return h.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function cell(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function parseRows(buf: ArrayBuffer): Record<string, string>[] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return raw.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) out[normHeader(k)] = cell(v);
    return out;
  });
}

function splitRow(row: Record<string, string>) {
  let phone = "";
  let name = "";
  let company = "";
  let city = "";
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (PHONE_KEYS.has(k)) phone = v;
    else if (NAME_KEYS.has(k)) name = v;
    else if (COMPANY_KEYS.has(k)) company = v;
    else if (CITY_KEYS.has(k)) city = v;
    else if (v) extra[k] = v;
  }
  return { phone, name, company, city, extra };
}

async function canonBatch(phones: string[]): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (let i = 0; i < phones.length; i += BATCH) {
    const chunk = phones.slice(i, i + BATCH);
    const { data, error } = await supabase.rpc("canon_phone_input_batch", { p_phones: chunk });
    if (error) throw error;
    out.push(...((data ?? []) as (string | null)[]));
  }
  return out;
}

async function upsertProspects(rows: ProspectInsert[]) {
  const { error } = await supabase.from("prospects" as never).upsert(rows as never, {
    onConflict: "user_id,phone",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

export function CsvImport() {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [result, setResult] = useState<{ importados: number; rejeitados: number } | null>(null);

  const onPick = (file: File | null) => {
    lastFile.current = file;
    setFileName(file?.name ?? "");
    setParseError("");
    setNetworkError("");
    setResult(null);
  };

  const runImport = async () => {
    if (!user || !lastFile.current) return;
    setSaving(true);
    setParseError("");
    setNetworkError("");
    setResult(null);
    try {
      const rows = parseRows(await lastFile.current.arrayBuffer());
      if (rows.length === 0) {
        setParseError("Arquivo sem linhas.");
        return;
      }
      const hasPhone = rows.some((r) => Object.keys(r).some((k) => PHONE_KEYS.has(k)));
      if (!hasPhone) {
        setParseError("O arquivo precisa de uma coluna telefone.");
        return;
      }

      const split = rows.map(splitRow);
      const canons = await canonBatch(split.map((r) => r.phone));
      let rejeitados = 0;
      const unique = new Map<string, ProspectInsert>();
      split.forEach((row, i) => {
        const phone = canons[i];
        if (!phone) {
          rejeitados++;
          return;
        }
        if (unique.has(phone)) return;
        unique.set(phone, {
          user_id: user.id,
          phone,
          name: row.name || null,
          company: row.company || null,
          city: row.city || null,
          extra: row.extra,
          origem: "csv",
        });
      });
      const payload = [...unique.values()];
      if (payload.length) await upsertProspects(payload);
      setResult({ importados: payload.length, rejeitados });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Falha de rede";
      setNetworkError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg text-foreground">Importar CSV</h2>
      <p className="text-sm text-muted-foreground">
        Cabeçalhos: telefone, nome, empresa, cidade. As demais colunas vão em extras.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="csv-file" className="text-xs">
          Arquivo
        </Label>
        <input
          id="csv-file"
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          disabled={saving}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:text-secondary-foreground"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button id="csv-import" type="button" size="sm" disabled={saving || !fileName} onClick={() => void runImport()}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Importando...
            </>
          ) : (
            "Importar"
          )}
        </Button>
        {networkError && (
          <Button id="csv-retry" type="button" variant="outline" size="sm" disabled={saving} onClick={() => void runImport()}>
            Tentar de novo
          </Button>
        )}
      </div>
      {parseError && (
        <p id="csv-parse-error" className="text-sm text-destructive" role="alert">
          {parseError}
        </p>
      )}
      {networkError && (
        <p id="csv-network-error" className="text-sm text-destructive" role="alert">
          {networkError}
        </p>
      )}
      {result && (
        <p id="csv-result" className="text-sm text-foreground">
          {result.importados} importados, {result.rejeitados} rejeitados
        </p>
      )}
    </section>
  );
}
