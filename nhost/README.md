# Nhost Attendance Setup

The attendance page uses Nhost for shift rows and weekly recap archives. Browser `localStorage` is retained only as a temporary cache for unfinished manual time inputs and legacy drafts.

- `attendance_shifts` stores each staff member's manually entered shift, with a staff ID/name/role snapshot because staff data remains in Supabase.
- `attendance_weekly_recaps` stores one JSON recap per Monday-starting week.

## Database and Permissions

1. Create an Nhost project and choose its region.
2. Open the project's SQL editor and run `migrations/20260927_attendance.sql`.
3. In Hasura permissions, allow `public` to select and insert `attendance_shifts` so attendance remains open without login. Do not allow public update/delete.
4. Grant `attendance_admin` full permissions on both tables. Grant no permissions for `public`, `user`, `anonymous`, or `me` on `attendance_weekly_recaps`.
5. Assign `attendance_admin` as an allowed role for the three administrator accounts. Keep their default role as `user`.
6. Keep the Nhost admin secret on a trusted server or function. Never put it in `absensi.html`, a public environment file, or GitHub Pages.

The browser integration uses the public project endpoints and Nhost Auth sessions. Admin GraphQL requests explicitly select `attendance_admin`; public shift entry explicitly uses `public`. The old client-side PIN is not database authorization.

Existing browser-only shift drafts are kept visible as a local fallback, but are not automatically uploaded or deduplicated against Nhost. Existing browser-only weekly archive snapshots also remain local and do not appear in the Nhost history page until re-saved/imported. Do not clear browser storage until any legacy data you need has been migrated.

## Admin Login

The `/admin` dashboard and admin pages share the Nhost Auth session stored by the browser. Assign admin accounts the `attendance_admin` role; opening another admin page in the same browser restores and validates that session instead of asking for credentials again. The attendance page also restores the same session for its admin controls.

The `send-discord` Supabase Edge Function verifies Nhost sessions against Hasura using the `attendance_admin` role. After changing the function or its `verify_jwt` setting in `supabase/config.toml`, deploy the updated function with `supabase functions deploy send-discord` so financial summaries use the shared login in production.