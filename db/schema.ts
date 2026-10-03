import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const DEFAULT_LABELS = '["缺陷","特性","for-claude","hold","改进","phase-1","phase-2","phase-3","phase-4","phase-5","phase-6"]';

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  workspacePath: text("workspace_path"),
  labels: text("labels").notNull().default(DEFAULT_LABELS),
  nextTaskNumber: integer("next_task_number").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("projects_workspace_path_null", sql`${table.workspacePath} IS NULL`),
  check("projects_next_task_number_positive", sql`${table.nextTaskNumber} > 0`),
]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  projectId: text("project_id").notNull().references(() => projects.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull(),
  priority: text("priority").notNull(),
  labels: text("labels").notNull().default("[]"),
  sortOrder: real("sort_order").notNull(),
  threadId: text("thread_id"),
  creatorType: text("creator_type").notNull(),
  creatorId: text("creator_id").notNull(),
  creatorName: text("creator_name").notNull(),
  creatorAvatarUrl: text("creator_avatar_url"),
  assigneeType: text("assignee_type").notNull(),
  assigneeId: text("assignee_id").notNull(),
  assigneeName: text("assignee_name").notNull(),
  assigneeAvatarUrl: text("assignee_avatar_url"),
  developmentContextType: text("development_context_type"),
  developmentBranch: text("development_branch"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  recurrenceInterval: integer("recurrence_interval"),
  recurrenceUnit: text("recurrence_unit"),
  archivedAt: text("archived_at"),
  version: integer("version").notNull().default(1),
  threadCodexProjectId: text("thread_codex_project_id"),
  threadCodexProjectKind: text("thread_codex_project_kind"),
  threadCodexHostId: text("thread_codex_host_id"),
  threadWorkspacePath: text("thread_workspace_path"),
  agentSession: text("agent_session"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("tasks_status_valid", sql`${table.status} IN ('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled')`),
  check("tasks_priority_valid", sql`${table.priority} IN ('none', 'urgent', 'high', 'medium', 'low')`),
  check("tasks_creator_type_valid", sql`${table.creatorType} IN ('user', 'agent')`),
  check("tasks_assignee_type_valid", sql`${table.assigneeType} IN ('user', 'agent')`),
  check("tasks_development_context_type_valid", sql`${table.developmentContextType} IS NULL OR ${table.developmentContextType} IN ('branch', 'worktree')`),
  check("tasks_version_positive", sql`${table.version} > 0`),
  index("tasks_project_status_sort").on(table.projectId, table.archivedAt, table.status, table.sortOrder, table.createdAt),
]);

export const taskRelations = sqliteTable("task_relations", {
  relationType: text("relation_type").notNull(),
  sourceTaskId: text("source_task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  targetTaskId: text("target_task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  origin: text("origin").notNull().default("manual"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.relationType, table.sourceTaskId, table.targetTaskId] }),
  check("task_relations_type_valid", sql`${table.relationType} IN ('parent', 'blocks', 'related')`),
  check("task_relations_not_self", sql`${table.sourceTaskId} <> ${table.targetTaskId}`),
  check("task_relations_related_order", sql`${table.relationType} <> 'related' OR ${table.sourceTaskId} < ${table.targetTaskId}`),
  check("task_relations_origin_valid", sql`${table.origin} IN ('manual', 'mention')`),
  index("task_relations_target").on(table.relationType, table.targetTaskId),
  uniqueIndex("task_relations_one_parent").on(table.targetTaskId).where(sql`${table.relationType} = 'parent'`),
]);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  threadId: text("thread_id"),
  authorType: text("author_type").notNull(),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  authorAvatarUrl: text("author_avatar_url"),
  version: integer("version").notNull().default(1),
  threadCodexProjectId: text("thread_codex_project_id"),
  threadCodexProjectKind: text("thread_codex_project_kind"),
  threadCodexHostId: text("thread_codex_host_id"),
  threadWorkspacePath: text("thread_workspace_path"),
  agentSession: text("agent_session"),
  changeRevision: integer("change_revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("comments_author_type_valid", sql`${table.authorType} IN ('user', 'agent')`),
  check("comments_version_positive", sql`${table.version} > 0`),
  index("comments_task_created").on(table.taskId, table.createdAt, table.id),
  index("comments_task_change_revision").on(table.taskId, table.changeRevision),
]);

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  commentId: text("comment_id").references(() => comments.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("attachment"),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  changeRevision: integer("change_revision").notNull().default(0),
  bodyFallback: integer("body_fallback").notNull().default(1),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("attachments_kind_valid", sql`${table.kind} IN ('inline', 'attachment')`),
  check("attachments_size_nonnegative", sql`${table.size} >= 0`),
  check("attachments_body_fallback_valid", sql`${table.bodyFallback} IN (0, 1)`),
  index("attachments_task_created").on(table.taskId, table.createdAt, table.id),
  index("attachments_comment_created").on(table.commentId, table.createdAt, table.id),
  index("attachments_task_change_revision").on(table.taskId, table.commentId, table.changeRevision),
  index("attachments_comment_change_revision").on(table.commentId, table.changeRevision),
]);

