import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { memberContext } from "../_shared/member-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: corsHeaders });
}

function hex(bytes: Uint8Array | ArrayBuffer) {
  const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(token: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

function asaasBaseUrl() {
  return Deno.env.get("ASAAS_ENVIRONMENT") === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";
}

async function asaasRequest(path: string, method = "GET", body?: Record<string, unknown>) {
  const key = Deno.env.get("ASAAS_API_KEY");
  if (!key) throw new Error("ASAAS_API_KEY is not configured");
  const response = await fetch(`${asaasBaseUrl()}${path}`, {
    method,
    headers: { access_token: key, accept: "application/json", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Asaas returned ${response.status}`);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Método não permitido" });

  const member = await memberContext(req);
  if (!member) return json(401, { ok: false, error: "Não autenticado ou membro inativo" });
  const admin = member.admin;
  if (!member.isAdmin) {
    return json(403, { ok: false, error: "Acesso restrito ao admin" });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "JSON inválido" });
  }

  if (body.action === "list") {
    const { data, error } = await admin.from("q7_installations").select(
      "id, company_name, slug, subdomain, supabase_project_ref, vercel_project_ref, release_tag, database_version, functions_version, frontend_version, asaas_customer_id, asaas_subscription_id, billing_status, billing_due_date, grace_ends_at, payment_url, last_paid_at, created_at, updated_at",
    ).order("created_at", { ascending: false });
    if (error) return json(500, { ok: false, error: "Não foi possível listar instalações" });
    return json(200, { ok: true, installations: data ?? [] });
  }

  if (body.action === "register") {
    const companyName = typeof body.company_name === "string" ? body.company_name.trim() : "";
    const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    if (!companyName || companyName.length > 160 || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(slug)) {
      return json(400, { ok: false, error: "Empresa ou slug inválido" });
    }
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const { data, error } = await admin.from("q7_installations").insert({
      company_name: companyName,
      slug,
      sync_token_hash: await tokenHash(token),
    }).select("id, company_name, slug, billing_status, created_at").single();
    if (error) return json(error.code === "23505" ? 409 : 500, { ok: false, error: error.code === "23505" ? "Slug já cadastrado" : "Não foi possível registrar a instalação" });
    return json(201, { ok: true, installation: data, sync_token: token });
  }

  if (body.action === "rotate_sync_token") {
    if (typeof body.id !== "string") return json(400, { ok: false, error: "ID da instalação obrigatório" });
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const { data, error } = await admin.from("q7_installations").update({ sync_token_hash: await tokenHash(token), updated_at: new Date().toISOString() })
      .eq("id", body.id).select("id, company_name, slug").maybeSingle();
    if (error) return json(500, { ok: false, error: "Não foi possível rotacionar o token" });
    if (!data) return json(404, { ok: false, error: "Instalação não encontrada" });
    return json(200, { ok: true, installation: data, sync_token: token });
  }

  if (body.action === "update_inventory") {
    if (typeof body.id !== "string") return json(400, { ok: false, error: "ID da instalação obrigatório" });
    const columns = ["subdomain", "supabase_project_ref", "vercel_project_ref", "release_tag", "database_version", "functions_version", "frontend_version"] as const;
    const patch: Record<string, string | null> = {};
    for (const column of columns) {
      if (column in body) {
        if (body[column] !== null && (typeof body[column] !== "string" || body[column].length > 200)) {
          return json(400, { ok: false, error: `Campo ${column} inválido` });
        }
        patch[column] = body[column];
      }
    }
    if (!Object.keys(patch).length) return json(400, { ok: false, error: "Nenhum campo de inventário enviado" });
    patch.updated_at = new Date().toISOString();
    const { data, error } = await admin.from("q7_installations").update(patch).eq("id", body.id)
      .select("id, company_name, slug, subdomain, supabase_project_ref, vercel_project_ref, release_tag, database_version, functions_version, frontend_version")
      .maybeSingle();
    if (error) return json(500, { ok: false, error: "Não foi possível atualizar o inventário" });
    if (!data) return json(404, { ok: false, error: "Instalação não encontrada" });
    return json(200, { ok: true, installation: data });
  }

  if (body.action === "configure_asaas_webhook") {
    const token = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
    const email = typeof body.email === "string" ? body.email.trim() : user.email ?? "";
    if (token.length < 32 || !supabaseUrl || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(503, { ok: false, error: "Configure ASAAS_WEBHOOK_TOKEN e um e-mail válido" });
    }
    const webhookUrl = `${supabaseUrl}/functions/v1/asaas-webhook`;
    try {
      const existing = await asaasRequest("/webhooks?limit=100&offset=0");
      const duplicate = (existing.data ?? []).find((row: any) => row.url === webhookUrl);
      if (duplicate) return json(409, { ok: false, error: "Este endpoint já existe no Asaas; confirme o token configurado", webhook_id: duplicate.id });

      const webhook = await asaasRequest("/webhooks", "POST", {
        name: "Q7 Pipeline - cobrança",
        url: webhookUrl,
        email,
        enabled: true,
        interrupted: false,
        apiVersion: 3,
        authToken: token,
        sendType: "SEQUENTIALLY",
        events: ["PAYMENT_OVERDUE", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_REFUNDED", "PAYMENT_RECEIVED_IN_CASH_UNDONE"],
      });
      if (typeof webhook.id !== "string") throw new Error("Asaas did not return a webhook ID");
      const { error: saveError } = await admin.from("app_settings").upsert({ key: "q7_asaas_webhook_id", value: webhook.id }, { onConflict: "key" });
      if (saveError) throw new Error("Could not save webhook ID");
      return json(201, { ok: true, webhook_id: webhook.id });
    } catch (error) {
      console.error("[manage-installation] Asaas webhook setup failed", error instanceof Error ? error.message : error);
      return json(502, { ok: false, error: "Não foi possível configurar o webhook no Asaas" });
    }
  }

  if (body.action === "create_subscription") {
    const id = typeof body.id === "string" ? body.id : "";
    const payer = body.payer ?? {};
    const nextDueDate = typeof body.next_due_date === "string" ? body.next_due_date : "";
    const billingType = body.billing_type;
    if (!id || !/^(BOLETO|PIX|CREDIT_CARD)$/.test(billingType ?? "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(nextDueDate) ||
      typeof payer.name !== "string" || !payer.name.trim() ||
      typeof payer.cpfCnpj !== "string" || !/^(?:\d{11}|\d{14})$/.test(payer.cpfCnpj.replace(/\D/g, "")) ||
      typeof payer.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payer.email)) {
      return json(400, { ok: false, error: "Dados de cobrança inválidos" });
    }
    const { data: installation } = await admin.from("q7_installations")
      .select("id, company_name, asaas_customer_id, asaas_subscription_id")
      .eq("id", id).maybeSingle();
    if (!installation) return json(404, { ok: false, error: "Instalação não encontrada" });
    if (installation.asaas_subscription_id) return json(409, { ok: false, error: "A instalação já possui assinatura" });
    const { data: claimed, error: claimError } = await admin.rpc("q7_claim_asaas_setup", { _installation_id: id });
    if (claimError) return json(500, { ok: false, error: "Não foi possível reservar a criação da assinatura" });
    if (!claimed) return json(409, { ok: false, error: "Criação de assinatura já está em andamento" });

    try {
      const externalReference = `q7-${id}`;
      let customerId = installation.asaas_customer_id;
      if (!customerId) {
        const matches = await asaasRequest(`/customers?limit=100&offset=0&externalReference=${encodeURIComponent(externalReference)}`);
        if ((matches.data?.length ?? 0) > 1) throw new Error("Multiple Asaas customers match this installation");
        customerId = matches.data?.[0]?.id;
        if (!customerId) {
          const customer = await asaasRequest("/customers", "POST", {
            name: payer.name.trim(),
            cpfCnpj: payer.cpfCnpj.replace(/\D/g, ""),
            email: payer.email.trim(),
            mobilePhone: typeof payer.mobilePhone === "string" ? payer.mobilePhone.replace(/\D/g, "") : undefined,
            externalReference,
          });
          customerId = customer.id;
        }
        if (typeof customerId !== "string") throw new Error("Asaas did not return a customer ID");
        await admin.from("q7_installations").update({ asaas_customer_id: customerId, updated_at: new Date().toISOString() }).eq("id", id);
      }

      const query = new URLSearchParams({ limit: "100", offset: "0", externalReference });
      const existing = await asaasRequest(`/subscriptions?${query}`);
      const activeSubscriptions = (existing.data ?? []).filter((row: any) => row.status === "ACTIVE");
      if (activeSubscriptions.length > 1) throw new Error("Multiple Asaas subscriptions match this installation");
      const subscription = activeSubscriptions[0] ?? await asaasRequest("/subscriptions", "POST", {
        customer: customerId,
        billingType,
        value: 397,
        nextDueDate,
        cycle: "MONTHLY",
        description: "Q7 Pipeline - assinatura mensal",
        externalReference,
      });
      if (typeof subscription.id !== "string") throw new Error("Asaas did not return a subscription ID");

      const charges = await asaasRequest(`/subscriptions/${encodeURIComponent(subscription.id)}/payments?limit=100&offset=0`);
      const latestPayment = (charges.data ?? []).sort((a: any, b: any) => String(b.dueDate).localeCompare(String(a.dueDate)))[0];
      const { error: saveError } = await admin.from("q7_installations").update({
        asaas_customer_id: customerId,
        asaas_subscription_id: subscription.id,
        billing_due_date: nextDueDate,
        payment_url: latestPayment?.invoiceUrl ?? latestPayment?.bankSlipUrl ?? null,
        billing_status: "active",
        grace_ends_at: null,
        asaas_setup_lock_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (saveError) throw new Error("Could not save Asaas subscription");
      return json(200, { ok: true, subscription_id: subscription.id, payment_url: latestPayment?.invoiceUrl ?? latestPayment?.bankSlipUrl ?? null });
    } catch (error) {
      await admin.from("q7_installations").update({ asaas_setup_lock_at: null }).eq("id", id);
      console.error("[manage-installation] subscription setup failed", error instanceof Error ? error.message : error);
      return json(502, { ok: false, error: "Não foi possível criar a assinatura no Asaas" });
    }
  }

  return json(400, { ok: false, error: "Ação inválida" });
});
