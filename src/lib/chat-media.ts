import { supabase } from "@/integrations/supabase/client";

export type MediaKind = "image" | "video" | "audio" | "ptt" | "sticker" | "document";

export const STICKER_EMOJIS = [
  "😀", "😂", "😍", "🤩", "😎", "🙌", "👏", "✅",
  "❤️", "🔥", "🙏", "👍", "👎", "😮", "😢", "🎉",
  "🤝", "💪", "🤔", "👋", "😅", "🥰", "😮‍💨", "✨",
] as const;

const LIMITS: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  ptt: 16 * 1024 * 1024,
  sticker: 500 * 1024,
  document: 15 * 1024 * 1024,
};

export function mediaKindFromFile(file: File, as: "auto" | "sticker" | "ptt" = "auto"): MediaKind {
  if (as === "sticker") return "sticker";
  if (as === "ptt") return "ptt";
  const t = file.type.toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  return "document";
}

export function mediaLabel(kind: MediaKind, caption?: string, name?: string) {
  const prefix =
    kind === "image" ? "[imagem]" :
    kind === "video" ? "[vídeo]" :
    kind === "audio" || kind === "ptt" ? "[áudio]" :
    kind === "sticker" ? "[figurinha]" :
    "[documento]";
  const extra = (caption || name || "").trim();
  return extra ? `${prefix} ${extra}` : prefix;
}

export function assertMediaSize(file: File, kind: MediaKind) {
  const max = LIMITS[kind];
  if (file.size > max) {
    throw new Error(`Arquivo grande demais (máx. ${Math.round(max / 1024 / 1024)} MB)`);
  }
}

function extFromFile(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "application/pdf": "pdf",
  };
  return map[file.type] || "bin";
}

export async function uploadChatFile(userId: string, file: File) {
  const path = `${userId}/${crypto.randomUUID()}.${extFromFile(file)}`;
  const { error } = await supabase.storage.from("chat-media").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
  if (!data.publicUrl) throw new Error("Falha ao gerar URL do arquivo");
  return { path, url: data.publicUrl };
}

export async function emojiToSticker(emoji: string): Promise<File> {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.clearRect(0, 0, size, size);
  ctx.font = "420px 'Apple Color Emoji','Segoe UI Emoji',system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, size / 2, size / 2 + 16);
  const blob = await new Promise<Blob>((resolve, reject) => {
    const done = (b: Blob | null, type: string) => {
      if (b) resolve(b);
      else reject(new Error(`Falha ao gerar figurinha (${type})`));
    };
    canvas.toBlob((b) => (b ? done(b, "webp") : canvas.toBlob((p) => done(p, "png"), "image/png")), "image/webp", 0.92);
  });
  const ext = blob.type.includes("png") ? "png" : "webp";
  return new File([blob], `figurinha.${ext}`, { type: blob.type });
}
