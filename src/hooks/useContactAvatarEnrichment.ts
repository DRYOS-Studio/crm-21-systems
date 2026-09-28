import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type ConvRef = {
  id: string;
  contact_avatar_url?: string | null;
  wa_phone?: string | null;
  contact_phone?: string | null;
  instance_id?: string | null;
};

const MAX_PER_RUN = 8;

/** Preenche fotos faltantes via Uazapi /chat/details (conversas antigas, antes do webhook guardar avatar). */
export function useContactAvatarEnrichment(conversations: ConvRef[]) {
  const tried = useRef(new Set<string>());

  useEffect(() => {
    const missing = conversations.filter(
      (c) => !c.contact_avatar_url && (c.wa_phone || c.contact_phone) && c.instance_id,
    );
    const batch = missing.filter((c) => !tried.current.has(c.id)).slice(0, MAX_PER_RUN);
    if (!batch.length) return;

    let cancelled = false;

    (async () => {
      for (const c of batch) {
        if (cancelled) break;
        tried.current.add(c.id);
        const number = c.wa_phone || c.contact_phone;
        if (!number) continue;
        try {
          const { data, error } = await supabase.functions.invoke("manage-instance", {
            body: {
              action: "enrich_contact_avatar",
              conversation_id: c.id,
              number,
            },
          });
          if (error || !data?.ok || !data?.avatar_url) continue;
        } catch {
          /* best-effort */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversations]);
}
