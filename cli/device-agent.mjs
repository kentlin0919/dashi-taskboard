import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCodexExecutable } from "../shared/codex-executable.mjs";
import {
  buildCodexArgs,
  buildCodexPrompt,
  normalizeCodexEvent,
  spawnCodexTurn,
} from "../server/ai-chat-process.mjs";

const MANAGE_TASKBOARD_SKILL_PATH = fileURLToPath(
  new URL("../skills/manage-taskboard/SKILL.md", import.meta.url),
);

function requestHeaders(credentials, { json = false } = {}) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.deviceToken}`,
    ...(credentials.siteAuthorizationToken
      ? { "OAI-Sites-Authorization": `Bearer ${credentials.siteAuthorizationToken}` }
      : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function taskBinding(task) {
  return task?.threadBinding ?? task?.thread_binding ?? task?.threadId ?? task?.thread_id;
}

function taskStatus(task) {
  return task?.status;
}

function apiError(payload, status) {
  const message = payload?.error?.message ?? `Taskboard returned HTTP ${status}`;
  const error = new Error(message);
  error.status = status;
  error.code = payload?.error?.code ?? `HTTP_${status}`;
  return error;
}

async function readJson(response) {
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Taskboard returned an invalid JSON response");
  }
  return payload;
}

async function apiRequest(fetchFn, credentials, pathname, { method = "GET", body } = {}) {
  const response = await fetchFn(`${credentials.siteUrl}${pathname}`, {
    method,
    headers: requestHeaders(credentials, { json: body !== undefined }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.status === 204 ? {} : await readJson(response);
  if (!response.ok) throw apiError(payload, response.status);
  return payload;
}

async function loadTaskComments(fetchFn, credentials, taskId) {
  const result = await apiRequest(
    fetchFn,
    credentials,
    `/api/tasks/${encodeURIComponent(taskId)}/comments`,
  );
  return Array.isArray(result.comments) ? result.comments : [];
}

function safeFilename(value) {
  const filename = path.basename(typeof value === "string" ? value : "attachment");
  return filename.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_") || "attachment";
}

async function downloadTaskAttachments(fetchFn, credentials, taskId) {
  const result = await apiRequest(
    fetchFn,
    credentials,
    `/api/tasks/${encodeURIComponent(taskId)}/attachments`,
  );
  const attachments = Array.isArray(result.attachments) ? result.attachments : [];
  if (attachments.length === 0) return { directory: null, paths: [], imagePaths: [] };

  const directory = await mkdtemp(path.join(os.tmpdir(), "taskboard-device-"));
  const paths = [];
  const imagePaths = [];
  try {
    for (const attachment of attachments) {
      const id = attachment?.id;
      if (typeof id !== "string" || !id) continue;
      const response = await fetchFn(
        `${credentials.siteUrl}/api/attachments/${encodeURIComponent(id)}/download`,
        { headers: requestHeaders(credentials) },
      );
      if (!response.ok) throw apiError(await readJson(response), response.status);
      const filePath = path.join(directory, `${id}-${safeFilename(attachment.filename)}`);
      await writeFile(filePath, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
      paths.push(filePath);
      if (String(attachment.contentType ?? "").startsWith("image/")) imagePaths.push(filePath);
    }
    return { directory, paths, imagePaths };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function taskPrompt(task, comments) {
  const commentText = comments.length === 0
    ? "(No comments)"
    : comments.map((comment) => (
      `### ${comment.authorName ?? comment.author_name ?? "Comment"}\n${comment.body ?? ""}`
    )).join("\n\n");
  return [
    "Complete this Taskboard task in the selected local project workspace.",
    `Task ID: ${task.identifier ?? task.id}`,
    `Title: ${task.title ?? ""}`,
    "Description:",
    task.description ?? "",
    "Comments:",
    commentText,
    "Inspect the project instructions, relevant code, and attached files before editing. Keep changes within this workspace, preserve existing user changes, and report the files changed, verification run, and any remaining blocker. Do not alter Taskboard status or add Taskboard comments; the local controller records the result.",
  ].join("\n\n");
}

