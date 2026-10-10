interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number };
}

interface Env {
  DUTY_DB: D1Database;
  DISCORD_BOT_TOKEN: string;
  DISCORD_DUTY_CHANNEL_ID: string;
  DUTY_TIMEZONE_OFFSET_MINUTES: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface ScheduledController {
  cron: string;
}

interface DiscordMessage {
  id: string;
  timestamp: string;
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    fields?: Array<{ name?: string; value?: string }>;
    footer?: { text?: string };
  }>;
}

interface DutyLog {
  discord_message_id: string;
  license: string;
  staff_name: string;
  discord_id: string | null;
  shift_minutes: number;
  duty_start: string;
  duty_end: string;
  duty_date: string;
  discord_created_at: string;
}

interface DutyGroup {
  license: string;
  name: string;
  discordId: string;
  shiftCount: number;
  totalMinutes: number;
  lastDutyDate: string;
}

const corsOrigins = new Set([
  "https://969resto.github.io",
  "https://969resto.my.id",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:8000",
  "http://localhost:8000"
]);
const nhostGraphqlUrl = "https://xqjnbwhipztjcbcnmzam.graphql.ap-southeast-1.nhost.run/v1";
const pageSize = 100;
const maxPagesPerRun = 5;

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin && corsOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "authorization, content-type");
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function getTimezoneOffset(env: Env) {
  const offset = Number(env.DUTY_TIMEZONE_OFFSET_MINUTES);
  if (!Number.isInteger(offset) || Math.abs(offset) > 840) {
    throw new Error("DUTY_TIMEZONE_OFFSET_MINUTES harus berupa offset menit yang valid.");
  }
  return offset;
}

function extractMessageText(message: DiscordMessage) {
  const parts = [message.content || ""];
  for (const embed of message.embeds || []) {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);
    for (const field of embed.fields || []) {
      if (field.name) parts.push(`${field.name}: ${field.value || ""}`);
      else if (field.value) parts.push(field.value);
    }
  }
  return parts.join("\n").replace(/\r/g, "").replace(/(?:\*\*|__|~~|`)/g, "");
}

function extractField(text: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^\\s*${escapedLabel}\\s*:\\s*(.*?)\\s*$`, "im"))?.[1]?.trim() || "";
}

function parseTimestamp(value: string, env: Env) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, dayText, monthText, yearText, hourText, minuteText, secondText = "0"] = match;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day
      || hour > 23 || minute > 59 || second > 59) return null;
    const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - getTimezoneOffset(env) * 60000);
    return { timestamp: timestamp.toISOString(), dutyDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }

  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  const local = new Date(timestamp.getTime() + getTimezoneOffset(env) * 60000);
  return { timestamp: timestamp.toISOString(), dutyDate: local.toISOString().slice(0, 10) };
}

function parseDutyLog(message: DiscordMessage, env: Env): DutyLog | null {
  const text = extractMessageText(message);
  const license = extractField(text, "License");
  const staffName = extractField(text, "Player Name");
  const start = parseTimestamp(extractField(text, "Start date"), env);
  const end = parseTimestamp(extractField(text, "End date"), env);
  if (!license || !staffName || !start || !end) return null;

  const elapsedMinutes = (Date.parse(end.timestamp) - Date.parse(start.timestamp)) / 60000;
  if (elapsedMinutes <= 0 || elapsedMinutes > 24 * 60) return null;
  const durationMatch = extractField(text, "Shift Duration").match(/(?:(\d+)\s*Jam)?\s*,?\s*(?:(\d+)\s*Menit)?/i);
  const loggedMinutes = durationMatch && (durationMatch[1] || durationMatch[2])
    ? Number(durationMatch[1] || 0) * 60 + Number(durationMatch[2] || 0)
    : 0;
  const shiftMinutes = loggedMinutes || Math.round(elapsedMinutes);
  if (!Number.isSafeInteger(shiftMinutes) || shiftMinutes < 1 || shiftMinutes > 24 * 60) return null;

  return {
    discord_message_id: message.id,
    license,
    staff_name: staffName,
    discord_id: extractField(text, "DiscordID") || null,
    shift_minutes: shiftMinutes,
    duty_start: start.timestamp,
    duty_end: end.timestamp,
    duty_date: start.dutyDate,
    discord_created_at: message.timestamp
  };
}

