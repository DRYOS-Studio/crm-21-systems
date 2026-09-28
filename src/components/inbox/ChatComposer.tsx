import { useEffect, useRef, useState } from "react";
import { Paperclip, Mic, Sticker, Send, X, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  STICKER_EMOJIS,
  emojiToSticker,
  mediaKindFromFile,
  type MediaKind,
} from "@/lib/chat-media";
import { toast } from "@/hooks/use-toast";

export type ComposerPayload =
  | { kind: "text"; text: string }
  | { kind: "media"; type: MediaKind; file: File; caption?: string; name?: string };

type Props = {
  disabled: boolean;
  sending: boolean;
  aiEnabled: boolean;
  placeholder: string;
  onSend: (payload: ComposerPayload) => Promise<void>;
};

export function ChatComposer({ disabled, sending, aiEnabled, placeholder, onSend }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<File | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => stopStream();
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = 0;
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setPending(file);
  };

  const dispatch = async (payload: ComposerPayload) => {
    setText("");
    setPending(null);
    try {
      await onSend(payload);
    } catch {
      // o parent já mostra o toast
    }
  };

  const send = async () => {
    if (sending || disabled) return;
    if (pending) {
      await dispatch({
        kind: "media",
        type: mediaKindFromFile(pending),
        file: pending,
        caption: text.trim() || undefined,
        name: pending.name,
      });
      return;
    }
    if (!text.trim()) return;
    await dispatch({ kind: "text", text: text.trim() });
  };

  const sendSticker = async (emoji: string) => {
    if (sending || disabled) return;
    setStickersOpen(false);
    const file = await emojiToSticker(emoji);
    await dispatch({
      kind: "media",
      type: file.type === "image/webp" ? "sticker" : "image",
      file,
      name: `${emoji}.webp`,
    });
  };

  const startRec = async () => {
    if (disabled || sending) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stopStream();
      setRecording(false);
      setRecSec(0);
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size < 800) return;
      const file = new File([blob], `audio-${Date.now()}.webm`, { type: blob.type });
      await dispatch({ kind: "media", type: "ptt", file, name: file.name });
    };
    rec.start();
    recRef.current = rec;
    setRecording(true);
    setRecSec(0);
    timerRef.current = window.setInterval(() => {
      setRecSec((s) => {
        if (s >= 59) {
          rec.stop();
          return 59;
        }
        return s + 1;
      });
    }, 1000);
  };

  const cancelRec = () => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = () => {
        stopStream();
        setRecording(false);
        setRecSec(0);
      };
      rec.stop();
    } else {
      stopStream();
      setRecording(false);
    }
  };

  const finishRec = () => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  };

  return (
    <div className="p-3 border-t bg-card">
      {aiEnabled && !disabled && (
        <p className="text-[11px] text-muted-foreground mb-2">
          Edith está respondendo. Enviar (texto, anexo ou áudio) pausa a IA nesta conversa.
        </p>
      )}
      {pending && (
        <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
          <span className="truncate flex-1">{pending.name}</span>
          <button type="button" onClick={() => setPending(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {recording ? (
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-sm tabular-nums">
            0:{String(recSec).padStart(2, "0")}
          </span>
          <span className="text-xs text-muted-foreground flex-1">Gravando áudio…</span>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={cancelRec}>
            <X className="w-4 h-4" />
          </Button>
          <Button type="button" size="icon" className="h-9 w-9" onClick={finishRec}>
            <Square className="w-3.5 h-3.5 fill-current" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-1.5 items-end">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-10 shrink-0"
            disabled={disabled || sending}
            title="Anexar"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Popover open={stickersOpen} onOpenChange={setStickersOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-10 shrink-0"
                disabled={disabled || sending}
                title="Figurinha"
              >
                <Sticker className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              <div className="grid grid-cols-6 gap-1">
                {STICKER_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="h-9 rounded-md text-xl hover:bg-muted"
                    onClick={() => void sendSticker(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-10 shrink-0"
            disabled={disabled || sending}
            title="Áudio"
            onClick={() =>
              void startRec().catch(() =>
                toast({ variant: "destructive", title: "Microfone", description: "Permita o microfone para gravar áudio." }),
              )
            }
          >
            <Mic className="w-4 h-4" />
          </Button>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            id="chat-input"
            rows={2}
            className="min-h-[44px] resize-none"
            placeholder={pending ? "Legenda (opcional)…" : placeholder}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
            disabled={sending || disabled}
          />
          <Button
            id="chat-send"
            onClick={() => void send()}
            disabled={sending || disabled || (!text.trim() && !pending)}
            className="h-11 px-4"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
