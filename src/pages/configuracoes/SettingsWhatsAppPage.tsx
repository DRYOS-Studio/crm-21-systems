import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ManagedUazapiConnectionPanel } from "@/components/uazapi/ManagedUazapiConnectionPanel";
import { UazapiConnectionPanel } from "@/components/uazapi/UazapiConnectionPanel";
import { supabase } from "@/integrations/supabase/client";

export default function SettingsWhatsAppPage() {
  const [managed, setManaged] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.functions.invoke("manage-instance", { body: { action: "get_config" } }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data?.ok || typeof data.managed !== "boolean") {
        setLoadError(data?.error || error?.message || "Não consegui carregar as configurações de WhatsApp.");
        return;
      }
      setManaged(data.managed);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">{managed === false ? "Configuração da UazAPI" : "Conexão WhatsApp"}</CardTitle>
      </CardHeader>
      <CardContent>
        {managed === null ? <p className="text-sm text-muted-foreground">{loadError || "Carregando…"}</p>
          : managed ? <ManagedUazapiConnectionPanel /> : <UazapiConnectionPanel />}
      </CardContent>
    </Card>
  );
}
