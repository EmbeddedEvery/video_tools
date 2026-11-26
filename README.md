# Video Tools

本地视频 / 图片处理工具套件，基于 **Electron + Vite + React + TypeScript**。所有处理都在本机完成，不上传网络。

仓库：<https://github.com/EmbeddedEvery/video_tools>

## 功能

| 工具 | 说明 |
| --- | --- |
| **视频查重** | 提取每个视频的中间帧生成 hash，递归扫描文件夹，找出重复或相似视频，可批量移到废纸篓 |
| **视频浏览** | 递归列出视频，边看边删；确认后把整个列表移动到指定目录 |
| **图片浏览** | 递归列出图片，边看边删；内置图片查重，可批量删除重复项；确认后移动到指定目录 |

> 界面中的「上传」指把本地文件 **移动（mv）** 到你设置的目录，不涉及网络。

支持格式：

- 视频：`.mp4` `.mkv` `.avi` `.mov` `.webm` `.flv` `.m4v` `.wmv` `.ts`
- 图片：`.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.tif` `.tiff` `.heic` `.heif` `.avif`

## 环境要求

- Node.js 18+
- 系统已安装 [ffmpeg](https://ffmpeg.org/)（需包含 `ffprobe`）

```bash
# macOS
brew install ffmpeg
```

macOS 上从访达启动的 GUI 应用通常继承不到 Homebrew 的 PATH，程序会额外查找 `/opt/homebrew/bin` 与 `/usr/local/bin`。

## 安装与运行

```bash
npm install
npm run dev        # 开发模式：Vite + Electron 热更新
```

生产运行：

```bash
npm start          # 先构建，再启动 Electron
```

## 使用说明

### 视频查重

1. 选择文件夹（递归扫描所有视频）。
2. 选择 Hash 方式：
   - **感知 hash（默认）**：取视频中间帧缩放到 16×16 灰度，按均值二值化。对重编码、轻微压缩更稳。
   - **中间帧 MD5**：对中间帧 PNG 求 MD5，只匹配完全相同的帧。
3. 点击「开始查重」。感知 hash 可调整相似阈值（汉明距离 ≤，默认 5，越小越严格）。
4. 结果按重复组展示。默认每组保留**文件名最短**的一个，其余自动勾选。
5. 可手动改勾选，确认后「移到废纸篓」（可从系统废纸篓恢复）。
6. 点击文件路径可在访达 / 资源管理器中定位。

### 视频 / 图片浏览

1. 选择源目录（递归扫描）。
2. 设置「上传目的地」——不设置则只能浏览和删除。目的地会按工具分别记住。
3. 用按钮或键盘浏览；不需要的文件可直接删到系统废纸篓。
4. 浏览完成后点击「上传全部」，把当前列表移动（mv）到目的地：
   - 目标目录存在同名文件时自动改名为 `名称 (1).扩展名`；
   - 跨磁盘时自动降级为「复制 + 删除源文件」；
   - 每个文件移动后都会校验源文件已消失、目标文件存在，并给出明细。

键盘快捷键：

| 按键 | 功能 |
| --- | --- |
| `←` / `↑` | 上一条 |
| `→` / `↓` | 下一条 |
| `Space` | 播放 / 暂停（仅视频） |
| `Delete` / `Backspace` | 当前文件移到废纸篓 |

### 图片查重

在图片浏览页点击「图片查重」，对**当前列表**做查重：

- 方式可选感知 hash（相似）或整文件 MD5（精确）；
- 重复项会在列表和预览中标出「留 / 重」；
- 默认每组保留文件名最短的一张，其余自动勾选，可一键批量删到废纸篓。

## 项目结构

```text
electron/
  main.cjs              主进程：窗口、IPC、文件夹选择、移动/废纸篓、local-media 协议
  preload.cjs           contextBridge，暴露 window.videoTools
  lib/videoDedup.cjs    ffmpeg 取帧、hash、目录索引、重复分组
src/
  App.tsx               工具路由
  components/
    AppShell.tsx        侧栏 + 工具内容布局
    FolderPicker.tsx    文件夹选择
    BrowseShared.tsx    上传栏、上传结果横幅、进度条、通用 hooks
  lib/media.ts          文件名与「保留项」策略
  tools/registry.ts     工具注册表
  tools/video-dedup/    视频查重页面
  tools/video-browse/   视频浏览页面
  tools/image-browse/   图片浏览页面
  types/api.ts          渲染进程使用的 IPC 类型
scripts/
  ensure-electron.cjs   修复部分环境下 Electron 解压不完整的问题
video_dedup.py          CLI 版视频查重（可独立使用）
```

## 新增工具

1. 在 `src/tools/<tool-id>/` 下编写 React 页面。
2. 如需系统能力，在 `electron/main.cjs` 添加 IPC，并在 `electron/preload.cjs` 与 `src/types/api.ts` 中暴露类型。
3. 在 `src/tools/registry.ts` 的 `tools` 数组注册，即可出现在侧栏。

## CLI 视频查重

`video_dedup.py` 提供不依赖 Electron 的命令行版本：

```bash
# 计算单个视频的中间帧 hash
python3 video_dedup.py hash video.mp4

# 扫描目录并写入索引
python3 video_dedup.py index ./videos -o video_hashes.json

# 对照索引检查某个视频
python3 video_dedup.py check video.mp4 -i video_hashes.json

# 在目录内查找重复 / 相似视频
python3 video_dedup.py find ./videos --threshold 5
```

感知 hash 需要 Pillow：`pip install Pillow`。

## 常见问题

**提示未检测到 ffmpeg / ffprobe**

安装 ffmpeg 后重启应用：

```bash
brew install ffmpeg
```

**Electron 安装不完整 / 启动报错**

```bash
npm run fix:electron
```

**感知 hash 与 MD5 怎么选？**

找「同一视频的不同码率/分辨率版本」用感知 hash；找「完全相同的文件」用 MD5。

## 说明

- 删除操作走系统废纸篓，可从废纸篓恢复；「上传全部」是移动文件，不是复制，请确认目的地后再执行。
- 所有数据与文件都留在本机，程序不发起网络请求。
