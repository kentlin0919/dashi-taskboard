import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { extname, join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = join(projectRoot, "dist/web");
const serverRoot = join(projectRoot, "dist/server");
const workerSource = join(projectRoot, "cloud/src/index.mjs");
const assetTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(filename));
    else if (entry.isFile()) files.push(filename);
    else throw new Error(`Unsupported build output entry: ${filename}`);
  }
  return files.sort();
}

async function main() {
  const files = await collectFiles(webRoot);
  if (!files.some((filename) => relative(webRoot, filename) === "index.html")) {
    throw new Error(`Missing ${join(webRoot, "index.html")}`);
  }

  const assets = {};
  for (const filename of files) {
    const content = await readFile(filename);
    const compressed = gzipSync(content, { level: 9 });
    const path = `/${relative(webRoot, filename).split(sep).join("/")}`;
    assets[path] = {
      body: compressed.toString("base64"),
      compressedSize: compressed.byteLength,
      contentType: assetTypes[extname(filename).toLowerCase()] ?? "application/octet-stream",
      etag: `"${createHash("sha256").update(content).digest("hex")}"`,
      size: content.byteLength,
    };
  }

  await mkdir(serverRoot, { recursive: true });
  const assetModule = join(serverRoot, ".sites-assets.mjs");
  const entryModule = join(serverRoot, ".sites-entry.mjs");
  const assetSource = `
const files = ${JSON.stringify(assets)};
const decoded = new Map();

function bytesFor(asset) {
  let bytes = decoded.get(asset);
  if (!bytes) {
    const value = atob(asset.body);
    bytes = Uint8Array.from(value, (character) => character.charCodeAt(0));
    decoded.set(asset, bytes);
  }
  return bytes;
}

function acceptsGzip(request) {
  return (request.headers.get("accept-encoding") ?? "")
    .split(",")
    .some((value) => {
      const [encoding, ...parameters] = value.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return encoding.toLowerCase() === "gzip" && Number(quality?.trim().slice(2) ?? "1") > 0;
    });
}

export function fetchEmbeddedAsset(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (pathname.includes("\\0") || pathname.includes("\\\\") || pathname.split("/").includes("..")) {
    return new Response("Not found", { status: 404 });
  }
  if (pathname === "/" || !/\\.[^/]+$/.test(pathname)) pathname = "/index.html";

  const asset = files[pathname];
  if (!asset) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "cache-control": pathname === "/index.html" ? "private, no-cache" : "private, max-age=3600",
    "content-length": String(acceptsGzip(request) ? asset.compressedSize : asset.size),
    "content-type": asset.contentType,
    etag: asset.etag,
    vary: "accept-encoding",
  });
  if (request.headers.get("if-none-match") === asset.etag) {
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }

  const compressed = bytesFor(asset);
  if (acceptsGzip(request)) headers.set("content-encoding", "gzip");
  const body = request.method === "HEAD"
    ? null
    : acceptsGzip(request)
      ? compressed
      : new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(body, { headers });
}
`;

  const workerSpecifier = JSON.stringify(
    relative(serverRoot, workerSource).split(sep).join("/"),
  );
  const entrySource = `
import worker from ${workerSpecifier};
import { fetchEmbeddedAsset } from "./.sites-assets.mjs";
export * from ${workerSpecifier};

const fetch = async (request, env, ctx) => {
  const originalAssets = env.ASSETS;
  const assets = {
    async fetch(assetRequest) {
      if (originalAssets) {
        const response = await originalAssets.fetch(assetRequest);
        if (response.status !== 404) return response;
      }
      return fetchEmbeddedAsset(assetRequest);
    },
  };
  const scopedEnv = new Proxy(env, {
    get(target, property, receiver) {
      return property === "ASSETS" ? assets : Reflect.get(target, property, receiver);
    },
  });
  return worker.fetch(request, scopedEnv, ctx);
};

export default { ...worker, fetch };
`;

  try {
    await writeFile(assetModule, assetSource);
    await writeFile(entryModule, entrySource);
    await build({
      entryPoints: [entryModule],
      bundle: true,
      format: "esm",
      minify: true,
      outfile: join(serverRoot, "index.js"),
      platform: "neutral",
      target: "es2022",
    });
    console.log(`Built Sites Worker with ${files.length} embedded assets.`);
  } finally {
    await Promise.all([
      rm(assetModule, { force: true }),
      rm(entryModule, { force: true }),
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unable to build Sites Worker");
  process.exitCode = 1;
});
