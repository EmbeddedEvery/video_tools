import { useEffect, useState } from "react";
import { FolderPicker } from "@/components/FolderPicker";
import { ProgressBar } from "@/components/BrowseShared";
import { autoSelectForTrash, baseName, pickKeeper } from "@/lib/media";
import type {
  DedupGroup,
  DedupIndex,
  DedupProgress,
  FfmpegStatus,
} from "@/types/api";

type Method = "ahash" | "md5";

export function VideoDedupTool() {
  const [folder, setFolder] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("ahash");
  const [threshold, setThreshold] = useState(5);
  const [running, setRunning] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [progress, setProgress] = useState<DedupProgress | null>(null);
  const [index, setIndex] = useState<DedupIndex | null>(null);
  const [groups, setGroups] = useState<DedupGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    window.videoTools.ffmpegStatus().then(setFfmpeg).catch(() => {
      setFfmpeg({ ffmpeg: false, ffprobe: false, ffmpegPath: null, ffprobePath: null });
    });
  }, []);

  useEffect(() => {
    return window.videoTools.onDedupProgress((p) => {
      setProgress(p);
      if (p.status === "ok" || p.status === "fail") {
        const name = baseName(p.file);
        const line =
          p.status === "ok"
            ? `✓ ${name}  ${p.hash?.slice(0, 12)}…`
            : `✗ ${name}  ${p.error}`;
        setLog((prev) => [...prev.slice(-200), line]);
      }
    });
  }, []);

  const selectedCount = selected.size;

  async function runScan() {
    if (!folder) {
      setError("请先选择文件夹");
      return;
    }
    setError(null);
    setNotice(null);
    setRunning(true);
    setGroups([]);
    setSelected(new Set());
    setIndex(null);
    setLog([]);
    setProgress(null);

    try {
      const nextIndex = await window.videoTools.dedupIndex({
        folderPath: folder,
        method,
      });
      setIndex(nextIndex);
      const found = await window.videoTools.dedupFind({
        index: nextIndex,
        threshold: method === "ahash" ? threshold : 0,
      });
      setGroups(found);
      const auto = autoSelectForTrash(found);
      setSelected(auto);
      if (found.length > 0) {
        setNotice(
          `已自动勾选 ${auto.size} 个重复项（每组保留文件名最短的一个）`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function togglePath(filePath: string) {
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
    setNotice(`已重新勾选 ${auto.size} 个重复项（保留最短文件名）`);
  }

  function clearSelection() {
    setSelected(new Set());
    setNotice(null);
  }

  async function trashSelected() {
    const paths = [...selected];
    if (paths.length === 0) return;

    const confirmed = window.confirm(
      `将把 ${paths.length} 个视频移到废纸篓（可从废纸篓恢复）。\n\n确定继续？`,
    );
    if (!confirmed) return;

    setTrashing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.videoTools.trashItems(paths);
      const trashed = new Set(result.ok);

      setGroups((prev) =>
        prev
          .map((g) => ({
            ...g,
            paths: g.paths.filter((p) => !trashed.has(p)),
          }))
          .filter((g) => g.paths.length >= 2),
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const p of trashed) next.delete(p);
        return next;
      });
      setIndex((prev) => {
        if (!prev) return prev;
        const entries = { ...prev.entries };
        for (const p of trashed) delete entries[p];
        return { ...prev, entries };
      });

      if (result.failed.length > 0) {
        setError(
          `已移到废纸篓 ${result.ok.length} 个；失败 ${result.failed.length} 个：${result.failed
            .slice(0, 3)
            .map((f) => `${baseName(f.path)} (${f.error})`)
            .join("；")}`,
        );
      } else {
        setNotice(`已将 ${result.ok.length} 个视频移到废纸篓`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrashing(false);
    }
  }

  const ffmpegOk = ffmpeg?.ffmpeg && ffmpeg?.ffprobe;
  const busy = running || trashing;

  return (
    <div className="dedup">
      {!ffmpegOk && ffmpeg && (
        <div className="banner banner-warn">
          未检测到 ffmpeg / ffprobe。请安装后重启应用
          （macOS: <code>brew install ffmpeg</code>）。
        </div>
      )}

      <FolderPicker value={folder} onChange={setFolder} disabled={busy} />

      <div className="panel controls">
        <label className="field">
          <span>Hash 方式</span>
          <select
            value={method}
            disabled={busy}
            onChange={(e) => setMethod(e.target.value as Method)}
          >
            <option value="ahash">感知 hash（抗重编码）</option>
            <option value="md5">中间帧 MD5（精确）</option>
          </select>
        </label>

        <label className={`field ${method === "md5" ? "is-dim" : ""}`}>
          <span>相似阈值（汉明距离 ≤）</span>
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
          className="btn btn-accent"
          disabled={busy || !folder || !ffmpegOk}
          onClick={runScan}
        >
          {running ? "扫描中…" : "开始查重"}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {notice && !error && <div className="banner banner-info">{notice}</div>}

      {(running || progress) && <ProgressBar progress={progress} />}

      {index && !running && (
        <div className="stats">
          <div className="stat">
            <div className="stat__n">{index.total}</div>
            <div className="stat__l">视频</div>
          </div>
          <div className="stat">
            <div className="stat__n">{Object.keys(index.entries).length}</div>
            <div className="stat__l">已哈希</div>
          </div>
          <div className="stat">
            <div className="stat__n">{groups.length}</div>
            <div className="stat__l">重复组</div>
          </div>
          <div className="stat">
            <div className="stat__n">{selectedCount}</div>
            <div className="stat__l">已勾选</div>
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="panel action-bar">
          <div className="action-bar__text">
            每组保留<strong>文件名最短</strong>的一个，其余已勾选。可手动改勾选。
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
              onClick={clearSelection}
            >
              清空勾选
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || selectedCount === 0}
              onClick={trashSelected}
            >
              {trashing
                ? "正在移到废纸篓…"
                : `移到废纸篓（${selectedCount}）`}
            </button>
          </div>
        </div>
      )}

      <div className="results">
        <h2>查重结果</h2>
        {!running && index && groups.length === 0 && (
          <p className="muted">未发现重复或相似视频。</p>
        )}
        {groups.map((g, i) => {
          const keep = pickKeeper(g.paths);
          return (
            <section key={`${g.hash}-${i}`} className="dup-group">
              <header>
                <strong>组 #{i + 1}</strong>
                <span className="muted">
                  {method === "ahash" ? `最大距离 ${g.distance}` : "精确匹配"} ·{" "}
                  {g.paths.length} 个文件
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
                          onChange={() => togglePath(p)}
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
                            title="在访达中显示"
                            onClick={(e) => {
                              e.preventDefault();
                              window.videoTools.showItemInFolder(p);
                            }}
                          >
                            {p}
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

      {log.length > 0 && (
        <details className="log">
          <summary>扫描日志（{log.length}）</summary>
          <pre>{log.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}
