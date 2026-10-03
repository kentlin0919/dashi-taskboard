import { useEffect, useState } from "react";
import { useTaskboardI18n } from "../i18n";
import {
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

  async function loadData() {
    try {
      const [devList, reqList] = await Promise.all([
        fetchDevices(),
        fetchPairingRequests(),
      ]);
      setDevices(devList);
      setRequests(reqList);
    } catch (err) {
      // 忽略定時拉取錯誤
    }
  }

  useEffect(() => {
    if (!open) return;
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
        style={{ maxWidth: 640 }}
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

        {actionError && (
          <div className="callout callout-error" style={{ marginTop: 12 }}>
            {actionError}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {text("待確認的配對請求", "Pending Pairing Requests")}
          </h3>
          {requests.length === 0 ? (
            <div style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
              {text("目前沒有待處理的配對碼。在電腦終端機執行 `taskctl device pair --url <Site網址>` 開始配對。", "No pending requests. Run `taskctl device pair --url <SiteUrl>` on your computer.")}
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
                    background: "var(--color-bg-secondary)",
                    borderRadius: 6,
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {req.device_name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                      {text("配對碼", "Code")}: <strong style={{ letterSpacing: 1 }}>{req.pairing_code}</strong> · {text("有效期至", "Expires")}: {new Date(req.expires_at).toLocaleTimeString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="primary-button"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => handleApprove(req.pairing_code)}
                    >
                      {text("核准", "Approve")}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
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
        </div>

        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {text("已配對裝置", "Paired Devices")}
          </h3>
          {devices.length === 0 ? (
            <div style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
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
                      background: "var(--color-bg-secondary)",
                      borderRadius: 6,
                      border: "1px solid var(--color-border)",
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
                          <span style={{ fontSize: 11, color: "var(--color-text-danger)", border: "1px solid currentColor", borderRadius: 4, padding: "1px 4px" }}>
                            {text("已撤銷", "Revoked")}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>
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
                        className="danger-button"
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
          <button type="button" className="secondary-button" onClick={onClose}>
            {text("關閉", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
