const { contextBridge, ipcRenderer } = require("electron");
const path = require("node:path");

/** 本地文件 → local-media:// 协议，供 <video> 播放（路径放 query，避免被当成 host） */
function toMediaUrl(filePath) {
  const abs = path.resolve(filePath);
  return `local-media://open/?path=${encodeURIComponent(abs)}`;
}

contextBridge.exposeInMainWorld("videoTools", {
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  openPath: (target) => ipcRenderer.invoke("shell:openPath", target),
  showItemInFolder: (target) => ipcRenderer.invoke("shell:showItemInFolder", target),
  trashItems: (paths) => ipcRenderer.invoke("shell:trashItems", paths),
  moveManyToDir: (payload) => ipcRenderer.invoke("fs:moveManyToDir", payload),
  listVideos: (folderPath) => ipcRenderer.invoke("videos:list", folderPath),
  listImages: (folderPath) => ipcRenderer.invoke("images:list", folderPath),
  indexImages: (payload) => ipcRenderer.invoke("images:index", payload),
  toMediaUrl,
  ffmpegStatus: () => ipcRenderer.invoke("ffmpeg:status"),
  dedupIndex: (payload) => ipcRenderer.invoke("dedup:index", payload),
  dedupFind: (payload) => ipcRenderer.invoke("dedup:find", payload),
  onDedupProgress: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("dedup:progress", listener);
    return () => ipcRenderer.removeListener("dedup:progress", listener);
  },
  onImagesProgress: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("images:progress", listener);
    return () => ipcRenderer.removeListener("images:progress", listener);
  },
});
