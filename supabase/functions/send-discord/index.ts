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

function normalizeHistoryRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Data riwayat tidak valid.");
  }

  const record = value as Record<string, unknown>;
  const textFields = ["periode", "catatan", "nama_perangkum"] as const;
  const numberFields = [
    "saldo",
    "saldo_pembagian",
    "modal",
    "reimburse",
    "ditarik",
    "kerjasama",
    "setoran",
    "gaji_pokok",
    "total_gaji"
  ] as const;

  if (
    typeof record.periode !== "string" || typeof record.catatan !== "string" ||
    typeof record.nama_perangkum !== "string"
  ) {
    throw new Error("Data riwayat tidak valid.");
  }
  if (record.periode.length > 100 || record.catatan.length > 5000 || record.nama_perangkum.length > 200) {
    throw new Error("Panjang data riwayat melebihi batas.");
  }

  for (const field of numberFields) {
    if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
      throw new Error("Data angka riwayat tidak valid.");
    }
  }

  const fotoUrls = record.foto_urls;
  const fotoPaths = record.foto_paths;
  if (
    !Array.isArray(fotoUrls) || !Array.isArray(fotoPaths) || fotoUrls.length > 5 ||
    fotoUrls.length !== fotoPaths.length ||
    !fotoUrls.every((url) => typeof url === "string" && url.length <= 2048) ||
    !fotoPaths.every((path) => typeof path === "string" && path.length <= 512)
  ) {
    throw new Error("Daftar foto riwayat tidak valid.");
  }

  return Object.fromEntries([
    ...textFields.map((field) => [field, record[field]]),
    ...numberFields.map((field) => [field, record[field]]),
    ["foto_urls", fotoUrls],
    ["foto_paths", fotoPaths]
  ]);
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

    if (input && typeof input === "object" && (input as Record<string, unknown>).action === "list_history") {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) {
        return jsonResponse({ error: "Konfigurasi pembacaan riwayat belum lengkap." }, 500, origin);
      }

      const historyUrl = new URL(`${supabaseUrl}/rest/v1/riwayat_keuangan`);
      historyUrl.searchParams.set("select", "*");
      historyUrl.searchParams.set("order", "created_at.desc");
      historyUrl.searchParams.set("limit", "1000");

      try {
        const databaseResponse = await fetch(historyUrl, {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`
          },
          redirect: "error"
        });
        if (!databaseResponse.ok) {
          console.error("History query failed:", await databaseResponse.text());
          return jsonResponse({ error: "Database menolak pembacaan riwayat keuangan." }, 502, origin);
        }

        const records: unknown = await databaseResponse.json();
        if (!Array.isArray(records)) {
          return jsonResponse({ error: "Format riwayat dari database tidak valid." }, 502, origin);
        }
        return jsonResponse({ data: records }, 200, origin);
      } catch {
        return jsonResponse({ error: "Tidak dapat menghubungi database riwayat keuangan." }, 502, origin);
      }
    }

    if (input && typeof input === "object" && (input as Record<string, unknown>).action === "save_history") {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) {
        return jsonResponse({ error: "Konfigurasi penyimpanan riwayat belum lengkap." }, 500, origin);
      }

      let record: Record<string, unknown>;
      try {
        record = normalizeHistoryRecord((input as Record<string, unknown>).record);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Data riwayat tidak valid." }, 400, origin);
      }

      try {
        const databaseResponse = await fetch(`${supabaseUrl}/rest/v1/riwayat_keuangan`, {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify(record),
          redirect: "error"
        });
        if (!databaseResponse.ok) {
          console.error("History insert failed:", await databaseResponse.text());
          return jsonResponse({ error: "Database menolak penyimpanan riwayat keuangan." }, 502, origin);
        }
      } catch {
        return jsonResponse({ error: "Tidak dapat menghubungi database riwayat keuangan." }, 502, origin);
      }

      return jsonResponse({ success: true }, 201, origin);
    }

    if (input && typeof input === "object" && ["delete_history", "clear_history"].includes(String((input as Record<string, unknown>).action))) {
      const action = String((input as Record<string, unknown>).action);
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) {
        return jsonResponse({ error: "Konfigurasi penghapusan riwayat belum lengkap." }, 500, origin);
      }

      const deleteUrl = new URL(`${supabaseUrl}/rest/v1/riwayat_keuangan`);
      if (action === "delete_history") {
        const rawId = (input as Record<string, unknown>).id;
        const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : "";
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
          return jsonResponse({ error: "ID riwayat tidak valid." }, 400, origin);
        }
        deleteUrl.searchParams.set("id", `eq.${id}`);
      } else {
        deleteUrl.searchParams.set("id", "not.is.null");
      }

      try {
        const databaseResponse = await fetch(deleteUrl, {
          method: "DELETE",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            Prefer: "return=minimal"
          },
          redirect: "error"
        });
        if (!databaseResponse.ok) {
          console.error("History delete failed:", await databaseResponse.text());
          return jsonResponse({ error: "Database menolak penghapusan riwayat keuangan." }, 502, origin);
        }
      } catch {
        return jsonResponse({ error: "Tidak dapat menghubungi database riwayat keuangan." }, 502, origin);
      }

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