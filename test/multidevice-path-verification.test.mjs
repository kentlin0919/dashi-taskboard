import assert from "node:assert/strict";
import { test } from "node:test";
import { createCloudWorkerHarness } from "./helpers/cloud-worker-harness.mjs";

test("direct operation path: pair request -> approve -> claim -> heartbeat -> automation query -> revoke", async () => {
  const harness = await createCloudWorkerHarness({
    siteBypassToken: "test-site-bypass-token",
    siteAuthEnabled: true,
  });
  try {
    const siteOwnerHeaders = {
      "oai-authenticated-user-id": "site-user-1",
      "oai-authenticated-user-email": "kent@example.test",
    };
    // 1. 裝置發起配對請求（無需登入）
    const pairReq = await harness.request("/api/devices/pair/request", {
      method: "POST",
      json: { deviceName: "MacBook Pro M3" },
    });
    assert.equal(pairReq.response.status, 200);
    assert.ok(pairReq.body.pairingCode);
    const { pairingCode } = pairReq.body;

    // 2. 管理者在面板查詢待核准請求（需管理者身分）
    const pendingReq = await harness.request("/api/devices/pair/requests", {
      headers: siteOwnerHeaders,
    });
    assert.equal(pendingReq.response.status, 200);
    assert.ok(pendingReq.body.requests.some((r) => r.pairing_code === pairingCode));

    // 3. 管理者在面板核准配對碼
    const approveReq = await harness.request("/api/devices/pair/approve", {
      method: "POST",
      headers: siteOwnerHeaders,
      json: { pairingCode },
    });
    assert.equal(approveReq.response.status, 200);
    assert.equal(approveReq.body.success, true);

    // 4. 裝置換取 token（使用配對碼）
    const claimReq = await harness.request("/api/devices/pair/claim", {
      method: "POST",
      headers: siteOwnerHeaders,
      json: { pairingCode },
    });
    assert.equal(claimReq.response.status, 200);
    assert.ok(claimReq.body.deviceId);
    assert.ok(claimReq.body.deviceToken);
    assert.equal(claimReq.body.siteAuthorizationToken, "test-site-bypass-token");
    const { deviceId, deviceToken } = claimReq.body;

    // 4b. 重複領取必須原子性遭拒 (400)
    const repeatedClaim = await harness.request("/api/devices/pair/claim", {
      method: "POST",
      json: { pairingCode },
    });
    assert.equal(repeatedClaim.response.status, 400);

    // 4c. 裝置 bearer 不得管理其他裝置、配對或排程 (403)
    const forbiddenPairList = await harness.request("/api/devices/pair/requests", {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    assert.equal(forbiddenPairList.response.status, 403);

    const forbiddenDevList = await harness.request("/api/devices", {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    assert.equal(forbiddenDevList.response.status, 403);

    // 5. 裝置以 Bearer Token 發送心跳（回報任務正在執行）
    const runningHeartbeat = await harness.request(`/api/devices/${deviceId}/heartbeat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceToken}`,
      },
      json: { isRunning: true, currentTaskId: "LOCAL-101" },
    });
    assert.equal(runningHeartbeat.response.status, 200);

    // 6. 管理者查核裝置列表，確認即時呈現正在執行狀態
    const devListReq = await harness.request("/api/devices", {
      headers: siteOwnerHeaders,
    });
    assert.equal(devListReq.response.status, 200);
    const currentDev = devListReq.body.devices.find((d) => d.id === deviceId);
    assert.ok(currentDev);
    const lastStatus = typeof currentDev.last_status === "string"
      ? JSON.parse(currentDev.last_status)
      : currentDev.last_status;
    assert.equal(lastStatus.isRunning, true);
    assert.equal(lastStatus.currentTaskId, "LOCAL-101");

    const ping = await harness.request(`/api/devices/${deviceId}/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${deviceToken}` },
      json: { ping: true },
    });
    assert.equal(ping.response.status, 200);
    const afterPing = await harness.request("/api/devices", { headers: siteOwnerHeaders });
    const statusAfterPing = afterPing.body.devices.find((d) => d.id === deviceId).last_status;
    assert.equal(statusAfterPing.isRunning, true);
    assert.equal(statusAfterPing.currentTaskId, "LOCAL-101");

    // 7. 裝置任務執行完畢，心跳重設為待命
    const idleHeartbeat = await harness.request(`/api/devices/${deviceId}/heartbeat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceToken}`,
      },
      json: { isRunning: false, currentTaskId: null },
    });
    assert.equal(idleHeartbeat.response.status, 200);

    const devListReq2 = await harness.request("/api/devices", {
      headers: siteOwnerHeaders,
    });
    const currentDev2 = devListReq2.body.devices.find((d) => d.id === deviceId);
    const lastStatus2 = typeof currentDev2.last_status === "string"
      ? JSON.parse(currentDev2.last_status)
      : currentDev2.last_status;
    assert.equal(lastStatus2.isRunning, false);
    assert.equal(lastStatus2.currentTaskId, null);

    // 8. 管理者撤銷裝置
    const revokeReq = await harness.request(`/api/devices/${deviceId}/revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    assert.equal(revokeReq.response.status, 200);

    // 9. 裝置憑證已被撤銷，心跳遭拒絕 (401)
    const rejectedHeartbeat = await harness.request(`/api/devices/${deviceId}/heartbeat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceToken}`,
      },
      json: { isRunning: false },
    });
    assert.equal(rejectedHeartbeat.response.status, 401);
  } finally {
    await harness.dispose();
  }
});

test("pairing reconnects the unique migrated pending device and preserves its local project mapping", async () => {
  const harness = await createCloudWorkerHarness({
    siteBypassToken: "test-site-bypass-token",
    siteAuthEnabled: true,
  });
  try {
    const timestamp = new Date().toISOString();
    await harness.db.prepare(`
      INSERT INTO devices (id, name, token_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending_pairing', ?, ?)
    `).bind("migrated-mac", "Kent Mac", "migrated-token-hash", timestamp, timestamp).run();
    await harness.db.prepare(`
      INSERT INTO device_project_mappings (device_id, project_id, workspace_path, created_at, updated_at)
      VALUES (?, 'local', ?, ?, ?)
    `).bind("migrated-mac", "/Users/kent/project/example", timestamp, timestamp).run();
    await harness.db.prepare(`
      INSERT INTO device_automations (device_id, project_id, enabled_by_user, quota_aware, interval_minutes, model, reasoning_effort, created_at, updated_at)
      VALUES (?, 'local', 1, 0, 5, '', '', ?, ?)
    `).bind("migrated-mac", timestamp, timestamp).run();

    const siteOwnerHeaders = {
      "oai-authenticated-user-id": "site-user-1",
      "oai-authenticated-user-email": "kent@example.test",
    };
    const pairing = await harness.request("/api/devices/pair/request", {
      method: "POST",
      json: { deviceName: "Kent Mac" },
    });
    assert.equal(pairing.response.status, 200);

    const approved = await harness.request("/api/devices/pair/approve", {
      method: "POST",
      headers: siteOwnerHeaders,
      json: { pairingCode: pairing.body.pairingCode },
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.deviceId, "migrated-mac");

    const claimed = await harness.request("/api/devices/pair/claim", {
      method: "POST",
      headers: siteOwnerHeaders,
      json: { pairingCode: pairing.body.pairingCode },
    });
    assert.equal(claimed.response.status, 200);
    const heartbeat = await harness.request("/api/devices/migrated-mac/heartbeat", {
      method: "POST",
      headers: { authorization: `Bearer ${claimed.body.deviceToken}` },
      json: { ping: true },
    });
    assert.equal(heartbeat.response.status, 200);
    assert.equal(heartbeat.body.automations.length, 1);
    assert.equal(heartbeat.body.automations[0].workspacePath, "/Users/kent/project/example");
    assert.equal(heartbeat.body.automations[0].enabledByUser, true);
  } finally {
    await harness.dispose();
  }
});
