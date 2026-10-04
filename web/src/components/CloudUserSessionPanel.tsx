import { useEffect, useRef, useState } from "react";
import {
  approveCloudUserLogin, claimCloudUserLogin, getCloudActor, getCloudLoginRequest,
  getCloudUserSession, logoutCloudUser, startCloudUserLogin,
  type CloudUserSession,
} from "../api";
import type { ActorIdentity } from "../types";
import { useTaskboardI18n } from "../i18n";

export function CloudUserSessionPanel({ local, cloud, onActorChange }: {
  local: boolean; cloud: boolean; onActorChange: (actor: ActorIdentity | null) => void;
}) {
  const { text } = useTaskboardI18n();
  const [session, setSession] = useState<CloudUserSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<Awaited<ReturnType<typeof getCloudLoginRequest>> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const loginId = !local ? new URLSearchParams(window.location.search).get("deviceLogin") : null;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  function receive(next: CloudUserSession) {
    setSession(next);
    onActorChange(next.actor);
  }

  useEffect(() => {
    if (!cloud) return;
    let disposed = false;
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        if (local) {
          const next = sessionRef.current?.pending ? await claimCloudUserLogin() : await getCloudUserSession();
          if (!disposed) {
            receive(next);
            if (!next.available) {
              const { actor } = await getCloudActor();
              if (!disposed) onActorChange(actor.type === "user" ? actor : null);
            }
            setError(null);
          }
        } else {
          const { actor } = await getCloudActor();
          if (!disposed) onActorChange(actor.type === "user" ? actor : null);
        }
      } catch (failure) {
        if (!disposed) {
          onActorChange(null);
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      } finally { inFlight = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [local, cloud, onActorChange]);

  useEffect(() => {
    if (!cloud || !loginId) return;
    let disposed = false;
    getCloudLoginRequest(loginId).then((next) => { if (!disposed) setLogin(next); })
      .catch((failure) => { if (!disposed) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { disposed = true; };
  }, [cloud, loginId]);

  async function act(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }

  if (!cloud || (!local && !loginId) || (local && session && !session.available)) return null;
  const panelStyle = {
    padding: 16, background: "var(--surface)", color: "var(--text-primary)",
    border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 8px 32px #0005",
  };
  return <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 3000, maxWidth: "calc(100vw - 32px)", width: 360 }}>
    {local && <button className="button" type="button" onClick={() => setOpen(!open)}>
      {session?.actor ? text(`雲端帳號 · ${session.actor.name}`, `Cloud account · ${session.actor.name}`) : text("登入雲端帳號", "Sign in to cloud account")}
    </button>}
    {(open || loginId) && <section style={panelStyle} aria-label={text("雲端帳號登入", "Cloud account sign-in")}>
      {local ? <>
        <h3>{text("人工操作帳號", "Account for manual actions")}</h3>
        <p>{session?.actor?.name ?? text("尚未登入。人工留言與修改需要登入，Agent 繼續使用裝置身分。", "Sign in for manual comments and changes. Agents continue using the device identity.")}</p>
        {session?.expiresAt && session.actor && <p>{text("有效期至", "Expires")} {new Date(session.expiresAt).toLocaleString()}</p>}
        {session?.pending && <>
          <p>{text("請在雲端確認同一裝置與登入碼", "Confirm this device and code on the cloud website")} <strong>{session.pending.code}</strong></p>
          <a className="button primary" href={session.pending.verificationUrl} target="_blank" rel="noreferrer">{text("開啟雲端確認", "Open cloud confirmation")}</a>
          <p>{text("等待確認，完成後會自動登入。", "Waiting for confirmation; sign-in completes automatically.")}</p>
        </>}
        {!session?.pending && <button type="button" className="button primary" disabled={busy} onClick={() => void act(async () => {
          receive(session?.actor ? await logoutCloudUser() : await startCloudUserLogin());
        })}>{session?.actor ? text("登出人工帳號", "Sign out") : text("開始登入", "Start sign-in")}</button>}
        <button type="button" className="button" onClick={() => setOpen(false)}>{text("關閉", "Close")}</button>
      </> : <>
        <h3>{text("確認 APP 人工登入", "Confirm App sign-in")}</h3>
        {login && <>
          <p>{text("裝置", "Device")} · {login.deviceName}</p>
          <p>{text("登入碼", "Code")} · <strong>{login.code}</strong></p>
          <p>{text("帳號", "Account")} · {login.actor.name}</p>
          <p>{text("請確認 APP 顯示相同登入碼。允許此 APP 在 24 小時內以你的帳號留言及修改任務。", "Check that the App shows this code. Allow this App to comment and change tasks as your account for 24 hours.")}</p>
          {confirmed || login.status !== "pending" ? <p role="status">{text("已確認，請回到 APP。", "Confirmed. Return to the App.")}</p>
            : <button type="button" className="button primary" disabled={busy} onClick={() => void act(async () => {
              await approveCloudUserLogin(loginId!, login.code); setConfirmed(true);
            })}>{text("確認登入這台 APP", "Confirm this App")}</button>}
        </>}
      </>}
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    </section>}
  </div>;
}
