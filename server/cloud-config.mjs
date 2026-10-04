import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_VERSION = 1;

class CloudConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CloudConfigError";
    this.code = code;
  }
}

function emptyConfig() {
  return {
    version: CONFIG_VERSION,
    remoteUrl: null,
    actorName: null,
    sharedKey: null,
    deviceToken: null,
    deviceId: null,
    siteAuthorizationToken: null,
    projectMappings: {},
  };
}

export function normalizeCloudUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CloudConfigError("INVALID_CLOUD_URL", "Cloud taskboard URL must be a valid URL");
  }
  const isLoopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback))
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new CloudConfigError(
      "INVALID_CLOUD_URL",
      "Cloud taskboard URL must be an HTTPS origin (loopback HTTP is allowed for development)",
    );
  }
  return url.origin;
}

function validateCredentials(actorName, sharedKey) {
  if (
    typeof actorName !== "string"
    || !actorName.trim()
    || actorName.length > 120
    || actorName.includes(":")
  ) {
    throw new CloudConfigError(
      "INVALID_CLOUD_ACTOR",
      "Cloud actor name must be 1 to 120 characters and cannot contain ':'",
    );
  }
  if (typeof sharedKey !== "string" || !sharedKey || sharedKey.length > 4096) {
    throw new CloudConfigError(
      "INVALID_CLOUD_KEY",
      "Cloud shared key must be 1 to 4096 characters",
    );
  }
  return { actorName: actorName.trim(), sharedKey };
}

function validateProjectMappings(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CloudConfigError("INVALID_CLOUD_CONFIG", "Cloud project mappings are invalid");
  }
  const projectMappings = {};
  for (const [projectId, workspacePath] of Object.entries(value)) {
    if (!projectId || typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)) {
      throw new CloudConfigError("INVALID_CLOUD_CONFIG", "Cloud project mappings are invalid");
    }
    projectMappings[projectId] = workspacePath;
  }
  return projectMappings;
}

function parseConfig(value) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || value.version !== CONFIG_VERSION
  ) {
    throw new CloudConfigError("INVALID_CLOUD_CONFIG", "Cloud companion configuration is invalid");
  }
  const allowedKeys = new Set([
    "version",
    "remoteUrl",
    "actorName",
    "sharedKey",
    "deviceToken",
    "deviceId",
    "siteAuthorizationToken",
    "projectMappings",
    "userSession",
    "pendingUserLogin",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new CloudConfigError("INVALID_CLOUD_CONFIG", "Cloud companion configuration is invalid");
  }
  const projectMappings = validateProjectMappings(value.projectMappings);
  const userSession = value.userSession;
  const pendingUserLogin = value.pendingUserLogin;
  if (userSession !== undefined && (!userSession || typeof userSession.token !== "string"
    || !/^ut_[a-f0-9]{64}$/.test(userSession.token) || userSession.actor?.type !== "user"
    || typeof userSession.actor.id !== "string" || typeof userSession.actor.name !== "string"
    || !Number.isFinite(Date.parse(userSession.expiresAt)))) {
    throw new CloudConfigError("INVALID_CLOUD_CONFIG", "Cloud user session is invalid");
  }
  if (pendingUserLogin !== undefined && (!pendingUserLogin || typeof pendingUserLogin.id !== "string"
    || !/^claim_[a-f0-9]{64}$/.test(pendingUserLogin.claimSecret ?? "")
    || !Number.isFinite(Date.parse(pendingUserLogin.expiresAt)))) {
    throw new CloudConfigError("INVALID_CLOUD_CONFIG", "Cloud login request is invalid");
  }
  const siteAuthorizationToken = value.siteAuthorizationToken ?? null;
  if (siteAuthorizationToken !== null && (typeof siteAuthorizationToken !== "string" || !siteAuthorizationToken || /[\r\n]/.test(siteAuthorizationToken))) {
    throw new CloudConfigError("INVALID_CLOUD_CONFIG", "Sites authorization token is invalid");
  }
  if (value.remoteUrl === null && value.actorName === null && value.sharedKey === null
    && !value.deviceToken && !value.deviceId) {
    return { ...emptyConfig(), projectMappings };
  }
  const deviceToken = value.deviceToken ?? null;
  const deviceId = value.deviceId ?? null;
  if (deviceToken !== null) {
    if (typeof deviceToken !== "string" || !deviceToken || deviceToken.length > 4096 || /[\r\n]/.test(deviceToken)
      || typeof deviceId !== "string" || !deviceId || deviceId.length > 120
      || typeof value.actorName !== "string" || !value.actorName.trim()) {
      throw new CloudConfigError("INVALID_CLOUD_CONFIG", "Cloud device credentials are invalid");
    }
    return { version: CONFIG_VERSION, remoteUrl: normalizeCloudUrl(value.remoteUrl),
      actorName: value.actorName.trim(), sharedKey: null, deviceToken, deviceId, siteAuthorizationToken, projectMappings,
      ...(userSession ? { userSession } : {}), ...(pendingUserLogin ? { pendingUserLogin } : {}) };
  }
  if (deviceId !== null) throw new CloudConfigError("INVALID_CLOUD_CONFIG", "Cloud device token is required");
  const credentials = validateCredentials(value.actorName, value.sharedKey);
  return {
    version: CONFIG_VERSION,
    remoteUrl: normalizeCloudUrl(value.remoteUrl),
    ...credentials,
    deviceToken: null, deviceId: null,
    siteAuthorizationToken,
    projectMappings,
  };
}

