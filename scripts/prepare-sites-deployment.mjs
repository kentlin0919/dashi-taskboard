#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.resolve(rootDir, "dist/sites-deployment");

async function prepareSitesDeployment() {
  process.stdout.write("準備 ChatGPT Sites 部署包...\n");

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const webDist = path.join(rootDir, "dist/web");
  const assetsDest = path.join(outputDir, "public");
  await cp(webDist, assetsDest, { recursive: true });

  const serverDistDir = path.join(rootDir, "dist/server");
  await mkdir(serverDistDir, { recursive: true });

  const workerDest = path.join(outputDir, "server");
  await mkdir(workerDest, { recursive: true });
  await cp(path.join(serverDistDir, "index.js"), path.join(workerDest, "index.js"));

  const migrationsDest = path.join(outputDir, "migrations");
  await cp(path.join(rootDir, "cloud/migrations"), migrationsDest, { recursive: true });

  const hostingJsonSrc = path.join(rootDir, ".openai/hosting.json");
  const hostingJsonDestDir = path.join(outputDir, ".openai");
  await mkdir(hostingJsonDestDir, { recursive: true });
  await cp(hostingJsonSrc, path.join(hostingJsonDestDir, "hosting.json"));

  const manifest = {
    name: "taskboard-sites",
    type: "chatgpt-sites",
    compatibilityDate: "2026-07-24",
    entrypoint: "server/index.js",
    staticAssetsDirectory: "public",
    migrationsDirectory: "migrations",
    bindings: [
      {
        type: "d1",
        name: "DB",
        description: "Taskboard SQLite/D1 database",
      },
      {
        type: "r2",
        name: "ATTACHMENTS",
        description: "Taskboard attachments R2 bucket",
      },
    ],
    secrets: [
      {
        name: "TASKBOARD_SHARED_SECRET",
        required: false,
        description: "Private shared access key for password/Basic protection",
      },
    ],
  };

  await writeFile(
    path.join(outputDir, "sites-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const instructions = `# ChatGPT Sites 部署說明

本目錄為預備之 Sites 部署包，路徑：
\`${outputDir}\`

## 包含內容
1. \`public/\`: 前端 SPA 靜態打包資產 (index.html, JS, CSS, 資源)
2. \`server/index.js\`: 原生打包後端 API、裝置配對認證與多裝置路由
3. \`migrations/\`: 0001 到 0014 D1 資料庫遷移腳本（包含多裝置支援）
4. \`.openai/hosting.json\`: Sites hosting 設定，包含已指定之 project_id、D1 DB 與 R2 ATTACHMENTS
5. \`sites-manifest.json\`: Sites 規格與 bindings 定義

## 部署設定確認
1. Sites project_id 已設定於 \`.openai/hosting.json\`。
2. 在 Sites 控制台綁定：
   - D1 Database: \`DB\`（執行 \`migrations/\` 遷移）
   - R2 Bucket: \`ATTACHMENTS\`
3. 若需 Private 站點保護，設定 Secret \`TASKBOARD_SHARED_SECRET\`。
4. 電腦端使用 \`taskctl device pair --url <Site網址>\` 進行安全配對。
`;

  await writeFile(path.join(outputDir, "README.md"), instructions, "utf8");

  process.stdout.write(`部署包已完成產出！\n絕對路徑：${outputDir}\n`);
}

prepareSitesDeployment().catch((err) => {
  process.stderr.write(`部署包準備失敗：${err.message}\n`);
  process.exitCode = 1;
});
