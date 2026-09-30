import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type Instance = { id: string; name: string; status: string };
type SavedSegment = { id: string; name: string };

export function OutreachSettings() {
  const { user } = useAuth();
  const userId = user?.id;
  const [enabled, setEnabled] = useState(false);
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [cap, setCap] = useState("40");
  const [intervalSec, setIntervalSec] = useState("90");
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [saturdayMorning, setSaturdayMorning] = useState(false);
  const [instance, setInstance] = useState<Instance | null>(null);
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [capError, setCapError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      const { data: cfg } = await supabase
        .from("agent_configs" as never)
        .select(
          "outreach_enabled, outreach_paused_reason, outreach_instance_id, outreach_daily_cap, outreach_interval_sec, outreach_weekdays_only, outreach_saturday_morning, outreach_segment_id",
        )
        .eq("user_id", userId)
        .maybeSingle();
      const row = cfg as {
        outreach_enabled?: boolean;
        outreach_paused_reason?: string | null;
        outreach_instance_id?: string | null;
        outreach_daily_cap?: number;
        outreach_interval_sec?: number;
        outreach_weekdays_only?: boolean;
        outreach_saturday_morning?: boolean;
        outreach_segment_id?: string | null;
      } | null;
      if (row) {
        setEnabled(!!row.outreach_enabled);
        setPausedReason(row.outreach_paused_reason ?? null);
        setCap(String(row.outreach_daily_cap ?? 40));
        setIntervalSec(String(row.outreach_interval_sec ?? 90));
        setWeekdaysOnly(row.outreach_weekdays_only ?? true);
        setSaturdayMorning(!!row.outreach_saturday_morning);
        setSegmentId(row.outreach_segment_id ?? "");
      }
      const { data: savedSegments } = await supabase.from("saved_prospect_segments" as never).select("id, name").order("name");
      setSegments((savedSegments ?? []) as unknown as SavedSegment[]);
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("id, name, status")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setInstance((inst as Instance | null) ?? null);
    })();
  }, [userId]);

  const save = async () => {
    if (!user) return;
    const n = Number(cap);
    const gap = Number(intervalSec);
    if (!Number.isInteger(n) || n < 1) {
      setCapError("O teto diário precisa ser no mínimo 1.");
      return;
    }
    if (!Number.isInteger(gap) || gap < 30 || gap > 600) {
      setCapError("O intervalo entre números precisa ser entre 30 e 600 segundos.");
      return;
    }
    setCapError("");
    setSaving(true);
    setSaved(false);
    try {
      const nextReason = enabled ? null : pausedReason;
      const { error } = await supabase.from("agent_configs" as never).upsert(
        {
          user_id: user.id,
          outreach_enabled: enabled,
          outreach_paused_reason: nextReason,
          outreach_daily_cap: n,
          outreach_interval_sec: gap,
          outreach_weekdays_only: weekdaysOnly,
          outreach_saturday_morning: weekdaysOnly ? false : saturdayMorning,
          outreach_segment_id: segmentId || null,
        } as never,
        { onConflict: "user_id" },
      );
      if (error) {
        setCapError(error.message);
        return;
      }
      setPausedReason(nextReason);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg text-foreground">Disparo</h2>
      {pausedReason && (
        <div
          id="outreach-pause-reason"
          className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground"
          role="status"
        >
          <Badge variant="warning" className="mb-1">
            pausado
          </Badge>
          <p>{pausedReason}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="outreach-enabled" className="text-sm">
          Ligar disparo
        </Label>
        <Switch
          id="outreach-enabled"
          checked={enabled}
          disabled={saving}
          onCheckedChange={(v) => {
            setEnabled(v);
            setSaved(false);
          }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {instance
          ? `Usa a conexão WhatsApp do Q7: ${instance.name} (${instance.status}).`
          : "Conecte o WhatsApp em WhatsApp / Uazapi. O disparo usa essa mesma instância."}
      </p>
      <p className="text-xs text-muted-foreground">
        Os toques de abordagem saem com os textos prontos. Groq não é necessário para disparar — só para a Edith
        responder depois que a pessoa falar.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="outreach-segment" className="text-xs">Segmento da cadência</Label>
        <select id="outreach-segment" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={segmentId} disabled={saving} onChange={(e) => { setSegmentId(e.target.value); setSaved(false); }}>
          <option value="">Todos os contatos elegíveis</option>
          {segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">O filtro é aplicado antes da reserva, sem alterar opt-out ou limites da cadência.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="outreach-cap" className="text-xs">
          Teto diário
        </Label>
        <Input
          id="outreach-cap"
          type="number"
          min={1}
          value={cap}
          disabled={saving}
          onChange={(e) => {
            setCap(e.target.value);
            setCapError("");
            setSaved(false);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="outreach-interval" className="text-xs">
          Segundos entre cada número
        </Label>
        <Input
          id="outreach-interval"
          type="number"
          min={30}
          max={600}
          value={intervalSec}
          disabled={saving}
          onChange={(e) => {
            setIntervalSec(e.target.value);
            setCapError("");
            setSaved(false);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Uma abordagem por vez. 90s é o padrão — abaixo de 60s o WhatsApp costuma barrar o número.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          id="outreach-weekdays"
          type="checkbox"
          checked={weekdaysOnly}
          disabled={saving}
          onChange={(e) => setWeekdaysOnly(e.target.checked)}
        />
        Só dias úteis (segunda a sexta)
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          id="outreach-saturday"
          type="checkbox"
          checked={saturdayMorning && !weekdaysOnly}
          disabled={saving || weekdaysOnly}
          onChange={(e) => setSaturdayMorning(e.target.checked)}
        />
        Sábado de manhã (9h–13h)
      </label>
      <p className="text-xs text-muted-foreground">
        Escritório de advocacia: WhatsApp de trabalho é segunda a sexta. Sábado não responde.
      </p>
      {capError && (
        <p className="text-sm text-destructive" role="alert">
          {capError}
        </p>
      )}
      <Button id="outreach-save" type="button" size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Salvando...
          </>
        ) : (
          "Salvar disparo"
        )}
      </Button>
      {saved && (
        <p id="outreach-saved" className="text-sm text-foreground">
          Salvo!
        </p>
      )}
    </section>
  );
}
