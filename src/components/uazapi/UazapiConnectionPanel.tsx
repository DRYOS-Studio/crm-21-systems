import { useEffect, useState } from "react";
import { ExternalLink, TestTube2, Webhook, Copy, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { translateError } from "@/lib/translateError";

function toQrSrc(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const v = String(raw).trim();
  if (v.startsWith("data:") || v.startsWith("http")) return v;
  return `data:image/png;base64,${v}`;
}

function CheckRow({ ok, warn, label }: { ok?: boolean; warn?: boolean; label: string }) {
  const Icon = warn ? AlertTriangle : ok ? CheckCircle2 : XCircle;
  const color = warn ? "text-amber-500" : ok ? "text-emerald-500" : "text-destructive";
  return (
    <div className="flex items-start gap-2">
      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function sameHost(a: string, b: string) {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return a.replace(/\/$/, "") === b.replace(/\/$/, "");
  }
}

export function UazapiConnectionPanel() {
  const { user } = useAuth();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState("");
  const [instancePhone, setInstancePhone] = useState("");
  const [instanceConnected, setInstanceConnected] = useState<boolean | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [savedServerUrl, setSavedServerUrl] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [hasAdminToken, setHasAdminToken] = useState(false);
  const [instanceToken, setInstanceToken] = useState("");
  const [hasInstanceToken, setHasInstanceToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectStep, setConnectStep] = useState("");
  const [testing, setTesting] = useState(false);
  const [testingHook, setTestingHook] = useState(false);
  const [webhookOk, setWebhookOk] = useState<boolean | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookConfirmed, setWebhookConfirmed] = useState(false);
  const [hookReport, setHookReport] = useState<Record<string, { ok?: boolean; error?: string; instance_name?: string }> | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [paircode, setPaircode] = useState<string | null>(null);
  const [fetchingQr, setFetchingQr] = useState(false);

  const refreshWebhook = async (id: string | null) => {
    if (!id) {
      setWebhookUrl("");
      setWebhookConfirmed(false);
      return;
    }
    const [{ data: urlData }, { data: confirmedData }] = await Promise.all([
      supabase.functions.invoke("manage-instance", { body: { action: "webhook_url", instance_id: id } }),
      supabase.functions.invoke("manage-instance", { body: { action: "webhook_confirmed", instance_id: id } }),
    ]);
    setWebhookUrl(urlData?.url || "");
    setWebhookConfirmed(confirmedData?.confirmed === true);
  };

  const load = async () => {
    const { data: settings } = await supabase
      .from("app_settings")
      .select("key,value")
      .in("key", ["uazapi_server_url", "uazapi_admin_token"]);
    let url = "";
    for (const row of settings || []) {
      if (row.key === "uazapi_server_url") url = row.value || "";
      if (row.key === "uazapi_admin_token" && row.value) setHasAdminToken(true);
    }
    if (!user) {
      if (url) {
        setServerUrl(url);
        setSavedServerUrl(url);
      }
      return;
    }
    const { data: config } = await supabase.functions.invoke("manage-instance", { body: { action: "get_config" } });
    const data = config?.instance;
    if (data) {
      setInstanceId(data.id);
      setInstanceName(data.name || "");
      setInstancePhone(data.phone || "");
      setInstanceConnected(data.status === "connected");
      setHasInstanceToken(!!data.has_instance_token);
      await refreshWebhook(data.id);
      url = data.server_url || url;
    }
    if (url) {
      setServerUrl(url);
      setSavedServerUrl(url);
    }
  };

  useEffect(() => {
    void load();
  }, [user?.id]);

  useEffect(() => {
    if (instanceConnected !== false || (!qrSrc && !paircode)) return;
    let cancelled = false;
    const tick = async () => {
      if (!instanceId || cancelled) return;
      const { data } = await supabase.functions.invoke("manage-instance", {
        body: { action: "status", instance_id: instanceId },
      });
      if (cancelled || !data?.ok || !data.connected) return;
      setInstanceConnected(true);
      setQrSrc(null);
      setPaircode(null);
      if (data.phone) setInstancePhone(data.phone);
      if (data.name) setInstanceName(data.name);
      toast({ title: "WhatsApp conectado" });
    };
    const id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [instanceConnected, qrSrc, paircode, instanceId]);

  const fetchQr = async (targetId = instanceId) => {
    if (!targetId) {
      toast({ variant: "destructive", title: "Salve a instância primeiro" });
      return;
    }
    setFetchingQr(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-instance", {
        body: { action: "connect", instance_id: targetId },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || "Não consegui gerar o QR.");
      }
      if (data.already_connected) {
        setInstanceConnected(true);
        setQrSrc(null);
        setPaircode(null);
        toast({ title: "WhatsApp já está conectado" });
        return;
      }
      setQrSrc(toQrSrc(data.qrcode));
      setPaircode(data.paircode || null);
      if (!data.qrcode && !data.paircode) {
        toast({
          variant: "destructive",
          title: "QR não veio",
          description: "A Uazapi não devolveu o código. Tente de novo em alguns segundos.",
        });
      }
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Falha ao gerar QR",
        description: translateError(e),
      });
    } finally {
      setFetchingQr(false);
    }
  };

  const test = async () => {
    const url = serverUrl.trim().replace(/\/$/, "");
    if (!url) {
      toast({ variant: "destructive", title: "Informe o Server URL" });
      return;
    }
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("test-uazapi", {
      body: {
        serverUrl: url,
        adminToken: adminToken.trim() || undefined,
        instanceToken: instanceToken.trim() || undefined,
      },
    });
    setTesting(false);
    if (error || !data?.ok) {
      toast({ variant: "destructive", title: "Falha", description: data?.message || error?.message });
    } else {
      toast({ title: "Conexão OK!", description: data.message });
    }
  };

  const connect = async () => {
    if (!user) return;
    const url = serverUrl.trim().replace(/\/$/, "");
    if (!url) {
      toast({ variant: "destructive", title: "Informe o Server URL" });
      return;
    }
    const urlChanged = !!savedServerUrl && !sameHost(url, savedServerUrl);
    const token = instanceToken.trim();
    if (!token && (urlChanged || !hasInstanceToken)) {
      toast({
        variant: "destructive",
        title: urlChanged ? "Cole o Instance Token do servidor novo" : "Informe o Instance Token",
        description: urlChanged
          ? "URL nova precisa do token da instância criada nesse servidor."
          : "Cole o token ou salve uma instância primeiro.",
      });
      return;
    }

    setConnecting(true);
    setWebhookOk(null);
    setHookReport(null);
    try {
      setConnectStep("Salvando credenciais...");
      const { data: saved, error: saveError } = await supabase.functions.invoke("manage-instance", {
        body: {
          action: "save_config", instance_id: instanceId || undefined,
          server_url: url, instance_token: token || undefined, admin_token: adminToken.trim() || undefined,
        },
      });
      if (saveError || !saved?.ok) throw new Error(saved?.error || saveError?.message || "Falha ao salvar credenciais");
      const id = saved.instance_id as string;
      setInstanceId(id);
      setSavedServerUrl(url);
      if (adminToken.trim()) {
        setHasAdminToken(true);
        setAdminToken("");
      }

      setConnectStep("Identificando a instância...");
      const { data: st, error: stErr } = await supabase.functions.invoke("manage-instance", {
        body: { action: "status", instance_id: id },
      });
      if (stErr || !st?.ok) {
        setInstanceConnected(false);
        throw new Error(
          st?.error ||
            stErr?.message ||
            "Não consegui falar com a Uazapi. Confira o Server URL e o Instance Token.",
        );
      }

      if (st.name) setInstanceName(st.name);
      if (st.phone) setInstancePhone(st.phone);
      setInstanceConnected(!!st.connected);
      setHasInstanceToken(true);

      setConnectStep("Registrando o webhook...");
      const { data: wh, error: whErr } = await supabase.functions.invoke("manage-instance", {
        body: { action: "set_webhook", instance_id: id },
      });
      const hookRegistered = !whErr && !!wh?.ok;
      setWebhookOk(hookRegistered);
      await refreshWebhook(id);

      setConnectStep("Testando ponta a ponta...");
      await runWebhookDiagnostic(st.name || instanceName, id);
      setInstanceToken("");

      if (!hookRegistered) {
        toast({
          variant: "destructive",
          title: "Conectado, mas o webhook falhou",
          description: wh?.error || whErr?.message || "Use 'Reenviar webhook' abaixo.",
        });
      } else if (!st.connected) {
        setConnectStep("Gerando QR Code...");
        await fetchQr(id);
        toast({
          title: "Configurado!",
          description: "Leia o QR abaixo com o WhatsApp do número de atendimento.",
        });
      } else {
        setQrSrc(null);
        setPaircode(null);
        toast({
          title: "Tudo pronto!",
          description: `${st.name || "Instância"} conectada${st.phone ? ` — ${st.phone}` : ""}.`,
        });
      }
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Falha ao conectar",
        description: translateError(e),
      });
    } finally {
      setConnecting(false);
      setConnectStep("");
    }
  };

  const runWebhookDiagnostic = async (name: string, id = instanceId) => {
    const { data: link } = id ? await supabase.functions.invoke("manage-instance", {
      body: { action: "webhook_url", instance_id: id },
    }) : { data: null };
    const url = webhookUrl || link?.url;
    if (!url) {
      toast({ variant: "destructive", title: "Webhook sem secret — conecte a instância" });
      return;
    }
    setWebhookUrl(url);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "dry_run", instance: { name } }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ variant: "destructive", title: "Webhook inacessível", description: `HTTP ${res.status}` });
      return;
    }
    setHookReport(json.checks || { error: json.error || "Sem detalhes" });
  };

  const copyWebhook = async () => {
    const { data } = instanceId ? await supabase.functions.invoke("manage-instance", {
      body: { action: "webhook_url", instance_id: instanceId },
    }) : { data: null };
    const url = webhookUrl || data?.url;
    if (!url) {
      toast({ variant: "destructive", title: "Conecte a instância para gerar a URL" });
      return;
    }
    setWebhookUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "URL copiada!" });
    } catch {
      toast({ variant: "destructive", title: "Não foi possível copiar" });
    }
  };

  const testWebhook = async () => {
    setTestingHook(true);
    setHookReport(null);
    try {
      await runWebhookDiagnostic(instanceName);
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Falha no webhook", description: translateError(e) });
    } finally {
      setTestingHook(false);
    }
  };

  const reconfigureWebhook = async () => {
    setTestingHook(true);
    try {
      if (!instanceId) {
        toast({ variant: "destructive", title: "Configure a instância primeiro" });
        return;
      }
      const { data, error } = await supabase.functions.invoke("manage-instance", {
        body: { action: "set_webhook", instance_id: instanceId, rotate: true },
      });
      const ok = !error && !!data?.ok;
      setWebhookOk(ok);
      if (ok) {
        toast({ title: "Webhook registrado na Uazapi" });
        await refreshWebhook(instanceId);
        await runWebhookDiagnostic(instanceName);
      } else {
        toast({
          variant: "destructive",
          title: "Falha ao registrar",
          description: data?.error || error?.message || "Erro",
        });
      }
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Falha", description: translateError(e) });
    } finally {
      setTestingHook(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Server URL</Label>
        <Input
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://versalhes.uazapi.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          Admin Token {hasAdminToken && <span className="text-xs text-muted-foreground">(já configurado)</span>}
        </Label>
        <Input
          type="password"
          value={adminToken}
          onChange={(e) => setAdminToken(e.target.value)}
          placeholder={hasAdminToken ? "•••••••• (vazio mantém o salvo)" : "admin token do painel"}
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          Instance Token{" "}
          {hasInstanceToken && <span className="text-xs text-muted-foreground">(já configurado)</span>}
        </Label>
        <Input
          type="password"
          value={instanceToken}
          onChange={(e) => setInstanceToken(e.target.value)}
          placeholder={
            hasInstanceToken ? "•••••••• (vazio mantém, se a URL não mudou)" : "token da instância"
          }
        />
        <a
          href="https://docs.uazapi.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Onde encontrar <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void connect()} disabled={connecting} size="sm">
          {connecting ? connectStep || "Conectando..." : "Salvar e conectar"}
        </Button>
        <Button variant="outline" onClick={() => void test()} disabled={testing || !serverUrl.trim()} size="sm">
          <TestTube2 className="w-4 h-4 mr-2" />
          {testing ? "Testando..." : "Testar servidor"}
        </Button>
      </div>

      {instanceConnected !== null && !connecting && (
        <div className="rounded-md border border-border bg-background p-3 text-xs space-y-1.5">
          <CheckRow ok label={`Instância: ${instanceName || "—"}`} />
          <CheckRow
            ok={instanceConnected}
            warn={!instanceConnected}
            label={
              instanceConnected
                ? `WhatsApp conectado${instancePhone ? ` — ${instancePhone}` : ""}`
                : "WhatsApp desconectado — leia o QR abaixo"
            }
          />
          {webhookOk !== null && (
            <CheckRow
              ok={webhookOk}
              label={webhookOk ? "Webhook registrado automaticamente" : "Webhook não registrado"}
            />
          )}
        </div>
      )}

      {!instanceConnected && (hasInstanceToken || instanceToken.trim()) && (
        <div className="rounded-md border border-border bg-background p-3 space-y-3">
          {qrSrc ? (
            <img
              src={qrSrc}
              alt="QR Code do WhatsApp"
              className="mx-auto w-52 h-52 rounded-md bg-white p-2"
            />
          ) : (
            <p className="text-xs text-muted-foreground text-center">
              Gere o QR e escaneie no WhatsApp → Aparelhos conectados.
            </p>
          )}
          {paircode && (
            <p className="text-xs text-center font-mono">
              Código: <span className="font-semibold">{paircode}</span>
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void fetchQr()}
            disabled={fetchingQr || connecting}
          >
            {fetchingQr ? "Gerando QR..." : qrSrc ? "Gerar outro QR" : "Gerar QR Code"}
          </Button>
        </div>
      )}

      {webhookUrl && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Webhook desta instância</span>
            {webhookConfirmed ? (
              <Badge variant="ok">confirmado</Badge>
            ) : (
              <Badge variant="warning">aguardando 1ª mensagem</Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Input id="webhook-url" readOnly value={webhookUrl} className="text-xs font-mono" />
            <Button id="webhook-copy" variant="outline" size="sm" onClick={() => void copyWebhook()}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void testWebhook()}
              disabled={testingHook}
              className="flex-1"
            >
              <TestTube2 className="w-4 h-4 mr-2" />
              {testingHook ? "..." : "Testar webhook"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void reconfigureWebhook()}
              disabled={testingHook}
              className="flex-1"
            >
              <Webhook className="w-4 h-4 mr-2" />
              Reenviar webhook
            </Button>
          </div>
          {hookReport && (
            <div className="text-xs space-y-1.5">
              <CheckRow
                ok={!!hookReport.instance?.ok}
                label={
                  hookReport.instance?.ok
                    ? `Instância ok — ${hookReport.instance.instance_name}`
                    : `Instância: ${hookReport.instance?.error || "não encontrada"}`
                }
              />
              <CheckRow
                ok={!!hookReport.agent?.ok}
                label={hookReport.agent?.ok ? "Agente ativo" : `Agente: ${hookReport.agent?.error || "não"}`}
              />
              <CheckRow
                ok={!!hookReport.groq?.ok}
                label={hookReport.groq?.ok ? "Groq respondendo" : `Groq: ${hookReport.groq?.error || "falha"}`}
              />
              <CheckRow
                ok={!!hookReport.uazapi?.ok}
                label={hookReport.uazapi?.ok ? "Uazapi acessível" : `Uazapi: ${hookReport.uazapi?.error || "falha"}`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
