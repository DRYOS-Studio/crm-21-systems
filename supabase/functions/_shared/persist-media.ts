type Admin = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        data: Uint8Array,
        opts: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
};

export function isPlayableMediaUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/mmg\.whatsapp\.net/i.test(url)) return false;
  if (/\.enc(\?|$)/i.test(url)) return false;
  return true;
}

function extFromMime(mime: string, asMp3: boolean) {
  if (asMp3 || mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("pdf")) return "pdf";
  return "bin";
}

export async function downloadUazapiMedia(opts: {
  serverUrl: string;
  instanceToken: string;
  messageId: string;
  asMp3: boolean;
}): Promise<{ fileURL: string; mimetype: string | null } | null> {
  const res = await fetch(`${opts.serverUrl.replace(/\/$/, "")}/message/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: opts.instanceToken,
    },
    body: JSON.stringify({
      id: opts.messageId,
      generate_mp3: opts.asMp3,
      return_link: true,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("[persist-media] download failed", res.status, text.slice(0, 240));
    return null;
  }
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const fileURL = data?.fileURL || data?.fileUrl || data?.url || null;
  if (!fileURL || typeof fileURL !== "string") return null;
  return { fileURL, mimetype: data?.mimetype || null };
}

export async function persistWhatsappMedia(opts: {
  admin: Admin;
  userId: string;
  serverUrl: string | null | undefined;
  instanceToken: string | null | undefined;
  messageId: string | null | undefined;
  mediaType: string | null | undefined;
  fallbackUrl: string | null | undefined;
}): Promise<string | null> {
  if (isPlayableMediaUrl(opts.fallbackUrl)) return opts.fallbackUrl ?? null;
  if (!opts.serverUrl || !opts.instanceToken || !opts.messageId) {
    return opts.fallbackUrl ?? null;
  }
  const asMp3 = opts.mediaType === "audio" || opts.mediaType === "ptt";
  const downloaded = await downloadUazapiMedia({
    serverUrl: opts.serverUrl,
    instanceToken: opts.instanceToken,
    messageId: opts.messageId,
    asMp3,
  });
  if (!downloaded) return opts.fallbackUrl ?? null;

  try {
    const fileRes = await fetch(downloaded.fileURL);
    if (!fileRes.ok) return downloaded.fileURL;
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    if (!buf.byteLength) return downloaded.fileURL;
    const mime =
      downloaded.mimetype ||
      fileRes.headers.get("content-type") ||
      (asMp3 ? "audio/mpeg" : "application/octet-stream");
    const path = `${opts.userId}/${crypto.randomUUID()}.${extFromMime(mime, asMp3)}`;
    const { error } = await opts.admin.storage.from("chat-media").upload(path, buf, {
      contentType: mime.split(";")[0].trim(),
      upsert: false,
    });
    if (error) {
      console.error("[persist-media] storage", error.message);
      return downloaded.fileURL;
    }
    const { data } = opts.admin.storage.from("chat-media").getPublicUrl(path);
    return data.publicUrl || downloaded.fileURL;
  } catch (e: any) {
    console.error("[persist-media] fetch/upload", e?.message);
    return downloaded.fileURL;
  }
}
