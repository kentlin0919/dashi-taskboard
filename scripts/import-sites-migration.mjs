#!/usr/bin/env node

import { readCloudMigrationBundle } from "./migrate-to-cloud.mjs";

async function readInput() {
  if (!process.stdin.isTTY) {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    return input;
  }

  return new Promise((resolve, reject) => {
    let input = "";
    const finish = (error) => {
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      process.stdin.setRawMode(false);
      error ? reject(error) : resolve(input);
    };
    const onData = (chunk) => {
      input += chunk;
      if (input.includes("\u0003")) finish(new Error("Migration canceled"));
      else if (input.length > 16_384) finish(new Error("Migration input is too large"));
      else if (input.includes("\n") || input.includes("\r")) finish();
    };
    process.stderr.write("Ready for Taskboard migration input on stdin (input is hidden).\n");
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readInput());
  } catch {
    throw new Error("Provide one valid migration input object on stdin");
  }
  const siteUrl = new URL(input.siteUrl);
  if (
    siteUrl.protocol !== "https:"
    || siteUrl.username
    || siteUrl.password
    || siteUrl.search
    || siteUrl.hash
    || typeof input.bundlePath !== "string"
    || !input.bundlePath.startsWith("/")
    || typeof input.siteAuthorizationToken !== "string"
    || !input.siteAuthorizationToken
    || typeof input.sharedSecret !== "string"
    || !input.sharedSecret
  ) {
    throw new Error("Migration input is missing a valid Site URL, bundle path, or credential");
  }

  const bundle = await readCloudMigrationBundle(input.bundlePath);
  const payload = {
    schemaVersion: bundle.schemaVersion,
    createdAt: bundle.createdAt,
    counts: bundle.counts,
    tables: bundle.tables,
    attachments: bundle.attachments.map(({ body, ...metadata }) => ({
      ...metadata,
      bodyBase64: Buffer.from(body).toString("base64"),
    })),
  };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 40 * 1024 * 1024) {
    throw new Error("Migration bundle exceeds the Sites 40 MiB limit; reduce the combined attachment size before importing");
  }
  const response = await fetch(`${siteUrl.origin}/api/admin/migration/import`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`Migration:${input.sharedSecret}`).toString("base64")}`,
      "OAI-Sites-Authorization": `Bearer ${input.siteAuthorizationToken}`,
      "Cache-Control": "no-store",
    },
    body,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object") {
    const message = result?.error?.message ?? `Site migration returned HTTP ${response.status}`;
    throw new Error(message);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Taskboard data migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
