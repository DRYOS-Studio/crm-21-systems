import { useState } from "react";
import { CircleSlash, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useLossReasons } from "@/hooks/useLossReasons";

export function LossReasonsSection() {
  const { reasons, createReason, setActive, removeReason } = useLossReasons();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createReason(name);
      setDraft("");
      toast({ title: "Motivo adicionado" });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Não foi possível salvar",
        description: e instanceof Error ? e.message : "Tente de novo.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <CircleSlash className="w-4 h-4 text-primary" /> Motivos de perda
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Aparecem ao mover um lead para a coluna Perdido no CRM ou no inbox.
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ex.: Preço alto"
          className="h-9 text-sm"
          maxLength={48}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <Button type="button" size="sm" className="shrink-0" disabled={busy || !draft.trim()} onClick={() => void add()}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {reasons.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum motivo cadastrado ainda.</p>
      ) : (
        <ul className="space-y-2">
          {reasons.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2">
              <span className={`text-sm ${r.active ? "" : "text-muted-foreground line-through"}`}>{r.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={r.active}
                  onCheckedChange={(v) => {
                    void setActive(r.id, v).catch((e: unknown) =>
                      toast({
                        variant: "destructive",
                        title: "Erro",
                        description: e instanceof Error ? e.message : "Falha",
                      }),
                    );
                  }}
                  aria-label={`Ativo: ${r.name}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Remover ${r.name}`}
                  onClick={() => {
                    void removeReason(r.id).catch((e: unknown) =>
                      toast({
                        variant: "destructive",
                        title: "Não dá para remover",
                        description: e instanceof Error ? e.message : "Pode estar em uso.",
                      }),
                    );
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
