CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'pending_pairing')) DEFAULT 'active',
  last_heartbeat_at TEXT,
  last_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER devices_revision_insert
AFTER INSERT ON devices
BEGIN
  UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1;
END;

CREATE TRIGGER devices_revision_update
AFTER UPDATE ON devices
BEGIN
  UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1;
END;

CREATE TRIGGER devices_revision_delete
AFTER DELETE ON devices
BEGIN
  UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1;
END;

CREATE TABLE IF NOT EXISTS device_pairing_codes (
  code TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  device_token TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'consumed', 'rejected', 'expired')) DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  device_id TEXT REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TRIGGER device_pairing_codes_revision_insert
AFTER INSERT ON device_pairing_codes
BEGIN
  UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1;
END;

CREATE TRIGGER device_pairing_codes_revision_update
AFTER UPDATE ON device_pairing_codes
BEGIN
  UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1;
END;

CREATE TABLE IF NOT EXISTS device_project_mappings (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, project_id)
);

CREATE TABLE IF NOT EXISTS device_task_worktrees (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  worktree_path TEXT NOT NULL,
  worktree_branch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, task_id)
);

CREATE TABLE IF NOT EXISTS device_automations (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  enabled_by_user INTEGER NOT NULL DEFAULT 0 CHECK (enabled_by_user IN (0, 1)),
  quota_aware INTEGER NOT NULL DEFAULT 0 CHECK (quota_aware IN (0, 1)),
  interval_minutes INTEGER NOT NULL DEFAULT 5 CHECK (interval_minutes IN (5, 10, 15, 30, 60)),
  model TEXT NOT NULL DEFAULT '',
  reasoning_effort TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, project_id)
);

CREATE TRIGGER device_automations_revision_insert
AFTER INSERT ON device_automations
BEGIN
  UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1;
END;

CREATE TRIGGER device_automations_revision_update
AFTER UPDATE ON device_automations
BEGIN
  UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1;
END;

CREATE TRIGGER device_automations_revision_delete
AFTER DELETE ON device_automations
BEGIN
  UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1;
END;
