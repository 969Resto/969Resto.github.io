import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") || "https://969resto.github.io,http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:8000,http://localhost:8000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://rdnhbqufxidbdwmxxabf.supabase.co";
const nhostGraphqlUrl = Deno.env.get("NHOST_GRAPHQL_URL") || "https://xqjnbwhipztjcbcnmzam.graphql.ap-southeast-1.nhost.run/v1";
const allowedSalaryRoleMentions = new Set(["1529864836987486288", "1529864881782653089"]);
const partnershipRoleMentions = [
  Deno.env.get("DISCORD_WORKER_ROLE_ID")?.trim(),
  Deno.env.get("DISCORD_RECRUIT_ROLE_ID")?.trim()
];
const allowedRoleMentions = new Set([
  ...allowedSalaryRoleMentions,
  ...partnershipRoleMentions.filter((roleId): roleId is string => Boolean(roleId && /^\d{17,20}$/.test(roleId)))
]);

async function isNhostAttendanceAdmin(authorization: string) {
  const response = await fetch(nhostGraphqlUrl, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      "x-hasura-role": "attendance_admin"
    },
    body: JSON.stringify({
      query: "query VerifyAttendanceAdmin { attendance_weekly_recaps(limit: 1) { week_start } }"
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return false;
  const result = await response.json();
  return !result.errors?.length && Array.isArray(result.data?.attendance_weekly_recaps);
}

async function isAllowedAdmin(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return false;

  try {
    if (await isNhostAttendanceAdmin(authorization)) return true;
  } catch {
    // A Nhost verification failure may still be a valid legacy Supabase session.
  }

  const allowedEmails = new Set(
    (Deno.env.get("DISCORD_ADMIN_EMAILS") || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!allowedEmails.size) return false;
  const apiKey = Deno.env.get("SUPABASE_ANON_KEY") || request.headers.get("apikey");
  if (!apiKey) return false;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: apiKey, Authorization: authorization },
    signal: AbortSignal.timeout(8000)
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

  if (input.role_mentions !== undefined) {
    const roleMentions = input.role_mentions;
    if (
      !Array.isArray(roleMentions) || !roleMentions.every((roleId) => typeof roleId === "string" && allowedRoleMentions.has(roleId))
    ) {
      throw new Error("Mention role tidak valid.");
    }
    payload.allowed_mentions = { parse: [], roles: [...new Set(roleMentions)] };
  }

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

function normalizePartnershipRecord(value: unknown, requirePackageRange = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Data kerjasama tidak valid.");
  }

  const record = value as Record<string, unknown>;
  const partnerName = typeof record.partner_name === "string" ? record.partner_name.trim() : "";
  const startsOn = typeof record.starts_on === "string" ? record.starts_on : "";
  const endsOn = typeof record.ends_on === "string" ? record.ends_on : "";
  const deliverySchedule = typeof record.delivery_schedule === "string" ? record.delivery_schedule.trim() : "";
  const notes = typeof record.notes === "string" ? record.notes.trim() : "";
  const packageRange = typeof record.package_range === "string" ? record.package_range.trim() : "";
  const hasPackageRange = record.package_range !== null && record.package_range !== undefined && record.package_range !== "";
  const statuses = new Set(["active", "completed", "cancelled"]);

  if (!partnerName || partnerName.length > 160) throw new Error("Nama partner wajib diisi (maksimal 160 karakter).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
    throw new Error("Periode kerjasama tidak valid.");
  }
  if (new Date(`${startsOn}T00:00:00Z`).toISOString().slice(0, 10) !== startsOn || new Date(`${endsOn}T00:00:00Z`).toISOString().slice(0, 10) !== endsOn || endsOn < startsOn) {
    throw new Error("Tanggal akhir harus sama dengan atau setelah tanggal mulai.");
  }
  if (typeof record.delivery_required !== "boolean") throw new Error("Status kebutuhan pengiriman tidak valid.");
  if (hasPackageRange && typeof record.package_range !== "string") throw new Error("Jumlah paket harus berupa angka atau rentang, misalnya 10-15.");
  const packageRangeMatch = packageRange.match(/^(\d{1,6})(?:\s*-\s*(\d{1,6}))?$/);
  if (packageRange && (
    !packageRangeMatch || Number(packageRangeMatch[1]) < 1 || Number(packageRangeMatch[1]) > 100000 ||
    (packageRangeMatch[2] && (Number(packageRangeMatch[2]) < Number(packageRangeMatch[1]) || Number(packageRangeMatch[2]) > 100000))
  )) {
    throw new Error("Jumlah paket harus berupa angka atau rentang yang valid, misalnya 10-15.");
  }
  if (deliverySchedule.length > 300 || notes.length > 2000) throw new Error("Catatan kerjasama melebihi batas.");
  if (record.delivery_required && !deliverySchedule) throw new Error("Jadwal pengiriman wajib diisi jika pengiriman diperlukan.");
  if (requirePackageRange && record.delivery_required && !packageRange) throw new Error("Jumlah paket wajib diisi jika pengiriman diperlukan.");
  if (typeof record.status !== "string" || !statuses.has(record.status)) throw new Error("Status kerjasama tidak valid.");

  return {
    partner_name: partnerName,
    starts_on: startsOn,
    ends_on: endsOn,
    delivery_required: record.delivery_required,
    delivery_schedule: record.delivery_required ? deliverySchedule : "",
    package_range: record.delivery_required ? packageRange || null : null,
    status: record.status,
    notes
  };
}

function partnershipReminderText(value: unknown) {
  const record = normalizePartnershipRecord(value);
  const start = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${record.starts_on}T00:00:00Z`));
  const end = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${record.ends_on}T00:00:00Z`));
  const delivery = record.delivery_required
    ? `Diperlukan: ${record.delivery_schedule}`
    : "Tidak ada pengiriman untuk kerjasama ini.";
  const packageCount = record.delivery_required
    ? record.package_range === null ? "Jumlah paket belum dicatat" : `${record.package_range} paket`
    : "-";
  const notes = record.notes.length > 900 ? `${record.notes.slice(0, 897)}...` : record.notes;

  return [
    "🔔 **PENGINGAT KERJASAMA RESTO**",
    `<@&${partnershipRoleMentions[0]}> <@&${partnershipRoleMentions[1]}>`,
    `**${record.partner_name}**`,
    `Periode: ${start} - ${end}`,
    `Pengiriman: ${delivery}`,
    `Total paket: ${packageCount}`,
    notes ? `Catatan: ${notes}` : ""
  ].filter(Boolean).join("\n");
}

