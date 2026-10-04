CREATE TABLE `device_user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`code` text NOT NULL,
	`claim_hash` text NOT NULL,
	`token_hash` text,
	`actor_json` text,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`session_expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_user_sessions_status_valid" CHECK("device_user_sessions"."status" IN ('pending', 'approved', 'active', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_user_sessions_token_hash_unique` ON `device_user_sessions` (`token_hash`);