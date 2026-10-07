# Nhost Attendance Setup

The attendance page uses Nhost for shift rows and weekly recap archives. Browser `localStorage` is retained only as a temporary cache for unfinished manual time inputs and legacy drafts.

- `attendance_shifts` stores each staff member's manually entered shift, with a staff ID/name/role snapshot because staff data remains in Supabase.
- `attendance_weekly_recaps` stores one JSON recap per Monday-starting week.

## Database and Permissions

1. Create an Nhost project and choose its region.
2. Open the project's SQL editor and run `migrations/20260927_attendance.sql`.
3. In the Hasura Console, open **Data > attendance_shifts > Permissions**, add the `public` role if needed, and enable its **Delete** permission (row filter `{}`). The page also needs `public` select and insert permissions. Save the permissions and reload the attendance page. Public delete permission lets any visitor delete any staff member's shift; it does not verify shift ownership. Do not allow public update. Changing application code or running the SQL migration does not grant this Hasura permission.
4. Grant `attendance_admin` full permissions on both tables. Grant no permissions for `public`, `user`, `anonymous`, or `me` on `attendance_weekly_recaps`.
5. Assign `attendance_admin` as an allowed role for the three administrator accounts. Keep their default role as `user`.
6. Keep the Nhost admin secret on a trusted server or function. Never put it in `absensi.html`, a public environment file, or GitHub Pages.

## Discord Log Duty via Cloudflare Wrangler

The **Management > Log Duty Discord Mingguan** page reads only the Cloudflare D1 duty log table. It is independent from the manual Nhost attendance records and shows one selected Monday-Sunday ISO week at a time. The scheduled Cloudflare Worker reads embeds in the Discord duty channel every 15 minutes and groups shifts by the immutable `License`, not player names or Discord nicknames.

1. In Discord Developer Portal, create a bot, enable **Message Content Intent**, and invite it with **View Channels** and **Read Message History** for the duty-log channel.
2. Open a terminal in `workers/logduty` and run `npm ci`, then `npx wrangler login`.
3. The `969resto-logduty` D1 database is already configured in `workers/logduty/wrangler.toml`. Do not create it again. For a new Cloudflare account, create a D1 database and replace the database ID in that file.
4. Initialize D1 with `npx wrangler d1 execute 969resto-logduty --remote --file=schema.sql`.
5. Set secrets without adding them to source code: `npx wrangler secret put DISCORD_BOT_TOKEN` and `npx wrangler secret put DISCORD_DUTY_CHANNEL_ID`. Wrangler asks for each value privately in the terminal. `DUTY_TIMEZONE_OFFSET_MINUTES` is in `wrangler.toml` (`420` for WIB, `480` for WITA, `540` for WIT).
6. Deploy from that folder with `npx wrangler deploy`. The Worker URL is already connected to `admin/logduty.html`.
7. After deploying the website, sign in to the Management page and open **Log Duty**. The Worker runs every 15 minutes and also syncs when an administrator loads the weekly report. Older channel messages are backfilled in batches. Each Discord message ID is stored once, and the summary page verifies the current Nhost `attendance_admin` session before returning the weekly D1 totals.

The parser uses `Player Name`, `DiscordID`, `License`, `Shift Duration`, `Start date`, and `End date`; the separate `Total Mingguan` field in Discord embeds is ignored. Never paste the bot token into a chat, website file, GitHub repository, or browser console.

## Database Heartbeat

The GitHub Actions workflow at `.github/workflows/nhost-heartbeat.yml` reads one `attendance_shifts` row every two days using the `public` Hasura role. It needs no secret, but the migration and public select permission above must already be applied. GitHub Actions runs scheduled workflows from the repository's default branch; use the workflow's **Run workflow** action to test it after pushing. A successful run confirms the GraphQL/database query worked at that time, but cannot prevent Nhost maintenance, outages, or platform-initiated pauses.

The browser integration uses the public project endpoints and Nhost Auth sessions. Admin GraphQL requests explicitly select `attendance_admin`; public shift entry and shift deletion explicitly use `public`. Shift deletion is available to anyone who can open the attendance page, without checking staff identity. The old client-side PIN is not database authorization.

Existing browser-only shift drafts are kept visible as a local fallback, but are not automatically uploaded or deduplicated against Nhost. Existing browser-only weekly archive snapshots also remain local and do not appear in the Nhost history page until re-saved/imported. Do not clear browser storage until any legacy data you need has been migrated.

## Admin Login

The `/admin` dashboard and admin pages share the Nhost Auth session stored by the browser. Assign admin accounts the `attendance_admin` role; opening another admin page in the same browser restores and validates that session instead of asking for credentials again. The attendance page also restores the same session for its admin controls.

The `send-discord` Supabase Edge Function verifies Nhost sessions against Hasura using the `attendance_admin` role. After changing the function or its `verify_jwt` setting in `supabase/config.toml`, deploy the updated function with `supabase functions deploy send-discord` so financial summaries use the shared login in production.

## Restaurant Partnerships

Run `supabase/migrations/20261001_restaurant_partnerships.sql`, `supabase/migrations/20261002_restaurant_partnership_package_count.sql`, and `supabase/migrations/20261002_restaurant_partnership_package_range.sql` in the Supabase SQL editor, then deploy the updated Edge Function with `supabase functions deploy send-discord`. The function uses `SUPABASE_SERVICE_ROLE_KEY` for partnership data and sends manual reminders to the `DISCORD_CHAT_RESTO_WEBHOOK_URL` secret. Batch reminders also require the Discord role IDs in the `DISCORD_WORKER_ROLE_ID` and `DISCORD_RECRUIT_ROLE_ID` Supabase function secrets so the message can mention the correct roles. Browser access still requires an Nhost `attendance_admin` session.