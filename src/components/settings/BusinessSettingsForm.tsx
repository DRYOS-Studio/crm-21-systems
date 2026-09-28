import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAgentConfig } from "@/contexts/AgentConfigContext";

export function BusinessSettingsForm() {
  const {
    companyName,
    setCompanyName,
    businessContext,
    setBusinessContext,
    ownerNotifyPhone,
    setOwnerNotifyPhone,
    phoneError,
    setPhoneError,
    saving,
    saveAgent,
  } = useAgentConfig();

  return (
    <div className="dryos space-y-4 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Esses dados ligam o modo novo da IA. Sem o texto do negócio, o atendimento continua no caminho
        antigo.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="company-name">Nome da empresa</Label>
        <Input
          id="company-name"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Ex.: Clínica Aurora"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="business-context">Sobre o seu negócio</Label>
        <Textarea
          id="business-context"
          value={businessContext}
          onChange={(e) => setBusinessContext(e.target.value)}
          rows={6}
          placeholder="O que vocês vendem, para quem, e como a IA deve se apresentar."
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="owner-notify-phone">WhatsApp do responsável</Label>
        <Input
          id="owner-notify-phone"
          value={ownerNotifyPhone}
          onChange={(e) => {
            setOwnerNotifyPhone(e.target.value);
            if (phoneError) setPhoneError("");
          }}
          placeholder="11 98888-0000"
          aria-invalid={!!phoneError}
        />
        {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
      </div>
      <Button onClick={() => void saveAgent()} disabled={saving}>
        {saving ? "Salvando…" : "Salvar"}
      </Button>
    </div>
  );
}