export function createCloudConfigStore({ configPath }) {
  if (!configPath) throw new Error("configPath is required");
  let pendingWrite = Promise.resolve();

  async function readFromDisk() {
    try {
      return parseConfig(JSON.parse(await readFile(configPath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return emptyConfig();
      throw error;
    }
  }

  async function writeAtomically(config) {
    config = parseConfig(config);
    await mkdir(path.dirname(configPath), { recursive: true });
    const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, configPath);
  }

  function sameUserLoginState(config, expected) {
    return expected && config.remoteUrl === expected.remoteUrl
      && config.deviceId === expected.deviceId && config.deviceToken === expected.deviceToken
      && config.userSession?.token === expected.userSession?.token
      && config.pendingUserLogin?.id === expected.pendingUserLogin?.id;
  }

  function update(mutator) {
    const operation = pendingWrite.then(async () => {
      const next = mutator(await readFromDisk());
      await writeAtomically(next);
      return next;
    });
    pendingWrite = operation.catch(() => {});
    return operation;
  }

  return {
    async read() {
      await pendingWrite;
      return readFromDisk();
    },
    async configure({ remoteUrl, actorName, sharedKey, deviceToken = null, deviceId = null, siteAuthorizationToken = null }) {
      const normalizedUrl = normalizeCloudUrl(remoteUrl);
      const credentials = deviceToken === null
        ? { ...validateCredentials(actorName, sharedKey), deviceToken: null, deviceId: null }
        : { actorName, sharedKey: null, deviceToken, deviceId };
      return update((config) => ({
        ...config,
        remoteUrl: normalizedUrl,
        ...credentials,
        siteAuthorizationToken,
        userSession: config.remoteUrl === normalizedUrl && config.deviceId === deviceId ? config.userSession : undefined,
        pendingUserLogin: config.remoteUrl === normalizedUrl && config.deviceId === deviceId ? config.pendingUserLogin : undefined,
      }));
    },
    clearCloud() {
      return update((config) => ({
        ...config,
        remoteUrl: null,
        actorName: null,
        sharedKey: null,
        deviceToken: null, deviceId: null,
        siteAuthorizationToken: null,
        userSession: undefined, pendingUserLogin: undefined,
      }));
    },
    setUserLogin(pendingUserLogin, expectedConfig) {
      return update((config) => {
        if (!sameUserLoginState(config, expectedConfig)) {
          throw new CloudConfigError("LOGIN_CHANGED", "Cloud connection or login changed; try again");
        }
        return { ...config, pendingUserLogin };
      });
    },
    setUserSession(userSession, expectedLoginId, expectedConfig) {
      return update((config) => {
        if (expectedConfig && !sameUserLoginState(config, expectedConfig)) {
          if (!userSession) return config;
          throw new CloudConfigError("LOGIN_CHANGED", "Cloud connection or login changed; try again");
        }
        if (expectedLoginId && config.pendingUserLogin?.id !== expectedLoginId) {
          throw new CloudConfigError("LOGIN_CHANGED", "Login request changed; try again");
        }
        return { ...config, userSession, pendingUserLogin: undefined };
      });
    },
    setProjectWorkspace(projectId, workspacePath) {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new CloudConfigError("INVALID_PROJECT_MAPPING", "projectId is required");
      }
      if (typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)) {
        throw new CloudConfigError(
          "INVALID_PROJECT_MAPPING",
          "workspacePath must be absolute",
        );
      }
      return update((config) => ({
        ...config,
        projectMappings: {
          ...config.projectMappings,
          [projectId]: workspacePath,
        },
      }));
    },
  };
}
