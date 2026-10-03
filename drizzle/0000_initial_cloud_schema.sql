CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`comment_id` text,
	`kind` text DEFAULT 'attachment' NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`change_revision` integer DEFAULT 0 NOT NULL,
	`body_fallback` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attachments_kind_valid" CHECK("attachments"."kind" IN ('inline', 'attachment')),
	CONSTRAINT "attachments_size_nonnegative" CHECK("attachments"."size" >= 0),
	CONSTRAINT "attachments_body_fallback_valid" CHECK("attachments"."body_fallback" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `attachments_task_created` ON `attachments` (`task_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `attachments_comment_created` ON `attachments` (`comment_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `attachments_task_change_revision` ON `attachments` (`task_id`,`comment_id`,`change_revision`);--> statement-breakpoint
CREATE INDEX `attachments_comment_change_revision` ON `attachments` (`comment_id`,`change_revision`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`body` text NOT NULL,
	`thread_id` text,
	`author_type` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`author_avatar_url` text,
	`version` integer DEFAULT 1 NOT NULL,
	`thread_codex_project_id` text,
	`thread_codex_project_kind` text,
	`thread_codex_host_id` text,
	`thread_workspace_path` text,
	`agent_session` text,
	`change_revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comments_author_type_valid" CHECK("comments"."author_type" IN ('user', 'agent')),
	CONSTRAINT "comments_version_positive" CHECK("comments"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `comments_task_created` ON `comments` (`task_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `comments_task_change_revision` ON `comments` (`task_id`,`change_revision`);--> statement-breakpoint
CREATE TABLE `device_automations` (
	`device_id` text NOT NULL,
	`project_id` text NOT NULL,
	`enabled_by_user` integer DEFAULT 0 NOT NULL,
	`quota_aware` integer DEFAULT 0 NOT NULL,
	`interval_minutes` integer DEFAULT 5 NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`reasoning_effort` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`device_id`, `project_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "device_automations_enabled_valid" CHECK("device_automations"."enabled_by_user" IN (0, 1)),
	CONSTRAINT "device_automations_quota_valid" CHECK("device_automations"."quota_aware" IN (0, 1)),
	CONSTRAINT "device_automations_interval_valid" CHECK("device_automations"."interval_minutes" IN (5, 10, 15, 30, 60))
);
--> statement-breakpoint
CREATE TABLE `device_pairing_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`device_name` text NOT NULL,
	`device_token` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`approved_at` text,
	`device_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "device_pairing_codes_status_valid" CHECK("device_pairing_codes"."status" IN ('pending', 'approved', 'consumed', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE `device_project_mappings` (
	`device_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`device_id`, `project_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `device_task_worktrees` (
	`device_id` text NOT NULL,
	`task_id` text NOT NULL,
	`worktree_path` text NOT NULL,
	`worktree_branch` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`device_id`, `task_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_heartbeat_at` text,
	`last_status` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "devices_status_valid" CHECK("devices"."status" IN ('active', 'revoked', 'pending_pairing'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `global_revision` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "global_revision_singleton" CHECK("global_revision"."singleton" = 1),
	CONSTRAINT "global_revision_nonnegative" CHECK("global_revision"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `project_readme_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_readme_attachments_size_nonnegative" CHECK("project_readme_attachments"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE `project_readmes` (
	`project_id` text PRIMARY KEY NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_readmes_version_positive" CHECK("project_readmes"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`workspace_path` text,
	`labels` text DEFAULT '["缺陷","特性","for-claude","hold","改进","phase-1","phase-2","phase-3","phase-4","phase-5","phase-6"]' NOT NULL,
	`next_task_number` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "projects_workspace_path_null" CHECK("projects"."workspace_path" IS NULL),
	CONSTRAINT "projects_next_task_number_positive" CHECK("projects"."next_task_number" > 0)
);
--> statement-breakpoint
CREATE TABLE `task_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_avatar_url` text,
	`changes` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_activities_actor_type_valid" CHECK("task_activities"."actor_type" IN ('user', 'agent'))
);
--> statement-breakpoint
CREATE INDEX `task_activities_task_created` ON `task_activities` (`task_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `task_relations` (
	`relation_type` text NOT NULL,
	`source_task_id` text NOT NULL,
	`target_task_id` text NOT NULL,
	`origin` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`relation_type`, `source_task_id`, `target_task_id`),
	FOREIGN KEY (`source_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_relations_type_valid" CHECK("task_relations"."relation_type" IN ('parent', 'blocks', 'related')),
	CONSTRAINT "task_relations_not_self" CHECK("task_relations"."source_task_id" <> "task_relations"."target_task_id"),
	CONSTRAINT "task_relations_related_order" CHECK("task_relations"."relation_type" <> 'related' OR "task_relations"."source_task_id" < "task_relations"."target_task_id"),
	CONSTRAINT "task_relations_origin_valid" CHECK("task_relations"."origin" IN ('manual', 'mention'))
);
--> statement-breakpoint
CREATE INDEX `task_relations_target` ON `task_relations` (`relation_type`,`target_task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_relations_one_parent` ON `task_relations` (`target_task_id`) WHERE "task_relations"."relation_type" = 'parent';--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`sort_order` real NOT NULL,
	`thread_id` text,
	`creator_type` text NOT NULL,
	`creator_id` text NOT NULL,
	`creator_name` text NOT NULL,
	`creator_avatar_url` text,
	`assignee_type` text NOT NULL,
	`assignee_id` text NOT NULL,
	`assignee_name` text NOT NULL,
	`assignee_avatar_url` text,
	`development_context_type` text,
	`development_branch` text,
	`start_date` text,
	`due_date` text,
	`recurrence_interval` integer,
	`recurrence_unit` text,
	`archived_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`thread_codex_project_id` text,
	`thread_codex_project_kind` text,
	`thread_codex_host_id` text,
	`thread_workspace_path` text,
	`agent_session` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_status_valid" CHECK("tasks"."status" IN ('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled')),
	CONSTRAINT "tasks_priority_valid" CHECK("tasks"."priority" IN ('none', 'urgent', 'high', 'medium', 'low')),
	CONSTRAINT "tasks_creator_type_valid" CHECK("tasks"."creator_type" IN ('user', 'agent')),
	CONSTRAINT "tasks_assignee_type_valid" CHECK("tasks"."assignee_type" IN ('user', 'agent')),
	CONSTRAINT "tasks_development_context_type_valid" CHECK("tasks"."development_context_type" IS NULL OR "tasks"."development_context_type" IN ('branch', 'worktree')),
	CONSTRAINT "tasks_version_positive" CHECK("tasks"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_identifier_unique` ON `tasks` (`identifier`);--> statement-breakpoint
CREATE INDEX `tasks_project_status_sort` ON `tasks` (`project_id`,`archived_at`,`status`,`sort_order`,`created_at`);--> statement-breakpoint
INSERT INTO global_revision (singleton, revision) VALUES (1, 0);--> statement-breakpoint
CREATE TRIGGER projects_revision_insert AFTER INSERT ON projects BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER projects_revision_update AFTER UPDATE ON projects BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER projects_revision_delete AFTER DELETE ON projects BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER tasks_revision_insert AFTER INSERT ON tasks BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER tasks_revision_update AFTER UPDATE ON tasks BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER tasks_revision_delete AFTER DELETE ON tasks BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER task_relations_revision_insert AFTER INSERT ON task_relations BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER task_relations_revision_update AFTER UPDATE ON task_relations BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER task_relations_revision_delete AFTER DELETE ON task_relations BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER task_relations_prevent_parent_cycle BEFORE INSERT ON task_relations WHEN NEW.relation_type = 'parent' BEGIN SELECT RAISE(ABORT, 'RELATION_CYCLE') WHERE EXISTS (WITH RECURSIVE ancestors(id) AS (SELECT source_task_id FROM task_relations WHERE relation_type = 'parent' AND target_task_id = NEW.source_task_id UNION SELECT task_relations.source_task_id FROM task_relations JOIN ancestors ON task_relations.target_task_id = ancestors.id WHERE task_relations.relation_type = 'parent') SELECT 1 FROM ancestors WHERE id = NEW.target_task_id); END;--> statement-breakpoint
CREATE TRIGGER task_relations_require_same_project BEFORE INSERT ON task_relations BEGIN SELECT RAISE(ABORT, 'CROSS_PROJECT_RELATION') WHERE EXISTS (SELECT 1 FROM tasks AS source JOIN tasks AS target ON target.id = NEW.target_task_id WHERE source.id = NEW.source_task_id AND source.project_id != target.project_id); END;--> statement-breakpoint
CREATE TRIGGER comments_revision_insert AFTER INSERT ON comments BEGIN UPDATE global_revision SET revision = MAX(revision + 1, NEW.change_revision) WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER comments_revision_update AFTER UPDATE ON comments BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER comments_revision_delete AFTER DELETE ON comments BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER attachments_revision_insert AFTER INSERT ON attachments BEGIN UPDATE global_revision SET revision = MAX(revision + 1, NEW.change_revision) WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER attachments_revision_update AFTER UPDATE ON attachments BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER attachments_revision_delete AFTER DELETE ON attachments BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER task_activities_revision_insert AFTER INSERT ON task_activities BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER task_activities_revision_update AFTER UPDATE ON task_activities BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER task_activities_revision_delete AFTER DELETE ON task_activities BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER project_readmes_revision_insert AFTER INSERT ON project_readmes BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER project_readmes_revision_update AFTER UPDATE ON project_readmes BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER project_readmes_revision_delete AFTER DELETE ON project_readmes BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER project_readme_attachments_revision_insert AFTER INSERT ON project_readme_attachments BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER project_readme_attachments_revision_delete AFTER DELETE ON project_readme_attachments BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER devices_revision_insert AFTER INSERT ON devices BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER devices_revision_update AFTER UPDATE ON devices BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER devices_revision_delete AFTER DELETE ON devices BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER device_pairing_codes_revision_insert AFTER INSERT ON device_pairing_codes BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER device_pairing_codes_revision_update AFTER UPDATE ON device_pairing_codes BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER device_automations_revision_insert AFTER INSERT ON device_automations BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER device_automations_revision_update AFTER UPDATE ON device_automations BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;--> statement-breakpoint
CREATE TRIGGER device_automations_revision_delete AFTER DELETE ON device_automations BEGIN UPDATE global_revision SET revision = revision + 1 WHERE singleton = 1; END;
