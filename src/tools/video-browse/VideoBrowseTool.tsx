import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderPicker } from "@/components/FolderPicker";
import {
  BatchResultBanner,
  UploadDestBar,
  useBrowseHotkeys,
  useUploadDest,
} from "@/components/BrowseShared";
import { baseName } from "@/lib/media";
import type { BatchMoveResult } from "@/types/api";

const DEST_KEY = "video-browse.uploadDest";

export function VideoBrowseTool() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [folder, setFolder] = useState<string | null>(null);
  const { dest: uploadDest, setDest, clear: clearDest } = useUploadDest(DEST_KEY);
  const [videos, setVideos] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveProgress, setMoveProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [autoPlay, setAutoPlay] = useState(true);
  const [lastBatch, setLastBatch] = useState<BatchMoveResult | null>(null);

  const current = videos[index] ?? null;
  const mediaUrl = useMemo(
    () => (current ? window.videoTools.toMediaUrl(current) : null),
    [current],
  );

  const removeCurrentFromList = useCallback((filePath: string) => {
    setVideos((prev) => {
      const next = prev.filter((p) => p !== filePath);
      setIndex((i) => {
        if (next.length === 0) return 0;
        return Math.min(i, next.length - 1);
      });
      return next;
    });
  }, []);

  const loadFolder = useCallback(async (folderPath: string) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setLastBatch(null);
    try {
      const list = await window.videoTools.listVideos(folderPath);
      setVideos(list);
      setIndex(0);
      if (list.length === 0) {
        setNotice("该目录下未找到视频文件");
      } else {
        setNotice(`已加载 ${list.length} 个视频`);
      }
    } catch (err) {
      setVideos([]);
      setIndex(0);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  async function onFolderChange(path: string | null) {
    setFolder(path);
    if (path) await loadFolder(path);
    else {
      setVideos([]);
      setIndex(0);
    }
  }

  async function pickDest() {
    const path = await window.videoTools.selectFolder();
    if (!path) return;
    setDest(path);
    setNotice(`已设置上传目的地：${path}`);
    setError(null);
  }

  function clearDestFolder() {
    clearDest();
    setNotice("已清除上传目的地");
  }

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(videos.length - 1, i + 1));
  }, [videos.length]);

  const trashCurrent = useCallback(async () => {
    if (!current || trashing || moving) return;
    const name = baseName(current);
    const confirmed = window.confirm(
      `将「${name}」移到废纸篓？\n\n可从废纸篓恢复。`,
    );
    if (!confirmed) return;

    setTrashing(true);
    setError(null);
    try {
      const result = await window.videoTools.trashItems([current]);
      if (result.failed.length > 0) {
        setError(result.failed[0]?.error || "移到废纸篓失败");
        return;
      }
      removeCurrentFromList(current);
      setNotice(`已移到废纸篓：${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrashing(false);
    }
  }, [current, trashing, moving, removeCurrentFromList]);

  async function uploadAll() {
    if (!uploadDest || videos.length === 0 || moving) return;

    const confirmed = window.confirm(
      `将把当前扫描到的全部 ${videos.length} 个视频 mv 到：\n${uploadDest}\n\n确定继续？`,
    );
    if (!confirmed) return;

    setMoving(true);
    setError(null);
    setNotice(null);
    setLastBatch(null);
    setMoveProgress(`0 / ${videos.length}`);

    const snapshot = [...videos];
    try {
      setMoveProgress(`正在移动 ${snapshot.length} 个文件…`);
      const result = await window.videoTools.moveManyToDir({
        sourcePaths: snapshot,
        destDir: uploadDest,
      });
      setLastBatch(result);

      const movedFrom = new Set(result.moved.map((m) => m.from));
      setVideos((prev) => {
        const next = prev.filter((p) => !movedFrom.has(p));
        setIndex(0);
        return next;
      });

      const lines = [
        `上传完成：成功 ${result.moved.length} / ${result.total}`,
        `校验通过：${result.verifiedOk}`,
        result.failed.length > 0 ? `失败：${result.failed.length}` : null,
        result.verifyFailed.length > 0
          ? `校验异常：${result.verifyFailed.length}`
          : null,
        `目的地：${result.destDir}`,
      ]
        .filter(Boolean)
        .join("\n");

      window.alert(lines);

      if (result.allOk) {
        setNotice(
          `全部 ${result.moved.length} 个视频已 mv 到目的地，校验通过`,
        );
      } else {
        setError(
          `部分未完成：失败 ${result.failed.length}，校验异常 ${result.verifyFailed.length}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoving(false);
      setMoveProgress(null);
    }
  }

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !mediaUrl) return;
    el.load();
    if (autoPlay) {
      void el.play().catch(() => {
        /* 用户手势限制时忽略 */
      });
    }
  }, [mediaUrl, autoPlay]);

  useEffect(() => {
    const active = listRef.current?.querySelector(".browse-list__item.is-active");
    active?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useBrowseHotkeys({
    prev: goPrev,
    next: goNext,
    trash: () => void trashCurrent(),
    togglePlay: () => {
      const el = videoRef.current;
      if (!el) return;
      if (el.paused) void el.play();
      else el.pause();
    },
  });

  const busy = loading || trashing || moving;
  const hasVideos = videos.length > 0;

  return (
    <div className="browse">
      <FolderPicker
        value={folder}
        onChange={onFolderChange}
        disabled={busy}
        label="视频目录（递归扫描）"
      />

      <UploadDestBar
        label="上传目的地 — 浏览确认后，将扫描到的全部视频 mv 到此处"
        dest={uploadDest}
        count={videos.length}
        unit="个视频"
        busy={busy}
        moving={moving}
        moveProgress={moveProgress}
        onPick={() => void pickDest()}
        onClear={clearDestFolder}
        onUpload={() => void uploadAll()}
      />

      <div className="panel controls browse-toolbar">
        <button
          type="button"
          className="btn"
          disabled={busy || !folder}
          onClick={() => folder && loadFolder(folder)}
        >
          {loading ? "扫描中…" : "重新扫描"}
        </button>
        <label className="browse-autoplay">
          <input
            type="checkbox"
            checked={autoPlay}
            onChange={(e) => setAutoPlay(e.target.checked)}
          />
          切换后自动播放
        </label>
        <span className="muted browse-hint">
          ←/→ 切换 · Space 播放 · Delete 废纸篓 · 浏览完后点上方「上传全部」
        </span>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {notice && !error && <div className="banner banner-info">{notice}</div>}

      <BatchResultBanner result={lastBatch} />

      <div className="browse-layout">
        <div className="browse-player panel">
          {mediaUrl ? (
            <video
              key={mediaUrl}
              ref={videoRef}
              className="browse-player__video"
              src={mediaUrl}
              controls
              playsInline
            />
          ) : (
            <div className="browse-player__empty muted">
              {folder ? "请选择列表中的视频" : "请先选择文件夹"}
            </div>
          )}

          <div className="browse-meta">
            {current ? (
              <>
                <div className="browse-meta__title" title={current}>
                  {baseName(current)}
                </div>
                <button
                  type="button"
                  className="linkish browse-meta__path"
                  title="在访达中显示"
                  onClick={() => window.videoTools.showItemInFolder(current)}
                >
                  {current}
                </button>
                <div className="muted">
                  {index + 1} / {videos.length}
                </div>
              </>
            ) : (
              <div className="muted">无当前视频</div>
            )}
          </div>

          <div className="browse-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || !hasVideos || index <= 0}
              onClick={goPrev}
            >
              上一条
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !hasVideos || index >= videos.length - 1}
              onClick={goNext}
            >
              下一条
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || !current}
              onClick={() => void trashCurrent()}
            >
              {trashing ? "处理中…" : "删到废纸篓"}
            </button>
          </div>
        </div>

        <aside className="browse-list panel" ref={listRef}>
          <div className="browse-list__head">
            视频列表
            <span className="muted">{videos.length}</span>
          </div>
          {videos.length === 0 ? (
            <p className="muted browse-list__empty">暂无视频</p>
          ) : (
            <ul className="browse-list__ul">
              {videos.map((p, i) => (
                <li key={p}>
                  <button
                    type="button"
                    className={`browse-list__item ${i === index ? "is-active" : ""}`}
                    onClick={() => setIndex(i)}
                    title={p}
                  >
                    <span className="browse-list__idx">{i + 1}</span>
                    <span className="browse-list__name">{baseName(p)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
