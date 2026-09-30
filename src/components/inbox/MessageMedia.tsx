import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ChatMediaMessage = {
  id: string;
  media_type?: string | null;
  media_url?: string | null;
  media_name?: string | null;
};

function isPlayableMediaUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/\/storage\/v1\/object\/public\/chat-media\//i.test(url)) return false;
  if (/mmg\.whatsapp\.net/i.test(url)) return false;
  if (/\.enc(\?|$)/i.test(url)) return false;
  return true;
}

export function MessageMedia({ message }: { message: ChatMediaMessage }) {
  const type = message.media_type;
  const [url, setUrl] = useState(message.media_url);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(message.media_url);
    setFailed(false);
  }, [message.id, message.media_url]);

  useEffect(() => {
    if (!type || !url || isPlayableMediaUrl(url)) return;
    let cancelled = false;
    setBusy(true);
    void supabase.functions
      .invoke("manage-instance", { body: { action: "download_media", message_id: message.id } })
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.ok && data.url) setUrl(data.url);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [message.id, type, url]);

  if (!url || !type) return null;

  if (type === "image") {
    return <img src={isPlayableMediaUrl(url) ? url : undefined} alt="" className="mb-1 max-h-64 rounded-lg object-cover" />;
  }
  if (type === "sticker") {
    return <img src={isPlayableMediaUrl(url) ? url : undefined} alt="" className="mb-1 h-28 w-28 object-contain" />;
  }
  if (type === "video") {
    if (busy) return <div className="mb-1 text-xs text-muted-foreground">Carregando vídeo…</div>;
    if (!isPlayableMediaUrl(url) || failed) {
      return <div className="mb-1 text-xs text-muted-foreground">Não foi possível reproduzir este vídeo.</div>;
    }
    return <video src={url} controls className="mb-1 max-h-64 w-full rounded-lg" />;
  }
  if (type === "audio" || type === "ptt") {
    if (busy) return <div className="mb-1 text-xs text-muted-foreground">Carregando áudio…</div>;
    if (!isPlayableMediaUrl(url) || failed) {
      return <div className="mb-1 text-xs text-muted-foreground">Não foi possível reproduzir este áudio.</div>;
    }
    return <audio src={url} controls preload="metadata" className="mb-1 w-56 max-w-full" />;
  }
  if (!isPlayableMediaUrl(url)) {
    return <div className="mb-1 text-xs text-muted-foreground">{message.media_name || "Arquivo indisponível"}</div>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mb-1 inline-flex text-sm underline">
      {message.media_name || "Documento"}
    </a>
  );
}
