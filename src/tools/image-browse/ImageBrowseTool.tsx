import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderPicker } from "@/components/FolderPicker";
import {
  BatchResultBanner,
  ProgressBar,
  UploadDestBar,
  useBrowseHotkeys,
  useUploadDest,
} from "@/components/BrowseShared";
import { autoSelectForTrash, baseName, pickKeeper } from "@/lib/media";
import type {
  BatchMoveResult,
  DedupGroup,
  DedupProgress,
} from "@/types/api";

const DEST_KEY = "image-browse.uploadDest";

type Method = "ahash" | "md5";

export function ImageBrowseTool() {
  const listRef = useRef<HTMLDivElement>(null);

  const [folder, setFolder] = useState<string | null>(null);
  const { dest: uploadDest, setDest, clear: clearDest } = useUploadDest(DEST_KEY);
  const [images, setImages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const [moveProgress, setMoveProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastBatch, setLastBatch] = useState<BatchMoveResult | null>(null);

  const [method, setMethod] = useState<Method>("ahash");
  const [threshold, setThreshold] = useState(5);
  const [dedupProgress, setDedupProgress] = useState<DedupProgress | null>(null);
  const [groups, setGroups] = useState<DedupGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const current = images[index] ?? null;
  const mediaUrl = useMemo(
    () => (current ? window.videoTools.toMediaUrl(current) : null),
    [current],
  );

  const dupPaths = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      for (const p of g.paths) set.add(p);
    }
    return set;
  }, [groups]);

  const keepPaths = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      if (g.paths.length >= 2) set.add(pickKeeper(g.paths));
    }
    return set;
  }, [groups]);

  const selectedCount = selected.size;

  const removePaths = useCallback((paths: string[]) => {
    const gone = new Set(paths);
    setImages((prev) => {
      const next = prev.filter((p) => !gone.has(p));
      setIndex((i) => {
        if (next.length === 0) return 0;
        return Math.min(i, next.length - 1);
      });
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of gone) next.delete(p);
      return next;
    });
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, paths: g.paths.filter((p) => !gone.has(p)) }))
        .filter((g) => g.paths.length >= 2),
    );
  }, []);

  const clearDedup = useCallback(() => {
    setGroups([]);
    setSelected(new Set());
    setDedupProgress(null);
  }, []);

  const loadFolder = useCallback(
    async (folderPath: string) => {
      setLoading(true);
      setError(null);
      setNotice(null);
      setLastBatch(null);
      clearDedup();
      try {
        const list = await window.videoTools.listImages(folderPath);
        setImages(list);
        setIndex(0);
        if (list.length === 0) {
          setNotice("该目录下未找到图片文件");
        } else {
          setNotice(`已加载 ${list.length} 张图片`);
        }
      } catch (err) {
        setImages([]);
        setIndex(0);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [clearDedup],
  );

  useEffect(() => {
    return window.videoTools.onImagesProgress((p) => {
      setDedupProgress(p);
    });
  }, []);

  async function onFolderChange(path: string | null) {
    setFolder(path);
    if (path) await loadFolder(path);
    else {
      setImages([]);
      setIndex(0);
      clearDedup();
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
    setIndex((i) => Math.min(images.length - 1, i + 1));
  }, [images.length]);

  const trashCurrent = useCallback(async () => {
    if (!current || trashing || moving || deduping) return;
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
      removePaths([current]);
      setNotice(`已移到废纸篓：${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrashing(false);
    }
  }, [current, trashing, moving, deduping, removePaths]);

  async function runDedup() {
    if (images.length < 2 || deduping) return;
    setDeduping(true);
    setError(null);
    setNotice(null);
    setGroups([]);
    setSelected(new Set());
    setDedupProgress(null);

    try {
      const nextIndex = await window.videoTools.indexImages({
        paths: images,
        method,
      });
      const found = await window.videoTools.dedupFind({
        index: nextIndex,
        threshold: method === "ahash" ? threshold : 0,
      });
      setGroups(found);
      const auto = autoSelectForTrash(found);
      setSelected(auto);
      if (found.length === 0) {
        setNotice("未发现重复或相似图片");
      } else {
        setNotice(
          `发现 ${found.length} 组重复，已自动勾选 ${auto.size} 张（每组保留文件名最短）`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeduping(false);
    }
  }

  function toggleSelected(filePath: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  function reAutoSelect() {
    const auto = autoSelectForTrash(groups);
    setSelected(auto);
    setNotice(`已重新勾选 ${auto.size} 张重复项（保留最短文件名）`);
  }

  async function trashSelectedDups() {
    const paths = [...selected];
    if (paths.length === 0) return;
    const confirmed = window.confirm(
      `将把勾选的 ${paths.length} 张重复图片移到废纸篓？\n\n可从废纸篓恢复。`,
    );
    if (!confirmed) return;

    setTrashing(true);
    setError(null);
    try {
      const result = await window.videoTools.trashItems(paths);
      removePaths(result.ok);
      if (result.failed.length > 0) {
        setError(
          `已删除 ${result.ok.length} 张；失败 ${result.failed.length} 张`,
        );
      } else {
        setNotice(`已将 ${result.ok.length} 张重复图片移到废纸篓`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrashing(false);
    }
  }

  async function uploadAll() {
    if (!uploadDest || images.length === 0 || moving) return;

    const confirmed = window.confirm(
      `将把当前扫描到的全部 ${images.length} 张图片 mv 到：\n${uploadDest}\n\n确定继续？`,
    );
    if (!confirmed) return;

    setMoving(true);
    setError(null);
    setNotice(null);
    setLastBatch(null);
    setMoveProgress(`0 / ${images.length}`);

    const snapshot = [...images];
    try {
      setMoveProgress(`正在移动 ${snapshot.length} 个文件…`);
      const result = await window.videoTools.moveManyToDir({
        sourcePaths: snapshot,
        destDir: uploadDest,
      });
      setLastBatch(result);

      const movedFrom = new Set(result.moved.map((m) => m.from));
      setImages((prev) => {
        const next = prev.filter((p) => !movedFrom.has(p));
        setIndex(0);
        return next;
      });
      clearDedup();

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
          `全部 ${result.moved.length} 张图片已 mv 到目的地，校验通过`,
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
    const active = listRef.current?.querySelector(".browse-list__item.is-active");
    active?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useBrowseHotkeys({
    prev: goPrev,
    next: goNext,
    trash: () => void trashCurrent(),
  });

  const busy = loading || trashing || moving || deduping;
  const hasImages = images.length > 0;

  return (
    <div className="browse">
      <FolderPicker
        value={folder}
        onChange={onFolderChange}
        disabled={busy}
        label="图片目录（递归扫描）"
      />

      <UploadDestBar
        label="上传目的地 — 浏览 / 查重确认后，将列表中的图片 mv 到此处"
        dest={uploadDest}
        count={images.length}
        unit="张图片"
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

        <label className="field">
          <span>查重方式</span>
          <select
            value={method}
            disabled={busy}
            onChange={(e) => setMethod(e.target.value as Method)}
          >
            <option value="ahash">感知 hash（相似）</option>
            <option value="md5">文件 MD5（精确）</option>
          </select>
        </label>

        <label className={`field ${method === "md5" ? "is-dim" : ""}`}>
          <span>相似阈值</span>
          <input
            type="number"
            min={0}
            max={64}
            value={threshold}
            disabled={busy || method === "md5"}
            onChange={(e) => setThreshold(Number(e.target.value) || 0)}
          />
        </label>

        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || images.length < 2}
          onClick={() => void runDedup()}
        >
          {deduping ? "查重中…" : "图片查重"}
        </button>

        <span className="muted browse-hint">
          ←/→ 切换 · Delete 废纸篓 · 查重后可批量删重复项
        </span>
      </div>

      {(deduping || dedupProgress) && <ProgressBar progress={dedupProgress} />}

      {error && <div className="banner banner-error">{error}</div>}
      {notice && !error && <div className="banner banner-info">{notice}</div>}

      {groups.length > 0 && (
        <div className="panel action-bar">
          <div className="action-bar__text">
            查重结果：{groups.length} 组 · 已勾选{" "}
            <strong>{selectedCount}</strong> 张（每组保留文件名最短）
          </div>
          <div className="action-bar__btns">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={reAutoSelect}
            >
              按最短名重选
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || selectedCount === 0}
              onClick={() => setSelected(new Set())}
            >
              清空勾选
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || selectedCount === 0}
              onClick={() => void trashSelectedDups()}
            >
              {trashing
                ? "处理中…"
                : `删掉勾选重复项（${selectedCount}）`}
            </button>
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="results image-dedup-groups">
          <h2>重复组</h2>
          {groups.map((g, gi) => {
            const keep = pickKeeper(g.paths);
            return (
              <section key={`${g.hash}-${gi}`} className="dup-group">
                <header>
                  <strong>组 #{gi + 1}</strong>
                  <span className="muted">
                    {method === "ahash"
                      ? `最大距离 ${g.distance}`
                      : "精确匹配"}{" "}
                    · {g.paths.length} 张
                  </span>
                </header>
                <ul className="dup-list">
                  {g.paths.map((p) => {
                    const isKeep = p === keep;
                    const checked = selected.has(p);
                    return (
                      <li
                        key={p}
                        className={`dup-row ${isKeep ? "is-keep" : ""} ${checked ? "is-checked" : ""}`}
                      >
                        <label className="dup-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={() => toggleSelected(p)}
                          />
                          <span className="dup-check__meta">
                            {isKeep ? (
                              <span className="tag tag-keep">保留</span>
                            ) : (
                              <span className="tag tag-dup">重复</span>
                            )}
                            <button
                              type="button"
                              className="linkish"
                              onClick={(e) => {
                                e.preventDefault();
                                const i = images.indexOf(p);
                                if (i >= 0) setIndex(i);
                              }}
                            >
                              {baseName(p)}
                            </button>
                            <span className="dup-name-len muted">
                              名长 {baseName(p).length}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <BatchResultBanner result={lastBatch} />

      <div className="browse-layout">
        <div className="browse-player panel">
          {mediaUrl ? (
            <div className="browse-image-wrap">
              <img
                key={mediaUrl}
                className="browse-player__image"
                src={mediaUrl}
                alt={current ? baseName(current) : ""}
                draggable={false}
              />
            </div>
          ) : (
            <div className="browse-player__empty muted">
              {folder ? "请选择列表中的图片" : "请先选择文件夹"}
            </div>
          )}

          <div className="browse-meta">
            {current ? (
              <>
                <div className="browse-meta__title" title={current}>
                  {baseName(current)}
                  {keepPaths.has(current) && (
                    <span className="tag tag-keep" style={{ marginLeft: 8 }}>
                      保留
                    </span>
                  )}
                  {dupPaths.has(current) &&
                    !keepPaths.has(current) &&
                    selected.has(current) && (
                      <span className="tag tag-dup" style={{ marginLeft: 8 }}>
                        重复
                      </span>
                    )}
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
                  {index + 1} / {images.length}
                </div>
              </>
            ) : (
              <div className="muted">无当前图片</div>
            )}
          </div>

          <div className="browse-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || !hasImages || index <= 0}
              onClick={goPrev}
            >
              上一条
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !hasImages || index >= images.length - 1}
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
            图片列表
            <span className="muted">{images.length}</span>
          </div>
          {images.length === 0 ? (
            <p className="muted browse-list__empty">暂无图片</p>
          ) : (
            <ul className="browse-list__ul">
              {images.map((p, i) => (
                <li key={p}>
                  <button
                    type="button"
                    className={`browse-list__item ${i === index ? "is-active" : ""} ${dupPaths.has(p) ? "is-dup" : ""}`}
                    onClick={() => setIndex(i)}
                    title={p}
                  >
                    <span className="browse-list__idx">{i + 1}</span>
                    <span className="browse-list__name">{baseName(p)}</span>
                    {keepPaths.has(p) && (
                      <span className="tag tag-keep">留</span>
                    )}
                    {dupPaths.has(p) && !keepPaths.has(p) && (
                      <span className="tag tag-dup">重</span>
                    )}
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
