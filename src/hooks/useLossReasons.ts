import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { type LossReason, normalizeLossReasonName } from "@/lib/loss-reasons";

export function useLossReasons() {
  const { user } = useAuth();
  const [reasons, setReasons] = useState<LossReason[]>([]);

  const reload = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("loss_reasons")
      .select("id, name, position, active")
      .order("position")
      .order("name");
    setReasons((data as LossReason[]) ?? []);
  }, [user?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeReasons = reasons.filter((r) => r.active);

  const createReason = useCallback(
    async (raw: string) => {
      if (!user) return null;
      const name = normalizeLossReasonName(raw);
      if (!name) return null;
      const existing = reasons.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const position = reasons.length ? Math.max(...reasons.map((r) => r.position)) + 1 : 0;
      const { data, error } = await supabase
        .from("loss_reasons")
        .insert({ user_id: user.id, name, position })
        .select("id, name, position, active")
        .single();
      if (error) throw new Error(error.message);
      const row = data as LossReason;
      setReasons((prev) => [...prev, row].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)));
      return row;
    },
    [user, reasons],
  );

  const setActive = useCallback(async (id: string, active: boolean) => {
    const { error } = await supabase.from("loss_reasons").update({ active }).eq("id", id);
    if (error) throw new Error(error.message);
    setReasons((prev) => prev.map((r) => (r.id === id ? { ...r, active } : r)));
  }, []);

  const removeReason = useCallback(async (id: string) => {
    const { error } = await supabase.from("loss_reasons").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setReasons((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const reasonById = useCallback(
    (id: string | null | undefined) => reasons.find((r) => r.id === id),
    [reasons],
  );

  return { reasons, activeReasons, reload, createReason, setActive, removeReason, reasonById };
}
