import { ApiError, stringField } from "../../shared/api-fields.mjs";

async function hash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secret(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicActor(actor) {
  return { type: "user", id: actor.id, name: actor.name, avatarUrl: actor.avatarUrl ?? null, username: actor.username };
}

export async function authenticateUserSession(token, env) {
  const row = await env.DB.prepare(`
    SELECT s.id, s.actor_json FROM device_user_sessions s
    JOIN devices d ON d.id = s.device_id
    WHERE s.token_hash = ? AND s.status = 'active'
      AND s.session_expires_at > ? AND d.status = 'active'
  `).bind(await hash(token), new Date().toISOString()).first();
  return row ? { actor: { ...JSON.parse(row.actor_json), userSessionId: row.id }, sessionCookie: null } : null;
}

export async function routeUserSession(request, env, actor, readJson, json) {
  const url = new URL(request.url);
  if (url.pathname === "/api/actor" && request.method === "GET") {
    return json(200, { actor: actor.type === "user" ? publicActor(actor) : {
      type: actor.type, id: actor.id, name: actor.name, avatarUrl: actor.avatarUrl,
    } });
  }
  if (url.pathname === "/api/user-session" && request.method === "DELETE") {
    if (!actor.userSessionId) throw new ApiError(403, "FORBIDDEN", "An App user session is required");
    await env.DB.prepare("UPDATE device_user_sessions SET status = 'revoked', token_hash = NULL WHERE id = ?")
      .bind(actor.userSessionId).run();
    return json(200, { ok: true });
  }
  const deviceRoute = url.pathname.match(/^\/api\/devices\/([^/]+)\/user-session(?:\/(claim))?$/);
  if (deviceRoute && request.method === "POST") {
    const deviceId = decodeURIComponent(deviceRoute[1]);
    if (actor.deviceId !== deviceId) throw new ApiError(403, "FORBIDDEN", "Only this device can request or claim its user login");
    const now = new Date().toISOString();
    if (!deviceRoute[2]) {
      const id = crypto.randomUUID();
      const claimSecret = secret("claim_");
      const code = secret("").slice(0, 8).toUpperCase();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await env.DB.prepare(`INSERT INTO device_user_sessions
        (id, device_id, code, claim_hash, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
        .bind(id, deviceId, code, await hash(claimSecret), expiresAt, now).run();
      return json(200, { id, code, claimSecret, expiresAt,
        verificationUrl: `${url.origin}/?deviceLogin=${encodeURIComponent(id)}` });
    }
    const input = await readJson(request);
    const id = stringField(input.id, "id", { required: true, maxLength: 128 });
    const claimSecret = stringField(input.claimSecret, "claimSecret", { required: true, maxLength: 128 });
    const claimHash = await hash(claimSecret);
    const row = await env.DB.prepare(`SELECT * FROM device_user_sessions
      WHERE id = ? AND device_id = ? AND claim_hash = ? AND expires_at > ?`)
      .bind(id, deviceId, claimHash, now).first();
    if (!row || !['pending', 'approved'].includes(row.status)) throw new ApiError(400, "LOGIN_EXPIRED", "Login request expired or was already claimed");
    if (row.status === "pending") return json(200, { status: "pending" });
    const token = secret("ut_");
    const result = await env.DB.prepare(`UPDATE device_user_sessions SET status = 'active', token_hash = ?, claim_hash = ''
      WHERE id = ? AND device_id = ? AND claim_hash = ? AND status = 'approved' AND expires_at > ?`)
      .bind(await hash(token), id, deviceId, claimHash, now).run();
    if (!(result.meta?.changes ?? result.changes)) throw new ApiError(409, "LOGIN_ALREADY_CLAIMED", "Login was already claimed");
    return json(200, { status: "active", token, actor: JSON.parse(row.actor_json), expiresAt: row.session_expires_at });
  }
  const loginRoute = url.pathname.match(/^\/api\/device-user-logins\/([^/]+)$/);
  if (loginRoute && ['GET', 'POST'].includes(request.method)) {
    if (actor.type !== "user" || actor.userSessionId) throw new ApiError(403, "FORBIDDEN", "Sign in to the cloud website to confirm this login");
    const row = await env.DB.prepare(`SELECT s.*, d.name AS device_name FROM device_user_sessions s
      JOIN devices d ON d.id = s.device_id WHERE s.id = ? AND d.status = 'active'`)
      .bind(decodeURIComponent(loginRoute[1])).first();
    if (!row || row.expires_at <= new Date().toISOString()) throw new ApiError(400, "LOGIN_EXPIRED", "Login request expired");
    if (request.method === "GET") return json(200, { code: row.code, deviceName: row.device_name, status: row.status, actor: publicActor(actor) });
    const input = await readJson(request);
    if (input.code !== row.code) throw new ApiError(400, "INVALID_LOGIN_CODE", "Login code does not match");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result = await env.DB.prepare(`UPDATE device_user_sessions SET status = 'approved', actor_json = ?, session_expires_at = ?
      WHERE id = ? AND status = 'pending' AND expires_at > ?`)
      .bind(JSON.stringify(publicActor(actor)), expiresAt, row.id, new Date().toISOString()).run();
    if (!(result.meta?.changes ?? result.changes)) throw new ApiError(409, "LOGIN_ALREADY_CONFIRMED", "Login was already confirmed");
    return json(200, { ok: true });
  }
  return null;
}