async function runCodexTask({ task, comments, automation, workspacePath, attachments }) {
  const thread = {
    sandbox: "workspace-write",
    model: automation.model || undefined,
    reasoningEffort: automation.reasoningEffort ?? automation.reasoning_effort ?? undefined,
    origin: {
      projectId: task.projectId ?? task.project_id ?? automation.projectId ?? automation.project_id,
      projectName: task.projectName ?? task.project_name ?? automation.projectId ?? automation.project_id,
      workspacePath,
      issueIdentifier: task.identifier ?? task.id,
    },
  };
  const args = buildCodexArgs(thread, attachments.directory ? [attachments.directory] : [], attachments.imagePaths);
  const prompt = buildCodexPrompt({
    ...thread,
    origin: { ...thread.origin, projectId: thread.origin.projectId ?? "taskboard" },
  }, {
    message: taskPrompt(task, comments),
    skills: [],
    attachmentPaths: attachments.paths,
  }, process.env.CODEX_TASKBOARD_SKILL_PATH || MANAGE_TASKBOARD_SKILL_PATH);

  const childEnv = { ...process.env };
  for (const key of [
    "CODEX_TASKBOARD_DEVICE_TOKEN",
    "OAI_SITES_AUTHORIZATION",
    "TASKBOARD_SITE_BYPASS_TOKEN",
  ]) delete childEnv[key];

  let completedTurn = false;
  let failedTurn = "";
  let summary = "";
  const { completion } = spawnCodexTurn({
    executable: resolveCodexExecutable(),
    args,
    prompt,
    env: childEnv,
    onRawEvent(raw) {
      const event = normalizeCodexEvent(raw);
      if (event?.kind !== "event") return;
      if (event.type === "turn.completed") completedTurn = true;
      if (event.type === "turn.failed") failedTurn = event.content || "Codex turn failed";
      if (event.type === "agent_message" && event.role === "assistant" && event.content) {
        summary = event.content;
      }
    },
  });
  const result = await completion;
  if (result.exitCode !== 0 || result.signal || failedTurn || !completedTurn) {
    return {
      success: false,
      summary: failedTurn || `Codex exited before completing the task (exit ${result.exitCode ?? result.signal ?? "unknown"}).`,
    };
  }
  return { success: true, summary: summary || "Codex completed the task." };
}

