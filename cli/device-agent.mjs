import { stat } from "node:fs/promises";
import path from "node:path";

// The launcher supplies the native App policy bridge. This controller never
// claims cards or infers completion from a child process exiting.
export async function runDeviceAgent({
  credentials,
  fetch: fetchFn = globalThis.fetch,
  applyAutomation,
  intervalSeconds = 30,
  once = false,
  stderr = process.stderr,
} = {}) {
  if (!credentials?.siteUrl || !credentials?.deviceId || !credentials?.deviceToken) {
    throw new Error("Device credentials are incomplete; pair this device again.");
  }
  if (typeof applyAutomation !== "function") {
    throw new Error("自動認領須由 Codex Taskboard App 執行。請開啟 App；不再使用獨立 Codex CLI 認領任務。");
  }
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 2_147_483) {
    throw new Error("Device heartbeat interval is invalid.");
  }
  let inFlight = false;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.deviceToken}`,
    ...(credentials.siteAuthorizationToken
      ? { "OAI-Sites-Authorization": `Bearer ${credentials.siteAuthorizationToken}` }
      : {}),
    "Content-Type": "application/json",
  };
  async function step() {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetchFn(`${credentials.siteUrl}/api/devices/${encodeURIComponent(credentials.deviceId)}/heartbeat`, {
        method: "POST", headers, body: JSON.stringify({ isRunning: false, currentTaskId: null }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? `Device heartbeat returned HTTP ${response.status}`);
      if (!Array.isArray(payload.automations)) throw new Error("Device heartbeat returned invalid automations");
      for (const automation of payload.automations) {
        if (!automation || typeof automation.projectId !== "string") throw new Error("Invalid device project automation");
        const workspacePath = automation.workspacePath;
        if (automation.enabledByUser) {
          try {
            if (!path.isAbsolute(workspacePath ?? "") || !(await stat(workspacePath)).isDirectory()) {
              throw new Error("請先設定此裝置的有效專案目錄");
            }
          } catch (error) {
            await applyAutomation({ ...automation, enabledByUser: false });
            stderr.write(`專案 ${automation.projectId} 未啟用：${error.message}\n`);
            continue;
          }
        }
        await applyAutomation(automation);
      }
      return { success: true, status: "native_policies_synchronized", projectIds: payload.automations.map((item) => item.projectId) };
    } finally {
      inFlight = false;
    }
  }
  if (once) return step();
  const timer = setInterval(() => {
    void step().catch((error) => stderr.write(`裝置排程同步失敗：${error.message}\n`));
  }, intervalSeconds * 1000);
  timer.unref?.();
  await step();
  return { stop: () => clearInterval(timer) };
}
