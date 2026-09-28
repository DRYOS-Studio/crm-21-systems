import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const DEFAULT_PROMPT =
  "Você é um assistente de atendimento simpático e objetivo. Quando receber [áudio], [imagem], [vídeo] ou [documento], diga que ainda não consegue ouvir ou ver o conteúdo e peça para o cliente resumir por texto.";

export function useAgentConfigSettings() {
  const { user } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [followupOn, setFollowupOn] = useState(false);
  const [followupMinutes, setFollowupMinutes] = useState<number>(60);
  const [followupMax, setFollowupMax] = useState<number>(1);
  const [companyName, setCompanyName] = useState("");
  const [businessContext, setBusinessContext] = useState("");
  const [ownerNotifyPhone, setOwnerNotifyPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");

  const loadAgent = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("agent_configs")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data) {
      setPrompt(data.system_prompt);
      setEnabled(data.enabled);
      setHasKey(!!data.groq_api_key);
      const m = (data as { followup_inactivity_minutes?: number | null }).followup_inactivity_minutes;
      setFollowupOn(!!m && m > 0);
      setFollowupMinutes(m && m > 0 ? m : 60);
      setFollowupMax((data as { followup_max_per_conversation?: number }).followup_max_per_conversation ?? 1);
      setCompanyName(data.company_name ?? "");
      setBusinessContext(data.business_context ?? "");
      setOwnerNotifyPhone(data.owner_notify_phone ?? "");
      setPhoneError("");
    }
    setLoaded(true);
  }, [user]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  const testConnection = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("test-ai-connection", {
      body: { apiKey: apiKey.trim() || undefined },
    });
    setTesting(false);
    if (error || !data?.ok) {
      toast({
        variant: "destructive",
        title: "Falha no teste",
        description: data?.error || error?.message || "Erro",
      });
      return false;
    }
    toast({ title: "Conexão OK!", description: `Resposta: ${data.data?.reply}` });
    return true;
  };

  const saveAgent = async (opts?: { testAfter?: boolean }) => {
    if (!user) return false;
    setSaving(true);
    setPhoneError("");
    try {
      const typedPhone = ownerNotifyPhone.trim();
      let ownerPhone: string | null = null;
      if (typedPhone) {
        const { data: canon, error: canonErr } = await supabase.rpc("canon_phone_input", {
          p_phone: typedPhone,
        });
        if (canonErr || !canon) {
          setPhoneError("Número inválido. Use DDD + número, com ou sem +55.");
          return false;
        }
        ownerPhone = canon;
        setOwnerNotifyPhone(canon);
      }

      const context = businessContext.trim();
      const payload: Record<string, unknown> = {
        user_id: user.id,
        system_prompt: prompt,
        enabled,
        followup_inactivity_minutes: followupOn ? followupMinutes : null,
        followup_max_per_conversation: followupMax,
        company_name: companyName.trim() || null,
        business_context: context || null,
        owner_notify_phone: ownerPhone,
      };
      if (apiKey.trim()) payload.groq_api_key = apiKey.trim();
      const { error } = await supabase.from("agent_configs").upsert(payload, { onConflict: "user_id" });
      if (error) {
        toast({ variant: "destructive", title: "Erro", description: error.message });
        return false;
      }

      if (context) {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("instance_token, status")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (inst?.instance_token && inst.status === "connected") {
          const { data: wh, error: whErr } = await supabase.functions.invoke("manage-instance", {
            body: { action: "set_webhook", instance_token: inst.instance_token },
          });
          if (whErr || !wh?.ok) {
            toast({
              variant: "destructive",
              title: "Negócio salvo, webhook não registrou",
              description: wh?.error || whErr?.message || "Reenvie o webhook em WhatsApp / Uazapi.",
            });
          }
        }
      }

      const hadKey = !!apiKey.trim() || hasKey;
      if (apiKey.trim()) {
        setHasKey(true);
        setApiKey("");
      }
      if (opts?.testAfter && hadKey) await testConnection();
      else toast({ title: "Salvo!" });
      return true;
    } finally {
      setSaving(false);
    }
  };

  return {
    loaded,
    needsGroqSetup: loaded && !hasKey,
    apiKey,
    setApiKey,
    hasKey,
    prompt,
    setPrompt,
    enabled,
    setEnabled,
    saving,
    testing,
    followupOn,
    setFollowupOn,
    followupMinutes,
    setFollowupMinutes,
    followupMax,
    setFollowupMax,
    companyName,
    setCompanyName,
    businessContext,
    setBusinessContext,
    ownerNotifyPhone,
    setOwnerNotifyPhone,
    phoneError,
    setPhoneError,
    saveAgent,
    testConnection,
    reload: loadAgent,
  };
}

export type AgentConfigSettings = ReturnType<typeof useAgentConfigSettings>;
