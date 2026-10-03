CREATE TABLE site_migration_runs (
  id TEXT PRIMARY KEY,
  bundle_sha256 TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