async function fetchMessages(env: Env, cursor: { after?: string; before?: string }) {
  const query = new URLSearchParams({ limit: String(pageSize) });
  if (cursor.after) query.set("after", cursor.after);
  if (cursor.before) query.set("before", cursor.before);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_DUTY_CHANNEL_ID}/messages?${query}`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      signal: AbortSignal.timeout(10000)
    });
    if (response.status === 429 && attempt < 3) {
      const result = await response.json() as { retry_after?: number };
      await new Promise(resolve => setTimeout(resolve, Math.min(Number(result.retry_after) || 1, 10) * 1000));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Discord API gagal (${response.status}): ${(await response.text()).slice(0, 400)}`);
    }
    const messages: unknown = await response.json();
    if (!Array.isArray(messages)) throw new Error("Discord tidak mengembalikan daftar pesan.");
    return messages as DiscordMessage[];
  }
  throw new Error("Discord API membatasi permintaan setelah beberapa percobaan.");
}

function orderMessages(messages: DiscordMessage[]) {
  return [...messages].sort((first, second) => BigInt(first.id) < BigInt(second.id) ? -1 : 1);
}

async function getState(db: D1Database, key: string) {
  return db.prepare("SELECT state_value FROM sync_state WHERE state_key = ?")
    .bind(key)
    .first<{ state_value: string | null }>();
}

async function setState(db: D1Database, key: string, value: string | null) {
  await db.prepare(`
    INSERT INTO sync_state (state_key, state_value) VALUES (?, ?)
    ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value
  `).bind(key, value).run();
}

