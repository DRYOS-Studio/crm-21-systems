import { ExternalLink, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useAgentConfig } from "@/contexts/AgentConfigContext";

export function AgentSettingsForm() {
  const {
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
    saveAgent,
    testConnection,
  } = useAgentConfig();

  return (
    <div className="space-y-8 max-w-xl">
      <section className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            Chave da API {hasKey && <span className="text-muted-foreground font-normal">(configurada)</span>}
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
          <Label>Prompt do agente</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            placeholder="Como o agente deve se comportar, tom de voz, sobre o negócio..."
          />
        </div>
        <label className="flex items-center justify-between cursor-pointer gap-4">
          <div>
            <div className="font-medium text-sm">Agente ativo</div>
            <div className="text-xs text-muted-foreground">Responde automaticamente às mensagens do WhatsApp.</div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </label>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => void saveAgent({ testAfter: true })} disabled={saving}>
            {saving ? "Salvando…" : "Salvar e testar"}
          </Button>
          <Button variant="outline" onClick={() => void testConnection()} disabled={testing}>
            <TestTube2 className="w-4 h-4 mr-2" />
            {testing ? "Testando…" : "Testar conexão"}
          </Button>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <div>
          <h2 className="font-semibold text-sm">Follow-up automático</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Se o cliente ficar sem responder, a IA envia uma mensagem curta de reengajamento.
          </p>
        </div>
        <label className="flex items-center justify-between cursor-pointer gap-4">
          <div className="font-medium text-sm">Reengajar clientes inativos</div>
          <Switch checked={followupOn} onCheckedChange={setFollowupOn} />
        </label>
        {followupOn && (
          <div className="grid grid-cols-2 gap-3 max-w-sm">
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
          Use &quot;Salvar e testar&quot; acima para aplicar follow-up. O contador zera quando o cliente responde.
        </p>
      </section>
    </div>
  );
}
