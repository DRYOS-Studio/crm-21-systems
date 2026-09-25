import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

function previewSemNome(variacao: string, companyName: string | null): string {
  return preencher(preencher(variacao, "nome", ""), "empresa", (companyName ?? "").trim()).trim();
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

function hasLink(text: string): boolean {
  return /(https?:\/\/|www\.|wa\.me)/i.test(text);
}

function offenderIndexes(texts: string[], err: string): number[] {
  const filled = texts.map((t) => t.trim()).filter(Boolean);
  if (/pelo menos 2/i.test(err)) {
    return texts.map((t, i) => (t.trim() && filled.length < 2 ? i : -1)).filter((i) => i >= 0);
  }
  if (/len_chk|120|character/i.test(err)) {
    return texts.map((t, i) => (t.length > 120 || !t.trim() ? i : -1)).filter((i) => i >= 0);
  }
  if (/no_link|link|wa\.me|www\./i.test(err)) {
    return texts.map((t, i) => (hasLink(t) ? i : -1)).filter((i) => i >= 0);
  }
  if (/empresa/i.test(err)) {
    return texts.map((t, i) => (t.includes("{empresa}") ? i : -1)).filter((i) => i >= 0);
  }
  return [];
}

export function OpenersEditor() {
  const { user } = useAuth();
  const [texts, setTexts] = useState(["", ""]);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [offenders, setOffenders] = useState<number[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data: cfg } = await supabase
        .from("agent_configs")
        .select("company_name")
        .eq("user_id", user.id)
        .maybeSingle();
      setCompanyName(cfg?.company_name ?? null);
      const { data } = await supabase
        .from("outreach_openers" as never)
        .select("text")
        .eq("user_id", user.id)
        .eq("active", true);
      const loaded = ((data ?? []) as { text: string }[]).map((r) => r.text);
      if (loaded.length) setTexts(loaded.length === 1 ? [loaded[0], ""] : loaded);
    })();
  }, [user?.id]);

  const setAt = (i: number, value: string) => {
    setTexts((prev) => prev.map((t, idx) => (idx === i ? value : t)));
    setError("");
    setOffenders([]);
    setSaved(false);
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setError("");
    setOffenders([]);
    setSaved(false);
    const payload = texts.map((t) => t.trim()).filter(Boolean);
    try {
      const { error: rpcErr } = await supabase.rpc("save_openers" as never, { p_texts: payload } as never);
      if (rpcErr) {
        setError(rpcErr.message);
        setOffenders(offenderIndexes(texts, rpcErr.message));
        return;
      }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg text-foreground">Variações do toque 1</h2>
      <p className="text-sm text-muted-foreground">
        Pelo menos 2, até 120 caracteres, sem link. Use {"{nome}"} e {"{empresa}"}.
      </p>
      <div className="space-y-4">
        {texts.map((text, i) => {
          const bad = offenders.includes(i);
          return (
            <div key={i} data-opener={i} data-offender={bad ? "true" : "false"} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={`opener-${i}`} className="text-xs">
                  Variação {i + 1}
                </Label>
                <span
                  className={`text-xs font-mono ${text.length > 120 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {text.length}/120
                </span>
              </div>
              <Textarea
                id={`opener-${i}`}
                value={text}
                disabled={saving}
                maxLength={200}
                onChange={(e) => setAt(i, e.target.value)}
                className={bad ? "border-destructive" : undefined}
              />
              <p id={`opener-preview-${i}`} className="text-xs text-muted-foreground">
                Prévia: {previewSemNome(text, companyName) || "—"}
              </p>
              {texts.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setTexts((prev) => prev.filter((_, idx) => idx !== i));
                    setError("");
                    setOffenders([]);
                  }}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Remover
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => setTexts((prev) => [...prev, ""])}
        >
          <Plus className="mr-1 h-4 w-4" />
          Adicionar variação
        </Button>
        <Button id="opener-save" type="button" size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar variações"
          )}
        </Button>
      </div>
      {error && (
        <p id="opener-error" className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p id="opener-saved" className="text-sm text-foreground">
          Salvo!
        </p>
      )}
    </section>
  );
}
