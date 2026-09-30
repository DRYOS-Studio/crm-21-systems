import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LeadTag } from "@/lib/lead-tags";

export type SegmentField = { key: string; value: string };
export type ProspectSegment = { id: string; name: string; filters: { tag_ids: string[]; fields: SegmentField[] } };

export function SavedSegments({ catalog, value, onChange }: { catalog: LeadTag[]; value: ProspectSegment | null; onChange: (segment: ProspectSegment | null) => void }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [segments, setSegments] = useState<ProspectSegment[]>([]);
  const [fields, setFields] = useState<{ label: string; field_key: string }[]>([]);
  const [name, setName] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [fieldKey, setFieldKey] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    void Promise.all([
      supabase.from("saved_prospect_segments" as never).select("id, name, filters").order("name"),
      supabase.from("lead_custom_fields").select("label, field_key").order("label"),
    ]).then(([saved, custom]) => {
      const loaded = (saved.data ?? []) as unknown as ProspectSegment[];
      setSegments(loaded);
      setFields((custom.data ?? []) as { label: string; field_key: string }[]);
    });
  }, [userId]);

  const create = async () => {
    if (!user || !name.trim() || (!tagIds.length && !(fieldKey && fieldValue))) return;
    setError("");
    const filters = { tag_ids: tagIds, fields: fieldKey && fieldValue ? [{ key: fieldKey, value: fieldValue }] : [] };
    const { data, error: saveError } = await supabase.from("saved_prospect_segments" as never)
      .insert({ user_id: user.id, name: name.trim(), filters } as never).select("id, name, filters").single();
    if (saveError) { setError(saveError.message); return; }
    const created = data as unknown as ProspectSegment;
    setSegments((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    onChange(created);
    setName(""); setTagIds([]); setFieldKey(""); setFieldValue("");
  };

  return <div className="flex flex-wrap items-end gap-2">
    <div className="space-y-1"><Label htmlFor="prospect-segment" className="text-xs">Segmento salvo</Label>
      <select id="prospect-segment" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={value?.id ?? ""} onChange={(e) => onChange(segments.find((s) => s.id === e.target.value) ?? null)}>
        <option value="">Todos</option>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
    <details className="text-sm"><summary className="cursor-pointer py-2">Criar segmento</summary>
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <div className="space-y-1"><Label htmlFor="segment-name" className="text-xs">Nome</Label><Input id="segment-name" value={name} onChange={(e) => setName(e.target.value)} className="w-36" /></div>
        <div className="space-y-1"><Label htmlFor="segment-tag" className="text-xs">Tag</Label><select id="segment-tag" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value="" onChange={(e) => e.target.value && setTagIds((ids) => ids.includes(e.target.value) ? ids : [...ids, e.target.value])}><option value="">Adicionar tag...</option>{catalog.filter((t) => !tagIds.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        {tagIds.map((id) => <button key={id} type="button" className="rounded bg-secondary px-2 py-1 text-xs" onClick={() => setTagIds((ids) => ids.filter((tag) => tag !== id))}>{catalog.find((t) => t.id === id)?.name} ×</button>)}
        <div className="space-y-1"><Label htmlFor="segment-field" className="text-xs">Campo</Label><select id="segment-field" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)}><option value="">Sem campo</option>{fields.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}</select></div>
        {fieldKey && <div className="space-y-1"><Label htmlFor="segment-value" className="text-xs">Valor exato</Label><Input id="segment-value" value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} className="w-36" /></div>}
        <Button type="button" size="sm" onClick={() => void create()} disabled={!name.trim() || (!tagIds.length && !(fieldKey && fieldValue))}>Salvar</Button>
        {error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
      </div>
    </details>
  </div>;
}