async function saveMessages(db: D1Database, messages: DiscordMessage[], env: Env) {
  const logs = orderMessages(messages)
    .map(message => parseDutyLog(message, env))
    .filter((log): log is DutyLog => Boolean(log));
  if (!logs.length) return 0;
  const statements = logs.map(log => db.prepare(`
    INSERT OR IGNORE INTO duty_logs (
      discord_message_id, license, staff_name, discord_id, shift_minutes,
      duty_start, duty_end, duty_date, discord_created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    log.discord_message_id,
    log.license,
    log.staff_name,
    log.discord_id,
    log.shift_minutes,
    log.duty_start,
    log.duty_end,
    log.duty_date,
    log.discord_created_at
  ));
  const results = await db.batch(statements);
  return results.reduce((total, result) => total + (result.meta?.changes || 0), 0);
}

async function syncDiscordHistory(env: Env) {
  if (!env.DISCORD_BOT_TOKEN?.trim() || !/^\d{17,20}$/.test(env.DISCORD_DUTY_CHANNEL_ID || "")) {
    throw new Error("Atur DISCORD_BOT_TOKEN dan DISCORD_DUTY_CHANNEL_ID di Cloudflare Worker Secrets.");
  }
  getTimezoneOffset(env);
  let latestId = (await getState(env.DUTY_DB, "latest_message_id"))?.state_value || "";
  let backfillBeforeId = (await getState(env.DUTY_DB, "backfill_before_id"))?.state_value || "";
  let backfillComplete = (await getState(env.DUTY_DB, "backfill_complete"))?.state_value === "true";
  let pages = 0;
  let processed = 0;
  let stored = 0;

  if (!latestId) {
    const newestPage = orderMessages(await fetchMessages(env, {}));
    if (!newestPage.length) {
      await setState(env.DUTY_DB, "backfill_complete", "true");
      return { processed, stored, backfillComplete: true };
    }
    processed += newestPage.length;
    stored += await saveMessages(env.DUTY_DB, newestPage, env);
    latestId = newestPage[newestPage.length - 1].id;
    await setState(env.DUTY_DB, "latest_message_id", latestId);
    if (newestPage.length < pageSize) {
      backfillComplete = true;
      backfillBeforeId = "";
    } else {
      backfillBeforeId = newestPage[0].id;
    }
    await setState(env.DUTY_DB, "backfill_before_id", backfillBeforeId || null);
    await setState(env.DUTY_DB, "backfill_complete", String(backfillComplete));
    pages += 1;
  }

  while (pages < maxPagesPerRun && latestId) {
    const page = orderMessages(await fetchMessages(env, { after: latestId }));
    if (!page.length) break;
    processed += page.length;
    stored += await saveMessages(env.DUTY_DB, page, env);
    latestId = page[page.length - 1].id;
    await setState(env.DUTY_DB, "latest_message_id", latestId);
    pages += 1;
    if (page.length < pageSize) break;
  }

  while (pages < maxPagesPerRun && !backfillComplete && backfillBeforeId) {
    const page = orderMessages(await fetchMessages(env, { before: backfillBeforeId }));
    if (!page.length) {
      backfillComplete = true;
      backfillBeforeId = "";
      break;
    }
    processed += page.length;
    stored += await saveMessages(env.DUTY_DB, page, env);
    backfillBeforeId = page[0].id;
    if (page.length < pageSize) {
      backfillComplete = true;
      backfillBeforeId = "";
    }
    await setState(env.DUTY_DB, "backfill_before_id", backfillBeforeId || null);
    await setState(env.DUTY_DB, "backfill_complete", String(backfillComplete));
    pages += 1;
  }

  return { processed, stored, backfillComplete };
}

async function verifyNhostAdmin(authorization: string) {
  const response = await fetch(nhostGraphqlUrl, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json", "x-hasura-role": "attendance_admin" },
    body: JSON.stringify({
      query: "query VerifyAttendanceAdmin { attendance_weekly_recaps(limit: 1) { week_start } }"
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return false;
  const result = await response.json() as { errors?: unknown[]; data?: { attendance_weekly_recaps?: unknown[] } };
  return !result.errors?.length && Array.isArray(result.data?.attendance_weekly_recaps);
}

async function getWeeklyStaff(env: Env, range: { start: string; end: string }) {
  const rows = await env.DUTY_DB.prepare(`
    SELECT
      MAX(trim(license)) AS license,
      COUNT(*) AS shiftCount,
      SUM(shift_minutes) AS totalMinutes,
      MAX(duty_date) AS lastDutyDate,
      (SELECT newest.staff_name FROM duty_logs AS newest
        WHERE lower(trim(newest.license)) = lower(trim(duty_logs.license))
          AND newest.duty_date BETWEEN ? AND ?
        ORDER BY newest.duty_start DESC LIMIT 1) AS name,
      (SELECT newest.discord_id FROM duty_logs AS newest
        WHERE lower(trim(newest.license)) = lower(trim(duty_logs.license))
          AND newest.duty_date BETWEEN ? AND ?
        ORDER BY newest.duty_start DESC LIMIT 1) AS discordId
    FROM duty_logs
    WHERE duty_date BETWEEN ? AND ?
    GROUP BY lower(trim(license))
    ORDER BY totalMinutes DESC, license COLLATE NOCASE
  `).bind(range.start, range.end, range.start, range.end, range.start, range.end).all<Omit<DutyGroup, "identity_key">>();
  if (!rows.success) throw new Error("Gagal membaca rekap mingguan dari database Discord.");
  return rows.results || [];
}

function getWeekBounds(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const start = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime())) return null;
  if (start.toISOString().slice(0, 10) !== value || start.getUTCDay() !== 1) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: value, end: end.toISOString().slice(0, 10) };
}

async function loadWeeklyReport(request: Request, env: Env) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ") || !await verifyNhostAdmin(authorization)) {
    return { status: 401, body: { error: "Sesi admin tidak valid atau tidak memiliki akses." } };
  }
  const input = await request.json() as { weekStart?: unknown };
  const range = getWeekBounds(input.weekStart);
  if (!range) return { status: 400, body: { error: "Pilih minggu ISO penuh yang dimulai pada hari Senin." } };

  const syncResult = await syncDiscordHistory(env);
  const staff = await getWeeklyStaff(env, range);

  const backfill = await getState(env.DUTY_DB, "backfill_complete");
  return {
    status: 200,
    body: {
      staff,
      weekStart: range.start,
      weekEnd: range.end,
      syncedAt: new Date().toISOString(),
      backfillComplete: backfill?.state_value === "true",
      syncResult
    }
  };
}

const worker = {
  async fetch(request: Request, env: Env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: origin && corsOrigins.has(origin)
          ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, content-type",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin"
          }
          : {}
      });
    }
    if (origin && !corsOrigins.has(origin)) return jsonResponse({ error: "Origin tidak diizinkan." }, 403, null);
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || path !== "/api/weekly") {
      return jsonResponse({ error: "Endpoint tidak ditemukan." }, 404, origin);
    }
    try {
      const result = await loadWeeklyReport(request, env);
      return jsonResponse(result.body, result.status, origin);
    } catch (error) {
      console.error("Gagal memproses Log Duty:", error);
      return jsonResponse({ error: error instanceof Error ? error.message : "Gagal memproses Log Duty." }, 500, origin);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(syncDiscordHistory(env).then(result => {
      console.log("Sinkronisasi Log Duty selesai:", JSON.stringify(result));
    }).catch(error => {
      console.error("Sinkronisasi Log Duty gagal:", error);
      throw error;
    }));
  }
};

export default worker;
