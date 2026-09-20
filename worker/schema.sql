CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  in_time TEXT NOT NULL,
  out_time TEXT NOT NULL,
  hours REAL NOT NULL,
  pay INTEGER NOT NULL,
  learning TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  who TEXT NOT NULL,
  text TEXT NOT NULL,
  time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_date TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT '手渡し',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS payments_month_idx ON payments(month, paid_date);

CREATE TABLE IF NOT EXISTS auth_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
