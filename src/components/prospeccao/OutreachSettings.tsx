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

export function OutreachSettings() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState("");
  const [cap, setCap] = useState("40");
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [saturdayMorning, setSaturdayMorning] = useState(false);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [saving, setSaving] = useState(false);
  const [capError, setCapError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data: cfg } = await supabase
        .from("agent_configs" as never)
        .select(
          "outreach_enabled, outreach_paused_reason, outreach_instance_id, outreach_daily_cap, outreach_weekdays_only, outreach_saturday_morning",
        )
        .eq("user_id", user.id)
        .maybeSingle();
      const row = cfg as {
        outreach_enabled?: boolean;
        outreach_paused_reason?: string | null;
        outreach_instance_id?: string | null;
        outreach_daily_cap?: number;
        outreach_weekdays_only?: boolean;
        outreach_saturday_morning?: boolean;
      } | null;
      if (row) {
        setEnabled(!!row.outreach_enabled);
        setPausedReason(row.outreach_paused_reason ?? null);
        setInstanceId(row.outreach_instance_id ?? "");
        setCap(String(row.outreach_daily_cap ?? 40));
        setWeekdaysOnly(row.outreach_weekdays_only ?? true);
        setSaturdayMorning(!!row.outreach_saturday_morning);
      }
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("id, name, status")
        .eq("user_id", user.id)
        .order("created_at");
      setInstances((inst ?? []) as Instance[]);
    })();
  }, [user?.id]);

  const save = async () => {
    if (!user) return;
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 1) {
      setCapError("O teto diário precisa ser no mínimo 1.");
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
          outreach_instance_id: instanceId || null,
          outreach_daily_cap: n,
          outreach_weekdays_only: weekdaysOnly,
          outreach_saturday_morning: saturdayMorning,
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
      <div className="space-y-1.5">
        <Label htmlFor="outreach-instance" className="text-xs">
          Instância
        </Label>
        <select
          id="outreach-instance"
          disabled={saving}
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">Nenhuma</option>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.status})
            </option>
          ))}
        </select>
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
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          id="outreach-weekdays"
          type="checkbox"
          checked={weekdaysOnly}
          disabled={saving}
          onChange={(e) => setWeekdaysOnly(e.target.checked)}
        />
        Só dias úteis
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          id="outreach-saturday"
          type="checkbox"
          checked={saturdayMorning}
          disabled={saving}
          onChange={(e) => setSaturdayMorning(e.target.checked)}
        />
        Sábado de manhã (9h–13h)
      </label>
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