function partnershipBatchReminderText(records: unknown[]) {
  const lines = [
    "🔔 **PENGINGAT KERJASAMA RESTO**",
    `<@&${partnershipRoleMentions[0]}> <@&${partnershipRoleMentions[1]}>`,
    ""
  ];

  records.forEach((value, index) => {
    const record = normalizePartnershipRecord(value);
    const start = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${record.starts_on}T00:00:00Z`));
    const end = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${record.ends_on}T00:00:00Z`));
    const delivery = record.delivery_required ? record.delivery_schedule.slice(0, 70) : "Tidak perlu pengiriman";
    const packageCount = record.delivery_required ? record.package_range === null ? "Belum dicatat" : `${record.package_range} paket` : "-";
    const notes = record.notes ? record.notes.slice(0, 60) : "-";
    lines.push(`${index + 1}. **${record.partner_name.slice(0, 70)}** (${start} - ${end})`);
    lines.push(`Pengiriman: ${delivery}${record.delivery_required && record.delivery_schedule.length > 70 ? "..." : ""}`);
    lines.push(`Total paket: ${packageCount}`);
    lines.push(`Catatan: ${notes}${record.notes.length > 60 ? "..." : ""}`);
    lines.push("");
  });

  const content = lines.join("\n").trim();
  if (content.length > 2000) throw new Error("Isi pesan melebihi batas Discord. Kirim maksimal lima kerjasama per pesan.");
  return content;
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
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > 9 * 1024 * 1024) {
        return jsonResponse({ error: "Ukuran foto maksimal 8 MB." }, 413, origin);
      }

      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) {
        return jsonResponse({ error: "Konfigurasi penyimpanan foto belum lengkap." }, 500, origin);
      }

      const formData = await request.formData();
      const photo = formData.get("photo");
      if (!(photo instanceof File) || !photo.type.startsWith("image/") || photo.size === 0 || photo.size > 8 * 1024 * 1024) {
        return jsonResponse({ error: "Foto tidak valid atau ukurannya melebihi 8 MB." }, 400, origin);
      }

      const extensions: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/avif": "avif"
      };
      const extension = extensions[photo.type];
      if (!extension) {
        return jsonResponse({ error: "Format foto tidak didukung." }, 400, origin);
      }

      const filePath = `${crypto.randomUUID()}.${extension}`;
      const storageResponse = await fetch(
        `${supabaseUrl}/storage/v1/object/dokumen-keuangan/${filePath}`,
        {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": photo.type,
            "x-upsert": "false"
          },
          body: photo,
          redirect: "error"
        }
      );
      if (!storageResponse.ok) {
        console.error("Photo upload failed:", await storageResponse.text());
        return jsonResponse({ error: "Penyimpanan foto ditolak oleh server." }, 502, origin);
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/dokumen-keuangan/${filePath}`;
      return jsonResponse({ success: true, url: publicUrl, path: filePath }, 201, origin);
    }

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

    if (input && typeof input === "object" && (input as Record<string, unknown>).action === "list_partnerships") {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) return jsonResponse({ error: "Konfigurasi database kerjasama belum lengkap." }, 500, origin);

      const partnershipsUrl = new URL(`${supabaseUrl}/rest/v1/restaurant_partnerships`);
      partnershipsUrl.searchParams.set("select", "*");
      partnershipsUrl.searchParams.set("order", "starts_on.desc,created_at.desc");
      const databaseResponse = await fetch(partnershipsUrl, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
        redirect: "error"
      });
      if (!databaseResponse.ok) {
        console.error("Partnership query failed:", await databaseResponse.text());
        return jsonResponse({ error: "Database menolak pembacaan data kerjasama." }, 502, origin);
      }
      return jsonResponse({ data: await databaseResponse.json() }, 200, origin);
    }

    if (input && typeof input === "object" && (input as Record<string, unknown>).action === "save_partnership") {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) return jsonResponse({ error: "Konfigurasi database kerjasama belum lengkap." }, 500, origin);

      const requestData = input as Record<string, unknown>;
      let record: ReturnType<typeof normalizePartnershipRecord>;
      try {
        record = normalizePartnershipRecord(requestData.record, true);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Data kerjasama tidak valid." }, 400, origin);
      }

      const rawId = (requestData.record as Record<string, unknown>).id;
      const id = typeof rawId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId) ? rawId : "";
      const endpoint = new URL(`${supabaseUrl}/rest/v1/restaurant_partnerships`);
      const method = id ? "PATCH" : "POST";
      if (id) endpoint.searchParams.set("id", `eq.${id}`);
      const databaseResponse = await fetch(endpoint, {
        method,
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
        console.error("Partnership save failed:", await databaseResponse.text());
        return jsonResponse({ error: "Database menolak penyimpanan data kerjasama." }, 502, origin);
      }
      return jsonResponse({ success: true }, id ? 200 : 201, origin);
    }

    if (input && typeof input === "object" && (input as Record<string, unknown>).action === "delete_partnership") {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) return jsonResponse({ error: "Konfigurasi database kerjasama belum lengkap." }, 500, origin);

      const rawId = (input as Record<string, unknown>).id;
      if (typeof rawId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId)) {
        return jsonResponse({ error: "ID kerjasama tidak valid." }, 400, origin);
      }
      const endpoint = new URL(`${supabaseUrl}/rest/v1/restaurant_partnerships`);
      endpoint.searchParams.set("id", `eq.${rawId}`);
      const databaseResponse = await fetch(endpoint, {
        method: "DELETE",
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Prefer: "return=minimal" },
        redirect: "error"
      });
      if (!databaseResponse.ok) {
        console.error("Partnership delete failed:", await databaseResponse.text());
        return jsonResponse({ error: "Database menolak penghapusan data kerjasama." }, 502, origin);
      }
      return jsonResponse({ success: true }, 200, origin);
    }

    if (input && typeof input === "object" && (input as Record<string, unknown>).action === "partnership_reminder") {
      const requestData = input as Record<string, unknown>;
      const roleIds = partnershipRoleMentions;
      if (!roleIds.every((roleId) => roleId && /^\d{17,20}$/.test(roleId))) {
        return jsonResponse({ error: "ID role Discord Worker dan Recruit belum dikonfigurasi pada Supabase." }, 500, origin);
      }
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) return jsonResponse({ error: "Konfigurasi database kerjasama belum lengkap." }, 500, origin);

      const rawId = (requestData.partnership as Record<string, unknown> | undefined)?.id;
      if (typeof rawId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId)) {
        return jsonResponse({ error: "ID kerjasama tidak valid." }, 400, origin);
      }
      const endpoint = new URL(`${supabaseUrl}/rest/v1/restaurant_partnerships`);
      endpoint.searchParams.set("select", "*");
      endpoint.searchParams.set("id", `eq.${rawId}`);
      endpoint.searchParams.set("limit", "1");
      const databaseResponse = await fetch(endpoint, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
        redirect: "error"
      });
      if (!databaseResponse.ok) {
        console.error("Partnership reminder lookup failed:", await databaseResponse.text());
        return jsonResponse({ error: "Tidak dapat membaca data kerjasama untuk pengingat." }, 502, origin);
      }
      const records: unknown = await databaseResponse.json();
      if (!Array.isArray(records) || !records.length) return jsonResponse({ error: "Data kerjasama tidak ditemukan." }, 404, origin);
      if (records[0].status !== "active") return jsonResponse({ error: "Pengingat hanya dapat dikirim untuk kerjasama aktif." }, 409, origin);

      let content: string;
      try {
        content = partnershipReminderText(records[0]);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Data pengingat tidak valid." }, 400, origin);
      }

      input = { action: "partnership_reminder", content, role_mentions: roleIds };
    }

    if (input && typeof input === "object" && (input as Record<string, unknown>).action === "partnership_batch_reminder") {
      const requestData = input as Record<string, unknown>;
      const roleIds = partnershipRoleMentions;
      if (!roleIds.every((roleId) => roleId && /^\d{17,20}$/.test(roleId))) {
        return jsonResponse({ error: "ID role Discord Worker dan Recruit belum dikonfigurasi pada Supabase." }, 500, origin);
      }
      const ids = requestData.ids;
      if (
        !Array.isArray(ids) || ids.length < 1 || ids.length > 5 ||
        !ids.every((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) ||
        new Set(ids).size !== ids.length
      ) {
        return jsonResponse({ error: "Pilih 1 sampai 5 data kerjasama yang valid." }, 400, origin);
      }
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) return jsonResponse({ error: "Konfigurasi database kerjasama belum lengkap." }, 500, origin);

      const endpoint = new URL(`${supabaseUrl}/rest/v1/restaurant_partnerships`);
      endpoint.searchParams.set("select", "id,partner_name,starts_on,ends_on,delivery_required,delivery_schedule,package_range,status,notes");
      endpoint.searchParams.set("id", `in.(${ids.join(",")})`);
      const databaseResponse = await fetch(endpoint, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
        redirect: "error"
      });
      if (!databaseResponse.ok) {
        console.error("Partnership batch query failed:", await databaseResponse.text());
        return jsonResponse({ error: "Tidak dapat membaca data kerjasama terpilih." }, 502, origin);
      }
      const records: unknown = await databaseResponse.json();
      if (!Array.isArray(records) || records.length !== ids.length || records.some((record) => record.status !== "active")) {
        return jsonResponse({ error: "Data tidak ditemukan atau ada kerjasama yang sudah tidak aktif. Muat ulang daftar." }, 409, origin);
      }

      let content: string;
      try {
        content = partnershipBatchReminderText(records);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Data pengingat tidak valid." }, 400, origin);
      }
      input = { action: "partnership_batch_reminder", content, role_mentions: roleIds };
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

    const action = input && typeof input === "object"
      ? (input as Record<string, unknown>).action
      : undefined;
    const isChatRestoMessage = action === "salary_announcement" || action === "partnership_reminder" || action === "partnership_batch_reminder";
    const webhookSecretName = isChatRestoMessage
      ? "DISCORD_CHAT_RESTO_WEBHOOK_URL"
      : "DISCORD_WEBHOOK_URL";
    const webhookUrl = Deno.env.get(webhookSecretName);
    if (!webhookUrl) {
      const message = isChatRestoMessage
        ? "Webhook Chat Resto belum dikonfigurasi di Supabase (DISCORD_CHAT_RESTO_WEBHOOK_URL)."
        : "Webhook Discord belum dikonfigurasi di Supabase.";
      return jsonResponse({ error: message }, 500, origin);
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