import { useEffect, useState } from "react";
import {
  claimDevicePairingCode,
  requestDevicePairingCode,
} from "../api";

interface DevicePairingBootstrapProps {
  state: string;
  callbackUrl: string;
  deviceName: string;
}

function validateCallbackUrl(value: string, state: string): URL {
  const callback = new URL(value);
  if (
    callback.protocol !== "http:"
    || callback.hostname !== "127.0.0.1"
    || callback.username
    || callback.password
    || callback.search
    || callback.hash
    || callback.pathname !== `/device-pair/${state}`
  ) {
    throw new Error("本機配對回呼無效，請回到終端機重新開始。 / Invalid local pairing callback.");
  }
  return callback;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function DevicePairingBootstrap({
  state,
  callbackUrl,
  deviceName,
}: DevicePairingBootstrapProps) {
  const [pairingCode, setPairingCode] = useState("");
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState("請確認後開始配對。 / Start pairing when you are ready.");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!started) return;
    let cancelled = false;

    async function pairDevice() {
      try {
        const callback = validateCallbackUrl(callbackUrl, state);
        const pairing = await requestDevicePairingCode(deviceName);
        if (cancelled) return;
        setPairingCode(pairing.pairingCode);
        setMessage("請在主要裝置的「裝置管理」中核准此配對碼。 / Approve this code in Device Management on your main device.");

        const expiresAt = new Date(pairing.expiresAt).getTime();
        while (!cancelled && Date.now() < expiresAt) {
          await wait(2000);
          if (cancelled) return;
          const claim = await claimDevicePairingCode(pairing.pairingCode);
          if (claim.status === "pending") continue;
          if (claim.status === "rejected") {
            throw new Error("配對請求已被拒絕。 / The pairing request was rejected.");
          }
          if (
            !claim.deviceId
            || !claim.deviceToken
            || !claim.deviceName
          ) {
            throw new Error("配對回應缺少裝置憑證。 / The pairing response is missing device credentials.");
          }

          const response = await fetch(callback, {
            method: "POST",
            mode: "cors",
            credentials: "omit",
            headers: {
              "content-type": "application/json",
              "x-taskboard-pair-state": state,
            },
            body: JSON.stringify({
              state,
              siteUrl: window.location.origin,
              deviceId: claim.deviceId,
              deviceName: claim.deviceName,
              deviceToken: claim.deviceToken,
              siteAuthorizationToken: claim.siteAuthorizationToken ?? null,
            }),
          });
          if (!response.ok) {
            throw new Error("無法將配對憑證傳回本機程序。 / Could not deliver credentials to the local pairing process.");
          }
          setMessage("配對完成，可以關閉此頁面。 / Device paired. You can close this page.");
          return;
        }
        if (!cancelled) {
          throw new Error("配對碼已過期，請回到終端機重新開始。 / Pairing code expired. Restart pairing in the terminal.");
        }
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setMessage("配對未完成。 / Pairing did not complete.");
        setStarted(false);
      }
    }

    void pairDevice();
    return () => {
      cancelled = true;
    };
  }, [callbackUrl, deviceName, started, state]);

  return (
    <main style={{ maxWidth: 560, margin: "12vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>連接此裝置 / Connect this device</h1>
      <p>{message}</p>
      {!started && (
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setError("");
            setMessage("正在向任務面板申請配對… / Requesting device pairing…");
            setStarted(true);
          }}
        >
          {error ? "重新開始 / Try again" : "開始配對 / Start pairing"}
        </button>
      )}
      {pairingCode && (
        <p style={{ fontSize: 24, fontWeight: 700, letterSpacing: 3 }}>{pairingCode}</p>
      )}
      {error && <p role="alert" style={{ color: "#d44" }}>{error}</p>}
    </main>
  );
}
