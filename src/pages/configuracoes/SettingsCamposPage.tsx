import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

type CustomField = { id: string; label: string; field_key: string };

function fieldKey(label: string) {
  return label.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48);
}

export default function SettingsCamposPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const [fields, setFields] = useState<CustomField[]>([]);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void supabase.from("lead_custom_fields").select("id, label, field_key").order("label")
      .then(({ data, error }) => {
        if (error) toast({ variant: "destructive", title: "Erro ao carregar campos", description: error.message });
        else setFields((data ?? []) as CustomField[]);
      });
  }, [userId]);

  const addField = async () => {
    const clean = label.trim();
    const key = fieldKey(clean);
    if (!clean || !key) return;
    setSaving(true);
    const { data, error } = await supabase.from("lead_custom_fields")
      .insert({ user_id: userId!, label: clean, field_key: key })
      .select("id, label, field_key").single();
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Não foi possível criar", description: error.message });
      return;
    }
    setFields((prev) => [...prev, data as CustomField].sort((a, b) => a.label.localeCompare(b.label)));
    setLabel("");
    toast({ title: "Campo criado" });
  };

  return (
    <section className="max-w-xl space-y-5">
      <div>
        <h2 className="font-semibold">Campos personalizados</h2>
        <p className="mt-1 text-sm text-muted-foreground">Crie campos para a ficha do lead. Exemplos: marca, modelo, ano e placa do veículo.</p>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="custom-field-label">Nome do campo</Label>
          <Input id="custom-field-label" maxLength={48} value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addField(); } }} />
        </div>
        <Button onClick={() => void addField()} disabled={saving || !label.trim()}>Adicionar</Button>
      </div>
      <ul className="divide-y rounded-md border">
        {fields.map((field) => <li key={field.id} className="flex items-center justify-between px-3 py-2 text-sm"><span>{field.label}</span><code className="text-xs text-muted-foreground">{field.field_key}</code></li>)}
        {fields.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">Nenhum campo criado.</li>}
      </ul>
    </section>
  );
}