export const taskActivities = sqliteTable("task_activities", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  actorAvatarUrl: text("actor_avatar_url"),
  changes: text("changes").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("task_activities_actor_type_valid", sql`${table.actorType} IN ('user', 'agent')`),
  index("task_activities_task_created").on(table.taskId, table.createdAt, table.id),
]);

export const projectReadmes = sqliteTable("project_readmes", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("project_readmes_version_positive", sql`${table.version} > 0`),
]);

export const projectReadmeAttachments = sqliteTable("project_readme_attachments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("project_readme_attachments_size_nonnegative", sql`${table.size} >= 0`),
]);

export const globalRevision = sqliteTable("global_revision", {
  singleton: integer("singleton").primaryKey(),
  revision: integer("revision").notNull().default(0),
}, (table) => [
  check("global_revision_singleton", sql`${table.singleton} = 1`),
  check("global_revision_nonnegative", sql`${table.revision} >= 0`),
]);

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  status: text("status").notNull().default("active"),
  lastHeartbeatAt: text("last_heartbeat_at"),
  lastStatus: text("last_status"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("devices_status_valid", sql`${table.status} IN ('active', 'revoked', 'pending_pairing')`),
]);

export const devicePairingCodes = sqliteTable("device_pairing_codes", {
  code: text("code").primaryKey(),
  deviceName: text("device_name").notNull(),
  deviceToken: text("device_token"),
  status: text("status").notNull().default("pending"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  approvedAt: text("approved_at"),
  deviceId: text("device_id").references(() => devices.id, { onDelete: "cascade" }),
}, (table) => [
  check("device_pairing_codes_status_valid", sql`${table.status} IN ('pending', 'approved', 'consumed', 'rejected', 'expired')`),
]);

export const deviceProjectMappings = sqliteTable("device_project_mappings", {
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workspacePath: text("workspace_path").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.deviceId, table.projectId] }),
]);

export const deviceTaskWorktrees = sqliteTable("device_task_worktrees", {
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  worktreePath: text("worktree_path").notNull(),
  worktreeBranch: text("worktree_branch"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.deviceId, table.taskId] }),
]);

export const deviceAutomations = sqliteTable("device_automations", {
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  enabledByUser: integer("enabled_by_user").notNull().default(0),
  quotaAware: integer("quota_aware").notNull().default(0),
  intervalMinutes: integer("interval_minutes").notNull().default(5),
  model: text("model").notNull().default(""),
  reasoningEffort: text("reasoning_effort").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.deviceId, table.projectId] }),
  check("device_automations_enabled_valid", sql`${table.enabledByUser} IN (0, 1)`),
  check("device_automations_quota_valid", sql`${table.quotaAware} IN (0, 1)`),
  check("device_automations_interval_valid", sql`${table.intervalMinutes} IN (5, 10, 15, 30, 60)`),
]);

export const siteMigrationRuns = sqliteTable("site_migration_runs", {
  id: text("id").primaryKey(),
  bundleSha256: text("bundle_sha256").notNull().unique(),
  createdAt: text("created_at").notNull(),
});
