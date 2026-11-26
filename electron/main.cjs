const { app, BrowserWindow, dialog, ipcMain, protocol, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const {
  indexFolder,
  findDuplicates,
  ffmpegAvailable,
  collectVideos,
  collectImages,
  indexImagePaths,
} = require("./lib/videoDedup.cjs");

const isDev = !app.isPackaged;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

function resolveMediaPath(requestUrl) {
  return new URL(requestUrl).searchParams.get("path") || "";
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 880,
    minHeight: 560,
    title: "Video Tools",
    backgroundColor: "#12141a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  // registerFileProtocol 对本地视频 Range 请求更稳
  protocol.registerFileProtocol("local-media", (request, callback) => {
    try {
      const filePath = resolveMediaPath(request.url);
      if (!filePath || !fs.existsSync(filePath)) {
        console.error("[local-media] file not found:", filePath, "url=", request.url);
        callback({ error: -6 }); // FILE_NOT_FOUND
        return;
      }
      callback({ path: filePath });
    } catch (err) {
      console.error("[local-media] resolve error:", err);
      callback({ error: -2 });
    }
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("dialog:selectFolder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle("shell:openPath", async (_e, target) => shell.openPath(target));
ipcMain.handle("shell:showItemInFolder", async (_e, target) => {
  shell.showItemInFolder(target);
  return true;
});

ipcMain.handle("shell:trashItems", async (_e, paths) => {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: [], failed: [] };
  }
  const ok = [];
  const failed = [];
  for (const target of paths) {
    if (typeof target !== "string" || !target) {
      failed.push({ path: String(target), error: "无效路径" });
      continue;
    }
    try {
      await shell.trashItem(target);
      ok.push(target);
    } catch (err) {
      failed.push({
        path: target,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ok, failed };
});

/** 将文件 mv 到目标目录；同名时自动加 (1)、(2)…；跨盘则复制后删除 */
async function moveFileToDir(sourcePath, destDir) {
  if (!sourcePath || !destDir) throw new Error("缺少源路径或目标目录");
  if (!fs.existsSync(sourcePath)) throw new Error("源文件不存在");
  if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) {
    throw new Error("目标目录不存在");
  }

  const src = path.resolve(sourcePath);
  const dir = path.resolve(destDir);
  if (path.dirname(src) === dir) {
    throw new Error("文件已在目标目录中");
  }

  const ext = path.extname(src);
  const stem = path.basename(src, ext);
  let dest = path.join(dir, path.basename(src));
  let n = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${stem} (${n})${ext}`);
    n += 1;
  }

  try {
    await fs.promises.rename(src, dest);
  } catch (err) {
    if (err && (err.code === "EXDEV" || err.code === "EINVAL")) {
      await fs.promises.copyFile(src, dest);
      await fs.promises.unlink(src);
    } else {
      throw err;
    }
  }
  return { from: src, to: dest };
}

ipcMain.handle("fs:moveManyToDir", async (_e, payload) => {
  const { sourcePaths, destDir } = payload || {};
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    throw new Error("没有要移动的文件");
  }
  if (!destDir || typeof destDir !== "string") {
    throw new Error("未设置目标目录");
  }

  const moved = [];
  const failed = [];

  for (const sourcePath of sourcePaths) {
    try {
      const result = await moveFileToDir(sourcePath, destDir);
      const sourceGone = !fs.existsSync(result.from);
      const destOk = fs.existsSync(result.to);
      moved.push({
        ...result,
        sourceGone,
        destOk,
        verified: sourceGone && destOk,
      });
    } catch (err) {
      failed.push({
        path: sourcePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const verifiedOk = moved.filter((m) => m.verified).length;
  const verifyFailed = moved.filter((m) => !m.verified);

  return {
    destDir: path.resolve(destDir),
    total: sourcePaths.length,
    moved,
    failed,
    verifiedOk,
    verifyFailed,
    allOk: failed.length === 0 && verifyFailed.length === 0,
  };
});

ipcMain.handle("ffmpeg:status", () => ffmpegAvailable());

ipcMain.handle("videos:list", async (_e, folderPath) => {
  if (!folderPath || typeof folderPath !== "string") {
    throw new Error("未选择文件夹");
  }
  return collectVideos(folderPath);
});

ipcMain.handle("images:list", async (_e, folderPath) => {
  if (!folderPath || typeof folderPath !== "string") {
    throw new Error("未选择文件夹");
  }
  return collectImages(folderPath);
});

ipcMain.handle("images:index", async (event, payload) => {
  const { paths, method = "ahash" } = payload || {};
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("没有可查重的图片");
  }
  return indexImagePaths(paths, {
    method,
    onProgress: (progress) => {
      event.sender.send("images:progress", progress);
    },
  });
});

ipcMain.handle("dedup:index", async (event, payload) => {
  const { folderPath, method = "ahash" } = payload || {};
  if (!folderPath) throw new Error("未选择文件夹");

  const index = await indexFolder(folderPath, {
    method,
    onProgress: (progress) => {
      event.sender.send("dedup:progress", progress);
    },
  });
  return index;
});

ipcMain.handle("dedup:find", async (_e, payload) => {
  const { index, threshold = 5 } = payload || {};
  if (!index) throw new Error("缺少索引数据");
  return findDuplicates(index, { threshold });
});
