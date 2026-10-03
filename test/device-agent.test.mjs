import assert from "node:assert/strict";
import { test } from "node:test";
import { runDeviceAgent } from "../cli/device-agent.mjs";

function response(status, payload = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeHarness({ claimStatus = 200 } = {}) {
  const calls = [];
  let task = {
    id: "task-1",
    identifier: "TB-1",
    projectId: "project-1",
    title: "Repair the connection",
    description: "Reconnect after the Site tab resumes.",
    status: "todo",
    version: 1,
    archivedAt: null,
    threadBinding: null,
  };
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, headers: new Headers(init.headers), body });
    if (url.pathname.endsWith("/heartbeat")) {
      return response(200, {
        automations: [{
          projectId: "project-1",
          enabledByUser: true,
          intervalMinutes: 5,
          workspacePath: process.cwd(),
        }],
      });
    }
    if (url.pathname === "/api/tasks") return response(200, { tasks: [task] });
    if (url.pathname === "/api/tasks/task-1" && method === "GET") {
      return response(200, { task });
    }
    if (url.pathname === "/api/tasks/task-1/move") {
      if (claimStatus !== 200) return response(claimStatus, { error: { message: "version conflict" } });
      task = { ...task, status: body.status, version: body.version + 1 };
      return response(200, { task });
    }
    if (url.pathname === "/api/tasks/task-1/comments") {
      if (method === "POST") return response(201, { comment: {} });
      return response(200, { comments: [] });
    }
    if (url.pathname === "/api/tasks/task-1/attachments") {
      return response(200, { attachments: [] });
    }
    if (url.pathname === "/api/projects") {
      return response(200, { projects: [{ id: "project-1", name: "Taskboard" }] });
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  };
  return { calls, fetch, get task() { return task; } };
}

test("device agent claims with version guard before starting Codex and completes into review", async () => {
  const harness = makeHarness();
  const started = [];
  await runDeviceAgent({
    credentials: {
      siteUrl: "https://taskboard.example.test",
      deviceId: "device-1",
      deviceToken: "device-token",
      siteAuthorizationToken: "site-token",
    },
    fetch: harness.fetch,
    once: true,
    stderr: { write() {} },
    runCodex: async (input) => {
      started.push(input.task.identifier);
      return { success: true, summary: "Updated the reconnect path." };
    },
  });

  assert.deepEqual(started, ["TB-1"]);
  assert.equal(harness.task.status, "in_review");
  const claim = harness.calls.find((call) => call.url.pathname.endsWith("/move"));
  assert.deepEqual(claim.body, { status: "in_progress", version: 1 });
  assert.equal(claim.headers.get("authorization"), "Bearer device-token");
  assert.equal(claim.headers.get("oai-sites-authorization"), "Bearer site-token");
});

test("device agent does not start Codex when another client wins the version-guarded claim", async () => {
  const harness = makeHarness({ claimStatus: 409 });
  let started = false;
  await runDeviceAgent({
    credentials: {
      siteUrl: "https://taskboard.example.test",
      deviceId: "device-1",
      deviceToken: "device-token",
    },
    fetch: harness.fetch,
    once: true,
    stderr: { write() {} },
    runCodex: async () => { started = true; return { success: true }; },
  });

  assert.equal(started, false);
  assert.equal(harness.task.status, "todo");
  const runningHeartbeat = harness.calls.some((call) => (
    call.url.pathname.endsWith("/heartbeat") && call.body?.isRunning === true
  ));
  assert.equal(runningHeartbeat, false);
});
