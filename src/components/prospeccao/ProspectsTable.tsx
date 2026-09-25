import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Prospect = {
  id: string;
  phone: string;
  name: string | null;
  company: string | null;
  city: string | null;
  estado: string;
  tentativas: number;
  conversation_id: string | null;
};

type Send = { prospect_id: string; sent_at: string | null; status: string };

const ESTADO_PILL: Record<string, { variant: "neutral" | "oak" | "ok" | "sage" | "warning"; label: string }> = {
  fila: { variant: "neutral", label: "fila" },
  abordado: { variant: "oak", label: "abordado" },
  respondeu: { variant: "ok", label: "respondeu" },
  descartado: { variant: "sage", label: "descartado" },
  optout: { variant: "warning", label: "optout" },
};

function hojeSP() {
  return new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
}

function diaSP(iso: string) {
  return new Date(iso).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
}

function openCsv() {
  document.getElementById("csv-file")?.click();
}

export function ProspectsTable() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Prospect[] | null>(null);
  const [enviados, setEnviados] = useState(0);
  const [responderam, setResponderam] = useState(0);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data: prospects } = await supabase
        .from("prospects" as never)
        .select("id, phone, name, company, city, estado, tentativas, conversation_id")
        .eq("user_id", user.id)
        .order("created_at");
      const list = (prospects ?? []) as Prospect[];
      setRows(list);

      const { data: sends } = await supabase
        .from("outreach_sends" as never)
        .select("prospect_id, sent_at, status")
        .eq("user_id", user.id)
        .in("status", ["enviado", "incerto"]);
      const hoje = hojeSP();
      const today = ((sends ?? []) as Send[]).filter((s) => s.sent_at && diaSP(s.sent_at) === hoje);
      setEnviados(today.length);

      const { data: inbound } = await supabase
        .from("messages")
        .select("conversation_id, created_at")
        .eq("user_id", user.id)
        .eq("direction", "inbound");
      const convByProspect = new Map(list.filter((p) => p.conversation_id).map((p) => [p.id, p.conversation_id!]));
      const replied = today.filter((s) => {
        const conv = convByProspect.get(s.prospect_id);
        if (!conv || !s.sent_at) return false;
        return ((inbound ?? []) as { conversation_id: string; created_at: string }[]).some(
          (m) => m.conversation_id === conv && m.created_at > s.sent_at,
        );
      }).length;
      setResponderam(replied);
    })();
  }, [user?.id]);

  const taxa = enviados > 0 ? `${((responderam / enviados) * 100).toFixed(1)}%` : "—";

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg text-foreground">Contatos</h2>
      <div className="flex flex-wrap gap-4 text-sm">
        <p>
          Enviados hoje: <span id="prospects-enviados" className="font-medium text-foreground">{enviados}</span>
        </p>
        <p>
          Taxa: <span id="prospects-taxa" className="font-medium text-foreground">{taxa}</span>
        </p>
      </div>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : rows.length === 0 ? (
        <div id="prospects-empty" className="space-y-3">
          <p className="text-sm text-muted-foreground">Nenhum contato ainda.</p>
          <Button id="prospects-import-cta" type="button" size="sm" variant="outline" onClick={openCsv}>
            Importar CSV
          </Button>
        </div>
      ) : (
        <div id="prospects-table-wrap" className="overflow-x-auto">
          <Table id="prospects-table">
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Toque</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const pill = ESTADO_PILL[p.estado] ?? ESTADO_PILL.fila;
                return (
                  <TableRow
                    key={p.id}
                    data-prospect-phone={p.phone}
                    data-prospect-name={p.name ?? ""}
                    data-prospect-estado={p.estado}
                  >
                    <TableCell>{p.name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{p.phone}</TableCell>
                    <TableCell>{p.company || "—"}</TableCell>
                    <TableCell>{p.city || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={pill.variant}>{pill.label}</Badge>
                    </TableCell>
                    <TableCell data-prospect-toque={`${p.tentativas}/3`}>{p.tentativas}/3</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
