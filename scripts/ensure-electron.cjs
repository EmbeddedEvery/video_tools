#!/usr/bin/env node
/**
 * electron 官方 install.js 依赖 extract-zip，在部分环境下会解压卡住/不完整。
 * 本脚本校验 path.txt；缺失时用系统 unzip 从缓存 zip 修复。
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const electronDir = path.join(root, "node_modules", "electron");
const pathTxt = path.join(electronDir, "path.txt");
const platformPath = "Electron.app/Contents/MacOS/Electron";
const binary = path.join(electronDir, "dist", platformPath);

function ok() {
  // macOS 上 MacOS/Electron 只是很小的启动器，体积在 Frameworks 里
  const framework = path.join(
    electronDir,
    "dist",
    "Electron.app",
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
  );
  return (
    fs.existsSync(pathTxt) &&
    fs.existsSync(binary) &&
    (process.platform !== "darwin" || fs.existsSync(framework))
  );
}

if (!fs.existsSync(electronDir)) {
  console.log("[ensure-electron] electron 未安装，跳过");
  process.exit(0);
}

if (ok()) {
  process.exit(0);
}

console.log("[ensure-electron] Electron 安装不完整，尝试修复…");

const { version } = JSON.parse(
  fs.readFileSync(path.join(electronDir, "package.json"), "utf8"),
);
const { downloadArtifact } = require(path.join(
  root,
  "node_modules",
  "@electron",
  "get",
));

(async () => {
  const zipPath = await downloadArtifact({
    version,
    artifactName: "electron",
    platform: process.platform,
    arch: process.arch,
    checksums: JSON.parse(
      fs.readFileSync(path.join(electronDir, "checksums.json"), "utf8"),
    ),
  });

  const dist = path.join(electronDir, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  const unzip = spawnSync("unzip", ["-q", zipPath, "-d", dist], {
    stdio: "inherit",
  });
  if (unzip.status !== 0) {
    throw new Error(`unzip 失败，exit ${unzip.status}`);
  }

  fs.writeFileSync(pathTxt, platformPath);
  if (!ok()) {
    throw new Error("修复后仍无法找到 Electron 可执行文件");
  }
  console.log("[ensure-electron] 已修复 →", binary);
})().catch((err) => {
  console.error("[ensure-electron] 失败:", err.message || err);
  process.exit(1);
});
