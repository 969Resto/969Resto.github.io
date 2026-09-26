import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") || "https://969resto.github.io,http://127.0.0.1:5500,http://localhost:5500")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://rdnhbqufxidbdwmxxabf.supabase.co";

async function isAllowedAdmin(request: Request) {
  const allowedEmails = new Set(
    (Deno.env.get("DISCORD_ADMIN_EMAILS") || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!allowedEmails.size) throw new Error("DISCORD_ADMIN_EMAILS belum dikonfigurasi.");

  const authorization = request.headers.get("Authorization");
  const apiKey = Deno.env.get("SUPABASE_ANON_KEY") || request.headers.get("apikey");
  if (!authorization?.startsWith("Bearer ") || !apiKey) return false;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: apiKey, Authorization: authorization }
  });
  if (!response.ok) return false;

  const user = await response.json();
  return typeof user.email === "string" && allowedEmails.has(user.email.toLowerCase());
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizePayload(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Payload laporan tidak valid.");
  }

  const input = value as Record<string, unknown>;
  if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 2000) {
    throw new Error("Isi laporan wajib diisi dan maksimal 2.000 karakter.");
  }

  const payload: Record<string, unknown> = {
    username: "969 Resto",
    content: input.content,
    allowed_mentions: { parse: [] }
  };

  if (input.embeds !== undefined) {
    if (!Array.isArray(input.embeds) || input.embeds.length > 5) {
      throw new Error("Lampiran foto tidak valid.");
    }

    payload.embeds = input.embeds.map((embed) => {
      const imageUrl = (embed as { image?: { url?: unknown } })?.image?.url;
      if (typeof imageUrl !== "string") throw new Error("URL foto tidak valid.");

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(imageUrl);
      } catch {
        throw new Error("URL foto tidak valid.");
      }

      if (
        parsedUrl.protocol !== "https:" ||
        parsedUrl.hostname !== "rdnhbqufxidbdwmxxabf.supabase.co" ||
        !parsedUrl.pathname.startsWith("/storage/v1/object/public/dokumen-keuangan/")
      ) {
        throw new Error("Foto harus berasal dari penyimpanan dokumen keuangan.");
      }

      return { image: { url: parsedUrl.href } };
    });
  }

  return payload;
}

serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins.has(origin)) {
    return jsonResponse({ error: "Origin tidak diizinkan." }, 403, origin);
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Vary": "Origin"
      }
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method tidak diizinkan." }, 405, origin);
  }

  let authorized: boolean;
  try {
    authorized = await isAllowedAdmin(request);
  } catch {
    return jsonResponse({ error: "Konfigurasi autentikasi admin belum lengkap." }, 500, origin);
  }
  if (!authorized) {
    return jsonResponse({ error: "Login admin diperlukan atau akun tidak diizinkan." }, 401, origin);
  }

  try {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 64 * 1024) {
      return jsonResponse({ error: "Payload laporan terlalu besar." }, 413, origin);
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return jsonResponse({ error: "Format payload tidak valid." }, 400, origin);
    }

    if (input && typeof input === "object" && (input as Record<string, unknown>).action === "verify") {
      return jsonResponse({ success: true }, 200, origin);
    }

    const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (!webhookUrl) {
      return jsonResponse({ error: "Webhook Discord belum dikonfigurasi di Supabase." }, 500, origin);
    }

    let payload: Record<string, unknown>;
    try {
      payload = normalizePayload(input);
    } catch (error) {
      const message = error instanceof SyntaxError
        ? "Format payload tidak valid."
        : error instanceof Error
        ? error.message
        : "Payload laporan tidak valid.";
      return jsonResponse({ error: message }, 400, origin);
    }

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "error"
      });
    } catch {
      return jsonResponse({ error: "Tidak dapat menghubungi Discord." }, 502, origin);
    }

    if (!response.ok) {
      return jsonResponse({ error: "Discord menolak pengiriman laporan." }, 502, origin);
    }

    return jsonResponse({ success: true }, 200, origin);
  } catch {
    return jsonResponse({ error: "Terjadi kesalahan saat mengirim laporan." }, 500, origin);
  }
});