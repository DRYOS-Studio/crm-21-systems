import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useLeadTags } from "@/hooks/useLeadTags";
import { useOrgMembers } from "@/hooks/useOrgMembers";
import { useViewFilters } from "@/hooks/useViewFilters";
import { LeadTagChips, TagFilterSelect } from "@/components/lead/LeadTagEditor";
import { conversationMatchesTagFilter } from "@/lib/tag-filter";
import { UserFilterSelect } from "@/components/org/UserFilterSelect";
import { SavedSegments, type ProspectSegment } from "@/components/prospeccao/SavedSegments";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Prospect = {
  id: string;
  phone: string;
  name: string | null;
  company: string | null;
  city: string | null;
  estado: string;
  tentativas: number;
  conversation_id: string | null;
  user_id: string;
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
  const userId = user?.id;
  const [rows, setRows] = useState<Prospect[] | null>(null);
  const [enviados, setEnviados] = useState(0);
  const [responderam, setResponderam] = useState(0);
  const [toDelete, setToDelete] = useState<Prospect | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<ProspectSegment | null>(null);
  const [customFieldsByConv, setCustomFieldsByConv] = useState<Record<string, Record<string, unknown>>>({});
  const { filters, update: updateFilters } = useViewFilters(user?.id);
  const { tagFilters, userFilter } = filters;
  const orgMembers = useOrgMembers();
  const { catalog: tagCatalog, byConv: tagsByConv } = useLeadTags();

  const load = useCallback(async () => {
    if (!userId) return;
    const { data: prospects } = await supabase
      .from("prospects" as never)
      .select("id, phone, name, company, city, estado, tentativas, conversation_id, user_id")
      .order("created_at");
    const list = (prospects ?? []) as Prospect[];
    setRows(list);
    const conversationIds = list.flatMap((p) => p.conversation_id ? [p.conversation_id] : []);
    if (conversationIds.length) {
      const { data: conversations } = await supabase.from("conversations").select("id, custom_fields").in("id", conversationIds);
      setCustomFieldsByConv(Object.fromEntries((conversations ?? []).map((c) => [c.id, (c.custom_fields ?? {}) as Record<string, unknown>])));
    }

    const { data: sends } = await supabase
      .from("outreach_sends" as never)
      .select("prospect_id, sent_at, status")
      .in("status", ["enviado", "incerto"]);
    const hoje = hojeSP();
    const today = ((sends ?? []) as Send[]).filter((s) => s.sent_at && diaSP(s.sent_at) === hoje);
    setEnviados(today.length);

    const { data: inbound } = await supabase
      .from("messages")
      .select("conversation_id, created_at")
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
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!user || !toDelete) return;
    setDeleting(true);
    const prospect = toDelete;
    try {
      if (prospect.conversation_id) {
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", prospect.conversation_id);
        if ((count ?? 0) === 0) {
          await supabase
            .from("conversations")
            .delete()
            .eq("id", prospect.conversation_id);
        }
      }
      const { error } = await supabase
        .from("prospects" as never)
        .delete()
        .eq("id", prospect.id);
      if (error) throw error;
      setToDelete(null);
      toast({ title: "Removido da lista" });
      await load();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Não deu pra excluir",
        description: e instanceof Error ? e.message : "Tente de novo.",
      });
    } finally {
      setDeleting(false);
    }
  };

  const taxa = enviados > 0 ? `${((responderam / enviados) * 100).toFixed(1)}%` : "—";
  const visibleRows =
    rows == null
      ? null
      : rows.filter((p) => {
          const tagIds = p.conversation_id
            ? (tagsByConv[p.conversation_id] ?? []).map((t) => t.id)
            : [];
          if (!conversationMatchesTagFilter(tagIds, tagFilters)) return false;
          if (selectedSegment) {
            if (selectedSegment.filters.tag_ids.some((id) => !tagIds.includes(id))) return false;
            const custom = p.conversation_id ? customFieldsByConv[p.conversation_id] ?? {} : {};
            if (selectedSegment.filters.fields.some((f) => String(custom[f.key] ?? "") !== f.value)) return false;
          }
          if (userFilter !== "all" && p.user_id !== userFilter) return false;
          return true;
        });

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <h2 className="text-lg text-foreground px-5 pt-5">Contatos</h2>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-border bg-card/95 px-5 py-3 text-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <p>
          Enviados hoje: <span id="prospects-enviados" className="font-medium text-foreground">{enviados}</span>
        </p>
        <p>
          Taxa: <span id="prospects-taxa" className="font-medium text-foreground">{taxa}</span>
        </p>
        <TagFilterSelect
          catalog={tagCatalog}
          value={tagFilters}
          onChange={(next) => updateFilters({ tagFilters: next })}
        />
        <SavedSegments catalog={tagCatalog} value={selectedSegment} onChange={setSelectedSegment} />
        <UserFilterSelect
          members={orgMembers}
          currentUserId={user?.id}
          value={userFilter}
          onChange={(next) => updateFilters({ userFilter: next })}
        />
      </div>
      <div className="space-y-3 p-5 pt-3">
      {visibleRows === null ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : rows !== null && rows.length === 0 ? (
        <div id="prospects-empty" className="space-y-3">
          <p className="text-sm text-muted-foreground">Nenhum contato ainda.</p>
          <Button id="prospects-import-cta" type="button" size="sm" variant="outline" onClick={openCsv}>
            Importar CSV
          </Button>
        </div>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum contato neste filtro.</p>
      ) : (
        <div id="prospects-table-wrap" className="overflow-x-auto">
          <Table id="prospects-table">
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Toque</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((p) => {
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
                    <TableCell className="text-xs text-muted-foreground">
                      {p.user_id === user?.id
                        ? "Você"
                        : orgMembers.find((m) => m.user_id === p.user_id)?.name || "Conta"}
                    </TableCell>
                    <TableCell>
                      {p.conversation_id ? (
                        <LeadTagChips tags={tagsByConv[p.conversation_id] ?? []} max={3} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={pill.variant}>{pill.label}</Badge>
                    </TableCell>
                    <TableCell data-prospect-toque={`${p.tentativas}/3`}>{p.tentativas}/3</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Excluir ${p.name || p.phone}`}
                        onClick={() => setToDelete(p)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir da lista?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `${toDelete.name || toDelete.phone} sai da fila de disparo. Se já houver conversa com mensagem, ela permanece no CRM.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </section>
  );
}
