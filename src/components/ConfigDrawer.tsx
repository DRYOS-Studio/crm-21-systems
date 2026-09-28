import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { KnowledgeBaseSection } from "@/components/knowledge/KnowledgeBaseSection";
import { Bot, Building2, ExternalLink, TestTube2, Clock, Smartphone } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: "whatsapp" | "agente";
}

export function ConfigDrawer({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [prompt, setPrompt] = useState(
    "Você é um assistente de atendimento simpático e objetivo. Quando receber [áudio], [imagem], [vídeo] ou [documento], diga que ainda não consegue ouvir ou ver o conteúdo e peça para o cliente resumir por texto.",
  );
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

  const loadAgent = async () => {
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
  };

  useEffect(() => {
    if (!open) return;
    void loadAgent();
  }, [open, user]);

  const saveAgent = async () => {
    if (!user) return;
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
          return;
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
        return;
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
      if (hadKey) await testConnection();
      else toast({ title: "Salvo!" });
    } finally {
      setSaving(false);
    }
  };

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
    } else {
      toast({ title: "Conexão OK!", description: `Resposta: ${data.data?.reply}` });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Configuração</SheetTitle>
          <SheetDescription>
            Configure a IA e o follow-up automático.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-8">
          <section className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" /> WhatsApp
            </h3>
            <p className="text-xs text-muted-foreground">
              Token, servidor, webhook e QR ficam numa tela só.
            </p>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to="/whatsapp" onClick={() => onOpenChange(false)}>
                Abrir WhatsApp / Uazapi
              </Link>
            </Button>
          </section>

          <Separator />

          <section className="dryos space-y-4 rounded-lg border border-border bg-card p-5">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" /> Seu negócio
            </h3>
            <p className="text-xs text-muted-foreground">
              Esses dados ligam o modo novo da IA. Sem o texto do negócio, o atendimento
              continua no caminho antigo.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="company-name" className="text-xs">
                Nome da empresa
              </Label>
              <Input
                id="company-name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ex.: Clínica Aurora"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="business-context" className="text-xs">
                Sobre o seu negócio
              </Label>
              <Textarea
                id="business-context"
                value={businessContext}
                onChange={(e) => setBusinessContext(e.target.value)}
                rows={5}
                placeholder="O que vocês vendem, para quem, e como a IA deve se apresentar."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="owner-notify-phone" className="text-xs">
                WhatsApp do responsável
              </Label>
              <Input
                id="owner-notify-phone"
                value={ownerNotifyPhone}
                onChange={(e) => {
                  setOwnerNotifyPhone(e.target.value);
                  if (phoneError) setPhoneError("");
                }}
                placeholder="11 98888-0000"
                aria-invalid={!!phoneError}
                aria-describedby={phoneError ? "owner-notify-phone-error" : undefined}
              />
              {phoneError && (
                <p id="owner-notify-phone-error" className="text-xs text-destructive" role="alert">
                  {phoneError}
                </p>
              )}
            </div>
          </section>

          <Separator />

          <KnowledgeBaseSection open={open} />

          <Separator />

          <section className="space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" /> Agente IA (Groq)
            </h3>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Chave da API {hasKey && <span className="text-muted-foreground">(configurada)</span>}
              </Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? "•••••••• (deixe vazio para manter)" : "gsk_..."}
              />
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Obter chave gratuita <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Prompt do agente</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder="Como o agente deve se comportar, tom de voz, sobre o negócio..."
              />
            </div>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="font-medium text-sm">Agente ativo</div>
                <div className="text-xs text-muted-foreground">
                  Responde automaticamente às mensagens do WhatsApp.
                </div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </label>

            <div className="flex gap-2">
              <Button onClick={() => void saveAgent()} disabled={saving} className="flex-1" size="sm">
                {saving ? "Salvando..." : "Salvar"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void testConnection()} disabled={testing}>
                <TestTube2 className="w-4 h-4 mr-2" />
                {testing ? "Testando..." : "Testar"}
              </Button>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Follow-up automático
            </h3>
            <p className="text-xs text-muted-foreground">
              Se o cliente ficar sem responder por um tempo, a IA envia uma
              mensagem curta de reengajamento.
            </p>

            <label className="flex items-center justify-between cursor-pointer">
              <div className="font-medium text-sm">Reengajar clientes inativos</div>
              <Switch checked={followupOn} onCheckedChange={setFollowupOn} />
            </label>

            {followupOn && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Após quantos minutos</Label>
                  <Input
                    type="number"
                    min={1}
                    max={43200}
                    value={followupMinutes}
                    onChange={(e) => setFollowupMinutes(Number(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Máx. por conversa</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={followupMax}
                    onChange={(e) => setFollowupMax(Number(e.target.value) || 1)}
                  />
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Salve na seção acima para aplicar. O contador é zerado toda vez
              que o cliente responde.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
