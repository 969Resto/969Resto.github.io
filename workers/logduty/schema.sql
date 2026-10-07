CREATE TABLE IF NOT EXISTS duty_logs (
  discord_message_id TEXT PRIMARY KEY,
  license TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  discord_id TEXT,
  shift_minutes INTEGER NOT NULL CHECK (shift_minutes > 0),
  duty_start TEXT NOT NULL,
  duty_end TEXT NOT NULL,
  duty_date TEXT NOT NULL,
  discord_created_at TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (duty_end > duty_start)
);

CREATE INDEX IF NOT EXISTS duty_logs_license_date_idx
  ON duty_logs (lower(trim(license)), duty_date);

CREATE TABLE IF NOT EXISTS sync_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT
);
