CREATE TABLE device_user_sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  code TEXT NOT NULL,
  claim_hash TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  actor_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'active', 'revoked')),
  expires_at TEXT NOT NULL,
  session_expires_at TEXT,
  created_at TEXT NOT NULL
);
