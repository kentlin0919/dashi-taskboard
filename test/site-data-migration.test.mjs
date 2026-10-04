import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createCloudWorkerHarness } from "./helpers/cloud-worker-harness.mjs";

function migrationBundle() {
  const attachment = Buffer.from("sample attachment");
  const attachmentId = "attachment-1";
  const projectId = "project-1";
  const taskId = "task-1";
  const deviceId = "device-1";
  return {
    schemaVersion: 2,
    createdAt: "2026-10-03T00:00:00.000Z",
    counts: { byProject: {} },
    tables: {
      projects: [{ id: projectId, name: "Taskboard", workspace_path: null, labels: "[]", next_task_number: 2, created_at: "now", updated_at: "now" }],
      project_readmes: [],
      tasks: [{
        id: taskId,
        identifier: "TB-1",
        project_id: projectId,
        title: "Keep the original task",
        description: "Imported from the local Taskboard.",
        status: "todo",
        priority: "medium",
        labels: "[]",
        sort_order: 1,
        thread_id: "thread-1",
        thread_codex_project_id: "codex-project-1",
        thread_codex_project_kind: "local",
        thread_codex_host_id: "host-1",
        thread_workspace_path: null,
        creator_type: "user",
        creator_id: "user-1",
        creator_name: "Kent",
        creator_avatar_url: null,
        assignee_type: "agent",
        assignee_id: "codex-agent",
        assignee_name: "Codex Agent",
        assignee_avatar_url: null,
        git_branch: null,
        worktree_branch: "task-1",
        worktree_path: null,
        external_id: null,
        external_key: null,
        external_origin: null,
        external_source: null,
        external_url: null,
        start_date: null,
        due_date: null,
        recurrence_interval: null,
        recurrence_unit: null,
        archived_at: null,
        version: 4,
        agent_session: "session-1",
        created_at: "now",
        updated_at: "now",
      }],
      task_activities: [{ id: "activity-1", task_id: taskId, actor_type: "user", actor_id: "user-1", actor_name: "Kent", actor_avatar_url: null, changes: "{}", created_at: "now" }],
      comments: [{
        id: "comment-1",
        task_id: taskId,
        body: "Preserve this comment and its thread binding.",
        thread_id: "thread-1",
        thread_codex_project_id: "codex-project-1",
        thread_codex_project_kind: "local",
        thread_codex_host_id: "host-1",
        thread_workspace_path: null,
        author_type: "user",
        author_id: "user-1",
        author_name: "Kent",
        author_avatar_url: null,
        version: 2,
        created_at: "now",
        updated_at: "now",
        agent_session: null,
        change_revision: 3,
      }],
      task_relations: [],
      attachments: [{ id: attachmentId, task_id: taskId, comment_id: null, kind: "attachment", filename: "note.txt", content_type: "text/plain", size: attachment.byteLength, created_at: "now", change_revision: 0, body_fallback: 1 }],
      project_readme_attachments: [],
      devices: [{ id: deviceId, name: "Kent Mac", token_hash: "a".repeat(64), status: "pending_pairing", last_heartbeat_at: null, last_status: null, created_at: "now", updated_at: "now" }],
      device_pairing_codes: [{ code: "INIT42", device_name: "Kent Mac", device_token: null, status: "pending", expires_at: "2099-01-01T00:00:00.000Z", created_at: "now", approved_at: null, device_id: deviceId }],
      device_project_mappings: [{ device_id: deviceId, project_id: projectId, workspace_path: "/Users/kent/Projects/taskboard", created_at: "now", updated_at: "now" }],
      device_task_worktrees: [{ device_id: deviceId, task_id: taskId, worktree_path: "/Users/kent/Projects/taskboard/worktrees/task-1", worktree_branch: "task-1", created_at: "now", updated_at: "now" }],
      device_automations: [{ device_id: deviceId, project_id: projectId, enabled_by_user: 1, quota_aware: 1, interval_minutes: 15, model: "gpt-6.1-sol", reasoning_effort: "high", created_at: "now", updated_at: "now" }],
    },
    attachments: [{
      id: attachmentId,
      projectId,
      objectKey: attachmentId,
      size: attachment.byteLength,
      sha256: createHash("sha256").update(attachment).digest("hex"),
      bodyBase64: attachment.toString("base64"),
    }],
  };
}

test("Sites imports the full Taskboard snapshot and accepts an identical retry once", async () => {
  const harness = await createCloudWorkerHarness({ siteMigrationEnabled: true });
  try {
    await harness.db.prepare("DELETE FROM projects WHERE id = 'local'").run();
    const bundle = migrationBundle();
    const first = await harness.request("/api/admin/migration/import", {
      method: "POST",
      actorName: "Migration",
      json: bundle,
    });
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, "imported");
    assert.equal(first.body.tableCounts.projects, 1);
    assert.equal(first.body.tableCounts.tasks, 1);
    assert.equal(first.body.tableCounts.task_activities, 1);
    assert.equal(first.body.tableCounts.comments, 1);
    assert.equal(first.body.tableCounts.devices, 1);
    assert.equal(first.body.tableCounts.device_automations, 1);
    assert.deepEqual(first.body.attachments, [{
      id: "attachment-1",
      size: Buffer.byteLength("sample attachment"),
      sha256: createHash("sha256").update("sample attachment").digest("hex"),
    }]);

    const task = await harness.db.prepare(
      "SELECT version, thread_codex_project_id, development_context_type, development_branch FROM tasks WHERE id = ?",
    ).bind("task-1").first();
    assert.deepEqual(task, {
      version: 4,
      thread_codex_project_id: "codex-project-1",
      development_context_type: "worktree",
      development_branch: "task-1",
    });
    const comment = await harness.db.prepare(
      "SELECT body, change_revision FROM comments WHERE id = ?",
    ).bind("comment-1").first();
    assert.deepEqual(comment, {
      body: "Preserve this comment and its thread binding.",
      change_revision: 3,
    });
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM site_migration_runs").first("count")), 1);

    const download = await harness.request("/api/attachments/attachment-1/download", {
      actorName: "Migration",
    });
    assert.equal(download.response.status, 200);
    assert.equal(download.body, "sample attachment");

    const retry = await harness.request("/api/admin/migration/import", {
      method: "POST",
      actorName: "Migration",
      json: bundle,
    });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.body.status, "already_imported");
    assert.equal(await harness.db.prepare("SELECT COUNT(*) AS count FROM tasks").first("count"), 1);
  } finally {
    await harness.dispose();
  }
});

test("Sites migration rejects unsupported non-empty task external metadata before writing", async () => {
  const harness = await createCloudWorkerHarness({ siteMigrationEnabled: true });
  try {
    const bundle = migrationBundle();
    bundle.tables.tasks[0].external_id = "remote-task-1";
    const rejected = await harness.request("/api/admin/migration/import", {
      method: "POST",
      actorName: "Migration",
      json: bundle,
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.error.code, "UNSUPPORTED_TASK_EXTERNAL_METADATA");
    assert.equal(await harness.db.prepare("SELECT COUNT(*) AS count FROM tasks").first("count"), 0);
  } finally {
    await harness.dispose();
  }
});
