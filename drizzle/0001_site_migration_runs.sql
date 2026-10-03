CREATE TABLE `site_migration_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`bundle_sha256` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_migration_runs_bundle_sha256_unique` ON `site_migration_runs` (`bundle_sha256`);