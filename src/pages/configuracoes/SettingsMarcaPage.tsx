import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

const MAX_LOGO_SIZE = 2 * 1024 * 1024;

export default function SettingsMarcaPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: orgId } = await supabase.rpc("my_org_id");
      if (!orgId) return;
      const { data } = await supabase.from("organizations").select("logo_url").eq("id", orgId).maybeSingle();
      if (!cancelled) setLogoUrl(data?.logo_url ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    if (file.type !== "image/png" || file.size > MAX_LOGO_SIZE) {
      toast({ variant: "destructive", title: "Arquivo inválido", description: "Use uma imagem PNG de até 2 MB." });
      return;
    }
    setSaving(true);
    const { data: orgId, error: orgError } = await supabase.rpc("my_org_id");
    if (orgError || !orgId) {
      setSaving(false);
      toast({ variant: "destructive", title: "Organização não encontrada", description: orgError?.message });
      return;
    }
    const path = `${orgId}/logo.png`;
    const { error: uploadError } = await supabase.storage.from("organization-brand").upload(path, file, { upsert: true, contentType: "image/png" });
    if (uploadError) {
      setSaving(false);
      toast({ variant: "destructive", title: "Erro ao enviar logo", description: uploadError.message });
      return;
    }
    const publicUrl = `${supabase.storage.from("organization-brand").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
    const { error } = await supabase.from("organizations").update({ logo_url: publicUrl }).eq("id", orgId);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao salvar logo", description: error.message });
      return;
    }
    setLogoUrl(publicUrl);
    window.dispatchEvent(new CustomEvent("q7-brand-logo", { detail: publicUrl }));
    toast({ title: "Logo atualizada" });
  };

  return (
    <section className="max-w-xl space-y-5">
      <div>
        <h2 className="font-semibold">Logo da instalação</h2>
        <p className="mt-1 text-sm text-muted-foreground">Envie um PNG de até 2 MB. A alteração aparece no cabeçalho desta instalação.</p>
      </div>
      {logoUrl && <div className="flex h-24 items-center justify-center rounded-md border bg-muted/30 p-4"><img src={logoUrl} alt="Logo atual" className="max-h-full max-w-full object-contain" /></div>}
      <input ref={inputRef} type="file" accept="image/png" className="sr-only" onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.currentTarget.value = ""; }} />
      <Button onClick={() => inputRef.current?.click()} disabled={saving}>{saving ? "Enviando…" : logoUrl ? "Trocar logo" : "Enviar logo"}</Button>
    </section>
  );
}
