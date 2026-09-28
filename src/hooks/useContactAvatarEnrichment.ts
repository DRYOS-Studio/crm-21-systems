import { useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type ConvRef = {
  id: string;
  contact_avatar_url?: string | null;
  wa_phone?: string | null;
  contact_phone?: string | null;
  instance_id?: string | null;
};

const MAX_PER_RUN = 2;
const GAP_MS = 900;

/** Preenche fotos faltantes via Uazapi /chat/details (conversas antigas, antes do webhook guardar avatar). */
export function useContactAvatarEnrichment(conversations: ConvRef[]) {
  const tried = useRef(new Set<string>());

  const missingKey = useMemo(() => {
    return conversations
      .filter((c) => !c.contact_avatar_url && (c.wa_phone || c.contact_phone) && c.instance_id)
      .map((c) => c.id)
      .sort()
      .join(",");
  }, [conversations]);

  useEffect(() => {
    if (!missingKey || (typeof document !== "undefined" && document.hidden)) return;

    const ids = missingKey.split(",").filter(Boolean);
    const batch = ids.filter((id) => !tried.current.has(id)).slice(0, MAX_PER_RUN);
    if (!batch.length) return;

    let cancelled = false;

    (async () => {
      for (const id of batch) {
        if (cancelled) break;
        tried.current.add(id);
        const c = conversations.find((x) => x.id === id);
        const number = c?.wa_phone || c?.contact_phone;
        if (!number) continue;
        try {
          const { data, error } = await supabase.functions.invoke("manage-instance", {
            body: {
              action: "enrich_contact_avatar",
              conversation_id: id,
              number,
            },
          });
          if (error || !data?.ok || !data?.avatar_url) continue;
        } catch {
          /* best-effort */
        }
        if (!cancelled) await new Promise((r) => setTimeout(r, GAP_MS));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [missingKey, conversations]);
}
