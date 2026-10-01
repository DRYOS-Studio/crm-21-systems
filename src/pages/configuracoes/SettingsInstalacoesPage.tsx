import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Installation = {
  id: string;
  company_name: string;
  slug: string;
  subdomain: string | null;
  supabase_project_ref: string | null;
  vercel_project_ref: string | null;
  release_tag: string | null;
  database_version: string | null;
  functions_version: string | null;
  frontend_version: string | null;
  whatsapp_managed_mode: boolean;
  whatsapp_extra_qr_count: number;
  whatsapp_secrets_configured: boolean;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  billing_status: string;
  billing_due_date: string | null;
  grace_ends_at: string | null;
  payment_url: string | null;
  last_paid_at: string | null;
};

type Payer = { name: string; cpfCnpj: string; email: string; mobilePhone: string };
const EMPTY_PAYER: Payer = { name: "", cpfCnpj: "", email: "", mobilePhone: "" };

export default function SettingsInstalacoesPage() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [tokenOnce, setTokenOnce] = useState<{ id: string; value: string } | null>(null);
  const [payers, setPayers] = useState<Record<string, Payer>>({});
  const [dueDates, setDueDates] = useState<Record<string, string>>({});
  const [billingTypes, setBillingTypes] = useState<Record<string, string>>({});
  const [inventory, setInventory] = useState<Record<string, Record<string, string>>>({});

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("manage-installation", { body });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || "A operação falhou");
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await call({ action: "list" });
      const rows = (data.installations ?? []) as Installation[];
      setInstallations(rows);
      setInventory(Object.fromEntries(rows.map((row) => [row.id, {
        subdomain: row.subdomain ?? "",
        supabase_project_ref: row.supabase_project_ref ?? "",
        vercel_project_ref: row.vercel_project_ref ?? "",
        release_tag: row.release_tag ?? "",
        database_version: row.database_version ?? "",
        functions_version: row.functions_version ?? "",
        frontend_version: row.frontend_version ?? "",
        whatsapp_extra_qr_count: String(row.whatsapp_extra_qr_count ?? 0),
        whatsapp_secrets_configured: String(row.whatsapp_secrets_configured),
      }])));
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao carregar instalações", description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  const register = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await call({ action: "register", company_name: companyName, slug });
      setTokenOnce({ id: data.installation.id, value: data.sync_token });
      setCompanyName("");
      setSlug("");
      await load();
      toast({ title: "Instalação registrada", description: "Guarde o token exibido; ele não pode ser consultado novamente." });
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao registrar instalação", description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const configureWebhook = async () => {
    setSaving(true);
    try {
      const data = await call({ action: "configure_asaas_webhook", email: email || undefined });
      toast({ title: "Webhook Asaas configurado", description: `ID ${data.webhook_id}` });
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao configurar webhook", description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const createSubscription = async (installation: Installation) => {
    const payer = payers[installation.id] ?? EMPTY_PAYER;
    setSaving(true);
    try {
      const data = await call({
        action: "create_subscription",
        id: installation.id,
        payer,
        next_due_date: dueDates[installation.id],
        billing_type: billingTypes[installation.id] ?? "PIX",
      });
      toast({ title: "Assinatura mensal criada", description: data.payment_url ? "Cobrança inicial disponível abaixo." : "O Asaas enviará a cobrança ao cliente." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao criar assinatura", description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const updateInventory = async (installation: Installation) => {
    setSaving(true);
    try {
      const fields = inventory[installation.id] ?? {};
      const { whatsapp_extra_qr_count, whatsapp_secrets_configured, ...textFields } = fields;
      const data = Object.fromEntries(Object.entries(textFields).map(([key, value]) => [key, value.trim() || null]));
      await call({
        action: "update_inventory",
        id: installation.id,
        ...data,
        whatsapp_extra_qr_count: Number(whatsapp_extra_qr_count || "0"),
        whatsapp_secrets_configured: whatsapp_secrets_configured === "true",
      });
      toast({ title: "Inventário atualizado" });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao atualizar inventário", description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const rotateToken = async (installation: Installation) => {
    setSaving(true);
    try {
      const data = await call({ action: "rotate_sync_token", id: installation.id });
      setTokenOnce({ id: installation.id, value: data.sync_token });
      toast({ title: "Token renovado", description: "Atualize o secret no Supabase desta instalação." });
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao renovar token", description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const setInventoryField = (id: string, key: string, value: string) => {
    setInventory((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  };

  return (
    <section className="max-w-4xl space-y-8">
      <div>
        <h2 className="font-semibold">Instalações por empresa</h2>
        <p className="mt-1 text-sm text-muted-foreground">Controle projetos, releases e cobranças das instalações isoladas.</p>
      </div>

      <form onSubmit={register} className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-2"><Label htmlFor="installation-company">Empresa</Label><Input id="installation-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={160} required /></div>
        <div className="space-y-2"><Label htmlFor="installation-slug">Slug</Label><Input id="installation-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={48} pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?" required /></div>
        <Button type="submit" disabled={saving}>{saving ? "Salvando…" : "Registrar empresa"}</Button>
      </form>

      {tokenOnce && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-4">
          <p className="text-sm font-medium">Token de sincronização de {installations.find((row) => row.id === tokenOnce.id)?.company_name ?? "instalação"}</p>
          <p className="mt-1 break-all font-mono text-xs">{tokenOnce.value}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(tokenOnce.value)}>
            <Copy className="mr-2 h-4 w-4" /> Copiar token
          </Button>
          <Button className="ml-2 mt-3" size="sm" variant="ghost" onClick={() => setTokenOnce(null)}>Fechar</Button>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2"><Label htmlFor="asaas-email">E-mail para alertas do webhook Asaas</Label><Input id="asaas-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="financeiro@dryos.com.br" /></div>
        <Button variant="outline" disabled={saving} onClick={() => void configureWebhook()}>Configurar webhook central</Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Carregando…</p> : installations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma empresa registrada.</p>
      ) : (
        <div className="space-y-5">
          {installations.map((installation) => {
            const inventoryFields = inventory[installation.id] ?? {};
            const payer = payers[installation.id] ?? EMPTY_PAYER;
            return (
              <article key={installation.id} className="space-y-5 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{installation.company_name} <span className="font-normal text-muted-foreground">({installation.slug})</span></h3>
                    <p className="mt-1 text-xs text-muted-foreground">Status: {installation.billing_status} · Subdomínio: {installation.subdomain ?? "pendente"}</p>
                    {installation.asaas_subscription_id && <p className="mt-1 text-xs text-muted-foreground">Assinatura Asaas: {installation.asaas_subscription_id}</p>}
                  </div>
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => void rotateToken(installation)}><RefreshCw className="mr-2 h-4 w-4" /> Renovar token</Button>
                </div>

                <details>
                  <summary className="cursor-pointer text-sm font-medium">Inventário e release</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {[["subdomain", "Subdomínio"], ["supabase_project_ref", "Projeto Supabase"], ["vercel_project_ref", "Projeto Vercel"], ["release_tag", "Release"], ["database_version", "Versão do banco"], ["functions_version", "Versão das funções"], ["frontend_version", "Versão do frontend"]].map(([key, label]) => (
                      <div key={key} className="space-y-1"><Label htmlFor={`${installation.id}-${key}`}>{label}</Label><Input id={`${installation.id}-${key}`} value={inventoryFields[key] ?? ""} onChange={(e) => setInventoryField(installation.id, key, e.target.value)} /></div>
                    ))}
                    <div className="space-y-1">
                      <Label htmlFor={`${installation.id}-whatsapp-mode`}>Modo WhatsApp</Label>
                      <Input id={`${installation.id}-whatsapp-mode`} value={installation.whatsapp_managed_mode ? "Gerenciado pela DRYOS" : "Não gerenciado"} disabled />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${installation.id}-whatsapp-included-qr`}>QR incluídos</Label>
                      <Input id={`${installation.id}-whatsapp-included-qr`} value={installation.whatsapp_managed_mode ? "1 por empresa" : "0"} disabled />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${installation.id}-whatsapp-extra-qr`}>QR extras contratados (R$29/unidade)</Label>
                      <Input id={`${installation.id}-whatsapp-extra-qr`} type="number" min={0} step={1} value={inventoryFields.whatsapp_extra_qr_count ?? "0"} onChange={(e) => setInventoryField(installation.id, "whatsapp_extra_qr_count", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${installation.id}-whatsapp-secrets`}>Secrets UazAPI</Label>
                      <select id={`${installation.id}-whatsapp-secrets`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={inventoryFields.whatsapp_secrets_configured ?? "false"} onChange={(e) => setInventoryField(installation.id, "whatsapp_secrets_configured", e.target.value)}>
                        <option value="false">Pendente</option>
                        <option value="true">Configurados</option>
                      </select>
                      <p className="text-xs text-muted-foreground">Registre o status, nunca os valores.</p>
                    </div>
                  </div>
                  <Button className="mt-3" size="sm" variant="outline" disabled={saving} onClick={() => void updateInventory(installation)}>Salvar inventário</Button>
                </details>

                {!installation.asaas_subscription_id && (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Criar assinatura de R$ 397/mês</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {([["name", "Nome do pagador"], ["cpfCnpj", "CPF ou CNPJ"], ["email", "E-mail do pagador"], ["mobilePhone", "Celular"]] as const).map(([key, label]) => (
                        <div key={key} className="space-y-1"><Label htmlFor={`${installation.id}-payer-${key}`}>{label}</Label><Input id={`${installation.id}-payer-${key}`} value={payer[key]} onChange={(e) => setPayers((current) => ({ ...current, [installation.id]: { ...payer, [key]: e.target.value } }))} required /></div>
                      ))}
                      <div className="space-y-1"><Label htmlFor={`${installation.id}-due-date`}>Vencimento inicial</Label><Input id={`${installation.id}-due-date`} type="date" value={dueDates[installation.id] ?? ""} onChange={(e) => setDueDates((current) => ({ ...current, [installation.id]: e.target.value }))} required /></div>
                      <div className="space-y-1"><Label htmlFor={`${installation.id}-billing-type`}>Forma de pagamento</Label><select id={`${installation.id}-billing-type`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={billingTypes[installation.id] ?? "PIX"} onChange={(e) => setBillingTypes((current) => ({ ...current, [installation.id]: e.target.value }))}><option value="PIX">Pix</option><option value="BOLETO">Boleto</option><option value="CREDIT_CARD">Cartão</option></select></div>
                    </div>
                    <Button className="mt-3" size="sm" disabled={saving} onClick={() => void createSubscription(installation)}>Criar assinatura</Button>
                  </details>
                )}

                {installation.payment_url && <a className="inline-flex items-center text-sm text-primary underline-offset-4 hover:underline" href={installation.payment_url} target="_blank" rel="noreferrer">Abrir cobrança <ExternalLink className="ml-1 h-3.5 w-3.5" /></a>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
