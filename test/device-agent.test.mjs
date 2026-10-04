import assert from "node:assert/strict";
import { test } from "node:test";
import { runDeviceAgent } from "../cli/device-agent.mjs";

function response(status, payload = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeHarness(automations) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, headers: new Headers(init.headers), body });
    if (url.pathname.endsWith("/heartbeat")) return response(200, { automations });
    throw new Error(`Unexpected card mutation or request: ${url.pathname}`);
  };
  return { calls, fetch };
}

const credentials = {
  siteUrl: "https://taskboard.example.test",
  deviceId: "device-1",
  deviceToken: "device-token",
  siteAuthorizationToken: "site-token",
};

const automation = {
  projectId: "project-1", enabledByUser: true, quotaAware: true,
  intervalMinutes: 5, workspacePath: process.cwd(),
};

test("device controller synchronizes native policies without claiming cards or inferring completion", async () => {
  const harness = makeHarness([automation]);
  const policies = [];
  const result = await runDeviceAgent({
    credentials, fetch: harness.fetch, once: true, stderr: { write() {} },
    applyAutomation: async (input) => { policies.push(input); },
  });
  assert.equal(result.success, true);
  assert.deepEqual(policies, [automation]);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].headers.get("authorization"), "Bearer device-token");
  assert.equal(harness.calls[0].headers.get("oai-sites-authorization"), "Bearer site-token");
  assert.equal(harness.calls[0].body.status.isRunning, null);
});

test("one invalid native policy does not pause a different project's valid schedule", async () => {
  const second = { ...automation, projectId: "project-2" };
  const harness = makeHarness([automation, second]);
  const policies = [];
  const result = await runDeviceAgent({
    credentials, fetch: harness.fetch, once: true, stderr: { write() {} },
    applyAutomation: async (input) => {
      policies.push(input);
      if (input.projectId === "project-1" && input.enabledByUser) throw new Error("Project is not mapped in Codex");
    },
  });
  assert.equal(result.success, false);
  assert.deepEqual(result.failures, ["project-1"]);
  assert.deepEqual(policies.map((item) => [item.projectId, item.enabledByUser]), [
    ["project-1", true], ["project-1", false], ["project-2", true],
  ]);
  assert.equal(harness.calls.length, 1);
});
