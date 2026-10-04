import { ApiError } from "../shared/api-fields.mjs";

export function createUserSessionService(configStore, fetchFn = fetch) {
  let claimInFlight = null;
  async function remote(config, pathname, { method = "GET", body, user = false } = {}) {
    const response = await fetchFn(new URL(pathname, config.remoteUrl), {
      method, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${user ? config.userSession.token : config.deviceToken}`,
        ...(config.siteAuthorizationToken ? { "OAI-Sites-Authorization": `Bearer ${config.siteAuthorizationToken}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    if (!response.ok) throw new ApiError(response.status, payload.error?.code ?? "LOGIN_FAILED", payload.error?.message ?? "Cloud login failed");
    return payload;
  }
  function publicState(config) {
    const session = config.userSession;
    const pending = config.pendingUserLogin;
    return {
      available: Boolean(config.remoteUrl && config.deviceId && config.deviceToken),
      actor: session && Date.parse(session.expiresAt) > Date.now() ? session.actor : null,
      expiresAt: session?.expiresAt ?? null,
      pending: pending && Date.parse(pending.expiresAt) > Date.now()
        ? { id: pending.id, code: pending.code, expiresAt: pending.expiresAt, verificationUrl: pending.verificationUrl } : null,
    };
  }
  async function claim() {
    const config = await configStore.read();
    const pending = config.pendingUserLogin;
    if (!pending || Date.parse(pending.expiresAt) <= Date.now()) return publicState(config);
    const result = await remote(config, `/api/devices/${encodeURIComponent(config.deviceId)}/user-session/claim`, {
      method: "POST", body: { id: pending.id, claimSecret: pending.claimSecret },
    });
    if (result.status === "active") {
      return publicState(await configStore.setUserSession({ token: result.token, actor: result.actor, expiresAt: result.expiresAt }, pending.id, config));
    }
    return publicState(config);
  }
  return {
    async status() {
      const config = await configStore.read();
      if (config.userSession && Date.parse(config.userSession.expiresAt) > Date.now()) {
        try {
          await remote(config, "/api/actor", { user: true });
        } catch (error) {
          if (error.status !== 401) throw error;
          return publicState(await configStore.setUserSession(undefined, undefined, config));
        }
      }
      return publicState(config);
    },
    async start() {
      const config = await configStore.read();
      if (!config.remoteUrl || !config.deviceId || !config.deviceToken) {
        throw new ApiError(409, "DEVICE_PAIRING_REQUIRED", "Pair this App with the cloud taskboard first");
      }
      const login = await remote(config, `/api/devices/${encodeURIComponent(config.deviceId)}/user-session`, { method: "POST" });
      const verificationUrl = new URL(login.verificationUrl);
      if (verificationUrl.origin !== new URL(config.remoteUrl).origin) throw new ApiError(502, "INVALID_LOGIN_URL", "Cloud returned an invalid login URL");
      return publicState(await configStore.setUserLogin(login, config));
    },
    async claim() {
      if (!claimInFlight) claimInFlight = claim().finally(() => { claimInFlight = null; });
      return claimInFlight;
    },
    async logout() {
      const config = await configStore.read();
      if (config.userSession && Date.parse(config.userSession.expiresAt) > Date.now()) {
        try { await remote(config, "/api/user-session", { method: "DELETE", user: true }); }
        catch (error) { if (error.status !== 401) throw error; }
      }
      return publicState(await configStore.setUserSession(undefined, undefined, config));
    },
  };
}