export async function runDeviceAgent({
  credentials,
  fetch: fetchFn = globalThis.fetch,
  runCodex = runCodexTask,
  intervalSeconds = 30,
  once = false,
  stderr = process.stderr,
} = {}) {
  if (!credentials?.siteUrl || !credentials?.deviceId || !credentials?.deviceToken) {
    throw new Error("Device credentials are incomplete; pair this device again.");
  }
  let isRunning = false;
  let currentTaskId = null;
  let stepInFlight = false;
  const lastExecutionTimes = new Map();

  async function sendHeartbeat(running, taskId) {
    return apiRequest(fetchFn, credentials, `/api/devices/${encodeURIComponent(credentials.deviceId)}/heartbeat`, {
      method: "POST",
      body: { isRunning: running, currentTaskId: taskId },
    });
  }

  async function recordResult(task, result) {
    const taskPath = `/api/tasks/${encodeURIComponent(task.id)}`;
    const body = result.success
      ? `Codex completed this task on the paired device.\n\n${result.summary}`
      : `Codex could not complete this task on the paired device.\n\n${result.summary}`;
    await apiRequest(fetchFn, credentials, `${taskPath}/comments`, {
      method: "POST",
      body: { body },
    });

    const latest = await apiRequest(fetchFn, credentials, taskPath);
    if (taskStatus(latest.task) !== "in_progress") return;
    const changedDuringRun = latest.task.title !== task.title
      || latest.task.description !== task.description;
    const status = result.success && !changedDuringRun ? "in_review" : "blocked";
    const message = changedDuringRun
      ? "The task description changed during execution. Review the latest request before continuing."
      : status === "blocked"
        ? "Codex did not complete the task. Review the execution result and resume when the blocker is resolved."
        : null;
    if (message) {
      await apiRequest(fetchFn, credentials, `${taskPath}/comments`, {
        method: "POST",
        body: { body: message },
      });
    }
    const beforeMove = message
      ? await apiRequest(fetchFn, credentials, taskPath)
      : latest;
    if (taskStatus(beforeMove.task) !== "in_progress") return;
    await apiRequest(fetchFn, credentials, `${taskPath}/move`, {
      method: "POST",
      body: { status, version: beforeMove.task.version },
    });
  }

  async function runAutomation(automation) {
    const projectId = automation.projectId ?? automation.project_id;
    const workspacePath = automation.workspacePath ?? automation.workspace_path;
    if (typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)) {
      stderr.write(`專案 ${projectId} 尚未設定此裝置的工作目錄，略過自動認領。\n`);
      return;
    }
    try {
      if (!(await stat(workspacePath)).isDirectory()) {
        stderr.write(`專案 ${projectId} 的本機工作目錄不存在，略過自動認領。\n`);
        return;
      }
    } catch {
      stderr.write(`無法讀取專案 ${projectId} 的本機工作目錄，略過自動認領。\n`);
      return;
    }

    const tasksResult = await apiRequest(
      fetchFn,
      credentials,
      `/api/tasks?projectId=${encodeURIComponent(projectId)}&status=todo`,
    );
    const todoTasks = Array.isArray(tasksResult.tasks) ? tasksResult.tasks : [];
    for (const candidate of todoTasks) {
      if (taskBinding(candidate) || candidate.archivedAt != null || candidate.archived_at != null) continue;
      const taskId = candidate.id;
      if (typeof taskId !== "string" || !taskId) continue;
      const detailResult = await apiRequest(fetchFn, credentials, `/api/tasks/${encodeURIComponent(taskId)}`);
      const task = detailResult.task;
      if (
        !task
        || taskStatus(task) !== "todo"
        || taskBinding(task)
        || !Number.isSafeInteger(task.version)
      ) continue;

      let claimResponse;
      try {
        claimResponse = await fetchFn(`${credentials.siteUrl}/api/tasks/${encodeURIComponent(task.id)}/move`, {
          method: "POST",
          headers: requestHeaders(credentials, { json: true }),
          body: JSON.stringify({ status: "in_progress", version: task.version }),
        });
      } catch (error) {
        throw error;
      }
      if (claimResponse.status === 409) continue;
      const claimPayload = claimResponse.status === 204 ? {} : await readJson(claimResponse);
      if (!claimResponse.ok) throw apiError(claimPayload, claimResponse.status);
      const ownedTask = claimPayload.task;
      if (!ownedTask || taskStatus(ownedTask) !== "in_progress") {
        throw new Error("Taskboard did not confirm the version-guarded claim");
      }

      isRunning = true;
      currentTaskId = task.identifier ?? task.id;
      lastExecutionTimes.set(projectId, Date.now());
      stderr.write(`已認領 ${currentTaskId}，啟動本機 Codex。\n`);
      const pulse = setInterval(() => {
        void sendHeartbeat(true, currentTaskId).catch((error) => {
          stderr.write(`裝置心跳暫時失敗：${error.message}\n`);
        });
      }, Math.max(5, intervalSeconds) * 1000);
      pulse.unref?.();

      let attachments = { directory: null, paths: [], imagePaths: [] };
      let result;
      try {
        await sendHeartbeat(true, currentTaskId).catch((error) => {
          stderr.write(`裝置心跳暫時失敗：${error.message}\n`);
        });
        const [comments, downloaded] = await Promise.all([
          loadTaskComments(fetchFn, credentials, task.id),
          downloadTaskAttachments(fetchFn, credentials, task.id),
        ]);
        attachments = downloaded;
        result = await runCodex({
          task,
          comments,
          automation,
          workspacePath,
          attachments,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`任務 ${currentTaskId} 執行失敗：${message}\n`);
        result = { success: false, summary: message };
      }
      try {
        await recordResult(task, result ?? { success: false, summary: "Codex returned no result." });
      } catch (error) {
        stderr.write(`無法回寫任務結果：${error instanceof Error ? error.message : String(error)}\n`);
      } finally {
        clearInterval(pulse);
        if (attachments.directory) await rm(attachments.directory, { recursive: true, force: true });
        isRunning = false;
        currentTaskId = null;
        await sendHeartbeat(false, null).catch((error) => {
          stderr.write(`無法送出待命心跳：${error.message}\n`);
        });
      }
      return;
    }
  }

  async function step() {
    if (stepInFlight) return;
    stepInFlight = true;
    try {
      const heartbeat = await sendHeartbeat(isRunning, currentTaskId);
      const automations = Array.isArray(heartbeat.automations) ? heartbeat.automations : [];
      if (isRunning) return;
      for (const automation of automations) {
        if (!(automation.enabledByUser ?? automation.enabled_by_user)) continue;
        const projectId = automation.projectId ?? automation.project_id;
        const intervalMinutes = automation.intervalMinutes ?? automation.interval_minutes ?? 5;
        const lastRun = lastExecutionTimes.get(projectId) ?? 0;
        if (lastRun > 0 && Date.now() - lastRun < intervalMinutes * 60 * 1000) continue;
        await runAutomation(automation);
        if (isRunning) return;
      }
    } finally {
      stepInFlight = false;
    }
  }

  if (once) {
    await step();
    return { success: true, status: "completed_once" };
  }

  const interval = Math.max(1, intervalSeconds);
  stderr.write(`裝置 Agent 啟動，每 ${interval} 秒檢查一次自動認領排程。\n`);
  const timer = setInterval(() => {
    void step().catch((error) => stderr.write(`裝置 Agent 錯誤：${error.message}\n`));
  }, interval * 1000);
  void step().catch((error) => stderr.write(`裝置 Agent 錯誤：${error.message}\n`));
  return new Promise(() => {});
}
