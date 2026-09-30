import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, QrCode, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

type ManagedInstance = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
};

function toQrSrc(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const value = String(raw).trim();
  if (value.startsWith("data:") || value.startsWith("http")) return value;
  return `data:image/png;base64,${value}`;
}

export function ManagedUazapiConnectionPanel() {
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
  const [channelCount, setChannelCount] = useState(0);
  const [channelLimit, setChannelLimit] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-instance", {
        body: { action: "get_config" },
      });
      if (error || !data?.ok || data.managed !== true) {
        throw new Error(data?.error || error?.message || "Não consegui carregar a conexão WhatsApp.");
      }
      setInstances((data.instances ?? []) as ManagedInstance[]);
      setChannelCount(Number(data.channel_count ?? 0));
      setChannelLimit(Number(data.channel_limit ?? 1));
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao carregar WhatsApp", description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const connect = async (instanceId?: string) => {
    const key = instanceId ?? "new";
    setBusyId(key);
    try {
      const { data, error } = await supabase.functions.invoke("manage-instance", {
        body: { action: "connect_managed", ...(instanceId ? { instance_id: instanceId } : {}) },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "Não consegui gerar o QR Code.");
      const nextInstance = data.instance as ManagedInstance;
      setInstances((current) => [
        ...current.filter((instance) => instance.id !== nextInstance.id),
        { ...nextInstance, status: data.connected ? "connected" : "connecting" },
      ]);
      if (data.qrcode) {
        const src = toQrSrc(data.qrcode);
        if (src) setQrCodes((current) => ({ ...current, [nextInstance.id]: src }));
      }
      if (data.connected) {
        setQrCodes((current) => {
          const next = { ...current };
          delete next[nextInstance.id];
          return next;
        });
        toast({ title: "WhatsApp já conectado" });
      }
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Falha na conexão", description: (error as Error).message });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    const pendingIds = instances.filter((instance) => qrCodes[instance.id] && instance.status !== "connected").map((instance) => instance.id);
    if (!pendingIds.length) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const results = await Promise.all(pendingIds.map(async (instanceId) => {
        const { data } = await supabase.functions.invoke("manage-instance", {
          body: { action: "status", instance_id: instanceId },
        });
        return data?.ok && data.connected ? { instanceId, phone: data.phone ?? null } : null;
      }));
      if (cancelled) return;
      const connected = results.filter((result): result is { instanceId: string; phone: string | null } => !!result);
      if (!connected.length) return;
      setInstances((current) => current.map((instance) => {
        const result = connected.find((item) => item.instanceId === instance.id);
        return result ? { ...instance, phone: result.phone ?? instance.phone, status: "connected" } : instance;
      }));
      setQrCodes((current) => {
        const next = { ...current };
        connected.forEach(({ instanceId }) => delete next[instanceId]);
        return next;
      });
      toast({ title: "WhatsApp conectado" });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [instances, qrCodes]);

  const canAdd = channelCount < channelLimit;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Conecte o número da empresa lendo o QR Code com o WhatsApp. A infraestrutura UazAPI é gerenciada pela DRYOS.
      </p>

      {loading ? <p className="rounded-md border p-4 text-sm text-muted-foreground">Carregando…</p> : <>
        {instances.map((instance, index) => {
          const qr = qrCodes[instance.id];
          const connected = instance.status === "connected";
          return (
            <div key={instance.id} className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{index === 0 ? "QR principal" : `QR adicional ${index}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {connected ? `Conectado${instance.phone ? ` · ${instance.phone}` : ""}` : "Aguardando conexão"}
                  </p>
                </div>
                {connected ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : null}
              </div>
              {qr && !connected && <img src={qr} alt={`QR Code ${index === 0 ? "principal" : `adicional ${index}`} do WhatsApp`} className="mx-auto h-52 w-52 rounded-md bg-white p-2" />}
              {!connected && (
                <Button variant="outline" className="w-full" onClick={() => void connect(instance.id)} disabled={busyId !== null}>
                  {busyId === instance.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : qr ? <RefreshCw className="mr-2 h-4 w-4" /> : <QrCode className="mr-2 h-4 w-4" />}
                  {busyId === instance.id ? "Preparando QR…" : qr ? "Gerar outro QR" : "Gerar QR Code"}
                </Button>
              )}
            </div>
          );
        })}

        {canAdd ? (
          <Button className="w-full" onClick={() => void connect()} disabled={busyId !== null}>
            {busyId === "new" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
            {busyId === "new" ? "Preparando QR…" : instances.length === 0 ? "Conectar WhatsApp da empresa" : "Adicionar QR contratado"}
          </Button>
        ) : (
          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {channelLimit === 1
              ? "A empresa tem 1 QR Code incluído. QR adicional precisa ser contratado com a DRYOS por R$29 cada."
              : "Todos os QR Codes contratados estão em uso. Para adicionar outro, fale com a DRYOS por R$29 cada."}
          </p>
        )}
      </>}
    </div>
  );
}
