const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const VIDEO_EXTS = new Set([
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".webm",
  ".flv",
  ".m4v",
  ".wmv",
  ".ts",
]);

const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".avif",
]);

function which(bin) {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    const full = path.join(dir, bin);
    if (fs.existsSync(full)) return full;
    if (process.platform === "win32") {
      for (const ext of [".exe", ".cmd", ".bat"]) {
        const win = full + ext;
        if (fs.existsSync(win)) return win;
      }
    }
  }
  // macOS GUI apps often miss Homebrew PATH
  for (const fallback of [
    `/opt/homebrew/bin/${bin}`,
    `/usr/local/bin/${bin}`,
  ]) {
    if (fs.existsSync(fallback)) return fallback;
  }
  return null;
}

const FFMPEG = which("ffmpeg");
const FFPROBE = which("ffprobe");

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    const errs = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => errs.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(Buffer.concat(errs).toString("utf8") || `${bin} exit ${code}`));
    });
  });
}

async function probeDuration(videoPath) {
  if (!FFPROBE) throw new Error("未找到 ffprobe，请安装 ffmpeg");
  const out = await run(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const text = out.toString("utf8").trim();
  if (!text || text === "N/A") throw new Error(`无法读取时长: ${videoPath}`);
  return Number(text);
}

function middleTimestamp(duration) {
  return duration < 0.2 ? 0 : duration / 2;
}

async function extractGrayFrame(videoPath, size = 16) {
  if (!FFMPEG) throw new Error("未找到 ffmpeg，请安装 ffmpeg");
  const ts = middleTimestamp(await probeDuration(videoPath));
  // 直接输出 size×size 灰度 raw，无需额外图像库
  const buf = await run(FFMPEG, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    ts.toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${size}:${size}`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "pipe:1",
  ]);
  const expected = size * size;
  if (buf.length < expected) {
    throw new Error(`中间帧提取失败: ${path.basename(videoPath)}`);
  }
  return buf.subarray(0, expected);
}

function averageHash(grayBytes, size = 16) {
  let sum = 0;
  for (let i = 0; i < grayBytes.length; i++) sum += grayBytes[i];
  const avg = sum / grayBytes.length;
  let bits = "";
  for (let i = 0; i < grayBytes.length; i++) {
    bits += grayBytes[i] >= avg ? "1" : "0";
  }
  const hexLen = (size * size) / 4;
  return BigInt(`0b${bits}`).toString(16).padStart(hexLen, "0");
}

function md5Bytes(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

function hammingHex(a, b) {
  if (a.length !== b.length) return Math.max(a.length, b.length) * 4;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let dist = 0;
  while (x > 0n) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return dist;
}

async function frameHash(videoPath, method = "ahash") {
  if (method === "ahash") {
    const gray = await extractGrayFrame(videoPath, 16);
    return averageHash(gray, 16);
  }
  if (method === "md5") {
    // 中间帧完整 PNG 的 md5（精确）
    const tmp = path.join(
      os.tmpdir(),
      `vdedup-${process.pid}-${Date.now()}.png`,
    );
    try {
      const ts = middleTimestamp(await probeDuration(videoPath));
      await run(FFMPEG, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        ts.toFixed(3),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-y",
        tmp,
      ]);
      const data = fs.readFileSync(tmp);
      return md5Bytes(data);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error(`未知 method: ${method}`);
}

async function extractGrayImage(imagePath, size = 16) {
  if (!FFMPEG) throw new Error("未找到 ffmpeg，请安装 ffmpeg");
  const buf = await run(FFMPEG, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    imagePath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${size}:${size}`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "pipe:1",
  ]);
  const expected = size * size;
  if (buf.length < expected) {
    throw new Error(`图片解码失败: ${path.basename(imagePath)}`);
  }
  return buf.subarray(0, expected);
}

async function imageHash(imagePath, method = "ahash") {
  if (method === "ahash") {
    const gray = await extractGrayImage(imagePath, 16);
    return averageHash(gray, 16);
  }
  if (method === "md5") {
    return md5Bytes(fs.readFileSync(imagePath));
  }
  throw new Error(`未知 method: ${method}`);
}

async function indexPaths(list, hashFn, onProgress) {
  const entries = {};
  const failures = [];

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    onProgress({ current: i + 1, total: list.length, file, status: "hashing" });
    try {
      entries[file] = await hashFn(file);
      onProgress({
        current: i + 1,
        total: list.length,
        file,
        status: "ok",
        hash: entries[file],
      });
    } catch (err) {
      const message = String(err.message || err);
      failures.push({ path: file, error: message });
      onProgress({
        current: i + 1,
        total: list.length,
        file,
        status: "fail",
        error: message,
      });
    }
  }

  return { entries, failures };
}

async function indexImagePaths(imagePaths, options = {}) {
  const method = options.method || "ahash";
  const list = Array.isArray(imagePaths) ? imagePaths : [];
  const { entries, failures } = await indexPaths(
    list,
    (file) => imageHash(file, method),
    options.onProgress || (() => {}),
  );
  return { method, entries, failures, total: list.length };
}

function collectByExt(root, exts) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && exts.has(path.extname(ent.name).toLowerCase())) {
        results.push(full);
      }
    }
  }
  const st = fs.statSync(root);
  if (st.isFile()) {
    if (exts.has(path.extname(root).toLowerCase())) results.push(root);
  } else {
    walk(root);
  }
  results.sort();
  return results;
}

function collectVideos(root) {
  return collectByExt(root, VIDEO_EXTS);
}

function collectImages(root) {
  return collectByExt(root, IMAGE_EXTS);
}

/**
 * 扫描目录，边扫边通过 onProgress 回报。
 * @returns {{ method, entries: Record<string,string>, failures: {path,error}[] }}
 */
async function indexFolder(folderPath, options = {}) {
  const method = options.method || "ahash";
  const videos = collectVideos(folderPath);
  const { entries, failures } = await indexPaths(
    videos,
    (file) => frameHash(file, method),
    options.onProgress || (() => {}),
  );
  return { method, entries, failures, total: videos.length };
}

function findDuplicates(index, options = {}) {
  const method = index.method || "ahash";
  const threshold = options.threshold ?? 5;
  const items = Object.entries(index.entries || {});
  const groups = [];

  if (method === "md5") {
    const buckets = new Map();
    for (const [p, h] of items) {
      if (!buckets.has(h)) buckets.set(h, []);
      buckets.get(h).push(p);
    }
    for (const [h, paths] of buckets) {
      if (paths.length >= 2) groups.push({ hash: h, distance: 0, paths });
    }
    return groups;
  }

  // aHash：贪心并查聚类
  const parent = items.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (hammingHex(items[i][1], items[j][1]) <= threshold) union(i, j);
    }
  }

  const clusters = new Map();
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(items[i][0]);
  }

  for (const paths of clusters.values()) {
    if (paths.length < 2) continue;
    // 用组内相对首项的距离作展示
    const h0 = index.entries[paths[0]];
    const maxDist = Math.max(
      ...paths.map((p) => hammingHex(h0, index.entries[p])),
    );
    groups.push({ hash: h0, distance: maxDist, paths });
  }

  return groups;
}

function ffmpegAvailable() {
  return { ffmpeg: Boolean(FFMPEG), ffprobe: Boolean(FFPROBE), ffmpegPath: FFMPEG, ffprobePath: FFPROBE };
}

module.exports = {
  indexFolder,
  indexImagePaths,
  findDuplicates,
  collectVideos,
  collectImages,
  ffmpegAvailable,
};
