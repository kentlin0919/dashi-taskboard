import { useEffect, useState } from "react";
import { useTaskboardI18n } from "../i18n";
import {
  ApiError,
  fetchDeviceCloudSession,
  fetchDevices,
  fetchPairingRequests,
  approvePairingRequest,
  rejectPairingRequest,
  revokeDevice,
  type Device,
  type PairingRequest,
} from "../api";

interface DeviceManagementDialogProps {
  open: boolean;
  onClose: () => void;
}

export function DeviceManagementDialog({
  open,
  onClose,
}: DeviceManagementDialogProps) {
  const { text } = useTaskboardI18n();
  const [devices, setDevices] = useState<Device[]>([]);
  const [requests, setRequests] = useState<PairingRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commandCopied, setCommandCopied] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [deviceSession, setDeviceSession] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pairingCommand = siteUrl ? `taskctl device pair --url ${JSON.stringify(siteUrl)}` : "";

  async function copyPairingCommand() {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(pairingCommand);
      setCommandCopied(true);
    } catch {
      setActionError(text("無法寫入剪貼簿，請選取下方指令後複製。", "Could not copy. Select and copy the command below."));
    }
  }

  async function loadData() {
    try {
      const [session, devList, reqList] = await Promise.all([
        fetchDeviceCloudSession(),
        fetchDevices(),
        fetchPairingRequests().catch((error) => {
          if (error instanceof ApiError && error.status === 403) return null;
          throw error;
        }),
      ]);
      const resolvedUrl = new URL(session.remoteUrl || document.baseURI);
      if (!["http:", "https:"].includes(resolvedUrl.protocol)) throw new Error(text("無法取得雲端網站網址。", "Could not resolve the cloud site URL."));
      setSiteUrl(resolvedUrl.origin);
      setDeviceSession(Boolean(session.deviceId) || reqList === null);
      setDevices(devList);
      setRequests(reqList ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!open) return;
    setCommandCopied(false);
    setLoading(true);
    loadData().finally(() => setLoading(false));
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, [open]);

  if (!open) return null;

  async function handleApprove(pairingCode: string) {
    setActionError(null);
    try {
      await approvePairingRequest(pairingCode);
      await loadData();
    } catch (err: any) {
      setActionError(err?.message ?? "核准失敗");
    }
  }

  async function handleReject(pairingCode: string) {
    setActionError(null);
    try {
      await rejectPairingRequest(pairingCode);
      await loadData();
    } catch (err: any) {
      setActionError(err?.message ?? "拒絕失敗");
    }
  }

  async function handleRevoke(deviceId: string) {
    setActionError(null);
    try {
      await revokeDevice(deviceId);
      await loadData();
    } catch (err: any) {
      setActionError(err?.message ?? "撤銷失敗");
    }
  }

  function isDeviceOnline(lastHeartbeat: string | null): boolean {
    if (!lastHeartbeat) return false;
    const diffMs = Date.now() - new Date(lastHeartbeat).getTime();
    return diffMs < 120_000; // 2 分鐘內視為在線
  }

  return (
    <div
      className="delete-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="delete-dialog project-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-management-title"
        style={{ width: "min(640px, 100%)", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="device-management-title" style={{ margin: 0 }}>
            {text("多裝置與配對管理", "Device Management")}
          </h2>
          <button
            type="button"
            className="detail-close-button"
            onClick={onClose}
            aria-label={text("關閉", "Close")}
          >
            ✕
          </button>
        </div>

        {loadError && <p role="alert" style={{ color: "var(--danger)", marginTop: 12 }}>{loadError}</p>}
        {deviceSession && siteUrl && <p style={{ marginTop: 12 }}>
          {text("目前以此裝置身分連線，只顯示這台電腦。配對核准與排程設定請在雲端網站登入後操作。", "Connected as this device. Sign in to the cloud site to manage pairing and schedules.")}
          {" "}<a href={siteUrl} target="_blank" rel="noreferrer">{text("開啟雲端管理", "Open cloud management")}</a>
        </p>}
        {actionError && (
          <div className="callout callout-error" style={{ marginTop: 12 }}>
            {actionError}
          </div>
        )}

        <div style={{ display: "block", marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {text("新增這台電腦", "Connect this computer")}
          </h3>
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            {text("先開啟 Codex Taskboard APP，再複製指令到這台電腦的終端機執行。瀏覽器會開啟目前網站，按下「配對這台電腦」後自動完成配對。", "Open the Codex Taskboard app, then run this command in this computer's terminal. Your browser will open this site. Confirm Pair this computer to finish automatically.")}
          </p>
          <textarea
            aria-label={text("裝置配對指令", "Device pairing command")}
            readOnly
            value={pairingCommand}
            rows={3}
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: "100%", boxSizing: "border-box", resize: "none", fontFamily: "monospace", fontSize: 13, padding: 10, borderRadius: 6, background: "var(--surface)", color: "var(--text-primary)", border: "1px solid var(--border-strong)" }}
          />
          <button type="button" className="button primary" disabled={!pairingCommand} onClick={copyPairingCommand} style={{ marginTop: 8 }}>
            {commandCopied ? text("已複製", "Copied") : text("複製配對指令", "Copy pairing command")}
          </button>
        </div>

        {!deviceSession && <div style={{ display: "block", marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {text("待確認的配對請求", "Pending Pairing Requests")}
          </h3>
          {requests.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              {text("目前沒有待處理的配對碼，請使用上方指令開始配對。", "No pending requests. Use the command above to start pairing.")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {requests.map((req) => (
                <div
                  key={req.pairing_code}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "var(--surface)",
                    borderRadius: 6,
                    border: "1px solid var(--border-strong)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {req.device_name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {text("配對碼", "Code")}: <strong style={{ letterSpacing: 1 }}>{req.pairing_code}</strong> · {text("有效期至", "Expires")}: {new Date(req.expires_at).toLocaleTimeString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="button primary"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => handleApprove(req.pairing_code)}
                    >
                      {text("核准", "Approve")}
                    </button>
                    <button
                      type="button"
                      className="button danger"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => handleReject(req.pairing_code)}
                    >
                      {text("拒絕", "Reject")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>}

        <div style={{ display: "block", marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {text("已配對裝置", "Paired Devices")}
          </h3>
          {loading ? <p>{text("正在讀取裝置…", "Loading devices…")}</p> : loadError ? null : devices.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              {text("尚未配對任何裝置。", "No paired devices.")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {devices.map((device) => {
                const online = isDeviceOnline(device.last_heartbeat_at);
                const isRunning = Boolean(device.last_status?.isRunning);
                const currentTaskId = device.last_status?.currentTaskId;
                const isRevoked = device.status === "revoked";

                return (
                  <div
                    key={device.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      background: "var(--surface)",
                      borderRadius: 6,
                      border: "1px solid var(--border-strong)",
                      opacity: isRevoked ? 0.6 : 1,
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: isRevoked ? "#888" : online ? "#10b981" : "#f59e0b",
                            display: "inline-block",
                          }}
                        />
                        <strong style={{ fontSize: 14 }}>{device.name}</strong>
                        {isRevoked && (
                          <span style={{ fontSize: 11, color: "var(--danger)", border: "1px solid currentColor", borderRadius: 4, padding: "1px 4px" }}>
                            {text("已撤銷", "Revoked")}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                        <span>ID: {device.id}</span>
                        {" · "}
                        <span>
                          {isRevoked
                            ? text("憑證無效", "Invalid")
                            : online
                              ? isRunning
                                ? text(`正在執行任務：${currentTaskId ?? "處理中"}`, `Running: ${currentTaskId ?? "in progress"}`)
                                : text("在線（待命）", "Online (Idle)")
                              : text("離線", "Offline")}
                        </span>
                        {device.last_heartbeat_at && (
                          <span> · {text("最後心跳", "Heartbeat")}: {new Date(device.last_heartbeat_at).toLocaleTimeString()}</span>
                        )}
                      </div>
                    </div>
                    {!isRevoked && (
                      <button
                        type="button"
                        className="button danger"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => handleRevoke(device.id)}
                      >
                        {text("撤銷", "Revoke")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
          <button type="button" className="button" onClick={onClose}>
            {text("關閉", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
