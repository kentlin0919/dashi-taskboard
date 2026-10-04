DROP TRIGGER IF EXISTS devices_revision_update;--> statement-breakpoint
CREATE TRIGGER devices_revision_update AFTER UPDATE ON devices
WHEN NEW.name IS NOT OLD.name OR NEW.status IS NOT OLD.status OR NEW.token_hash IS NOT OLD.token_hash
BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS client_storage (key TEXT PRIMARY KEY, value TEXT NOT NULL);
