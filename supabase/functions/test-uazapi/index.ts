import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function tokensSalvos(): Promise<{ adminToken: string | null; instanceToken: string | null }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return { adminToken: null, instanceToken: null };
  const admin = createClient(supabaseUrl, serviceKey);
  const { data } = await admin
    .from("app_settings")
    .select("key,value")
    .in("key", ["uazapi_admin_token", "uazapi_instance_token"]);
  let adminToken: string | null = null;
  let instanceToken: string | null = null;
  for (const row of data ?? []) {
    if (row.key === "uazapi_admin_token" && row.value) adminToken = String(row.value);
    if (row.key === "uazapi_instance_token" && row.value) instanceToken = String(row.value);
  }
  if (!instanceToken) {
    const { data: inst } = await admin
      .from("whatsapp_instances")
      .select("instance_token")
      .not("instance_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    instanceToken = inst?.instance_token ?? null;
  }
  return { adminToken, instanceToken };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const serverUrl = String(body.serverUrl || "").trim();
    if (!serverUrl) {
      return json({ ok: false, message: "URL do servidor é obrigatória." });
    }

    const saved = await tokensSalvos();
    const instanceToken = String(body.instanceToken || "").trim() || saved.instanceToken;
    const adminToken = String(body.adminToken || "").trim() || saved.adminToken;
    const base = serverUrl.replace(/\/$/, "");

    if (instanceToken) {
      try {
        const res = await fetch(`${base}/instance/status`, {
          headers: { token: instanceToken },
        });
        console.log(`[test-uazapi] instance status=${res.status}`);
        if (res.ok) {
          return json({ ok: true, message: "Instance Token válido! Instância respondendo corretamente." });
        }
        if (res.status === 401 && !adminToken) {
          return json({
            ok: false,
            message: "Instance Token inválido (401). Copie novamente do painel Uazapi.",
          });
        }
      } catch (e: unknown) {
        return json({
          ok: false,
          message: `Não foi possível conectar: ${e instanceof Error ? e.message : "erro de rede"}`,
        });
      }
    }

    if (adminToken) {
      const url = `${base}/instance/all`;
      const attempts = [{ AdminToken: adminToken }, { admintoken: adminToken }];
      let lastStatus = 0;
      let lastBody = "";

      for (const headers of attempts) {
        try {
          const res = await fetch(url, { headers });
          lastStatus = res.status;
          lastBody = await res.text();
          console.log(`[test-uazapi] admin header=${Object.keys(headers)[0]} status=${res.status}`);
          if (res.ok) {
            return json({ ok: true, message: "Admin Token válido! Uazapi respondeu corretamente." });
          }
          if (res.status === 401 && /public demo server|endpoint has been disabled/i.test(lastBody)) {
            return json({
              ok: true,
              demo: true,
              message:
                "Servidor demo detectado (free.uazapi.com). O endpoint de validação é bloqueado, mas você pode criar instâncias e conectar o WhatsApp normalmente. Para produção, use um servidor Uazapi próprio.",
            });
          }
        } catch (e: unknown) {
          console.error("[test-uazapi] fetch error", e instanceof Error ? e.message : e);
          return json({
            ok: false,
            message: `Não foi possível conectar: ${e instanceof Error ? e.message : "erro de rede"}`,
          });
        }
      }

      let msg = `Uazapi retornou ${lastStatus}. Verifique URL e token.`;
      if (lastStatus === 401) msg = "Admin Token inválido (401). Copie novamente o AdminToken do painel Uazapi.";
      if (lastStatus === 404) msg = "Endpoint não encontrado (404). Confirme a URL do servidor Uazapi.";
      return json({ ok: false, message: msg, details: lastBody.slice(0, 300) });
    }

    return json({
      ok: false,
      message: "Informe pelo menos o Instance Token ou o Admin Token para testar.",
    });
  } catch (error: unknown) {
    return json({ ok: false, message: error instanceof Error ? error.message : "Erro desconhecido" });
  }
});
