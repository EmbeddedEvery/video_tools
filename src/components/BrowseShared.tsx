import { useCallback, useEffect, useRef, useState } from "react";
import { baseName } from "@/lib/media";
import type { BatchMoveResult, DedupProgress } from "@/types/api";

export function useUploadDest(storageKey: string) {
  const [dest, setDestState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });

  const setDest = useCallback(
    (value: string) => {
      setDestState(value);
      try {
        localStorage.setItem(storageKey, value);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    setDestState(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { dest, setDest, clear };
}

type Hotkeys = {
  prev: () => void;
  next: () => void;
  trash: () => void;
  togglePlay?: () => void;
};

/** 方向键切换、Delete 删到废纸篓、Space 播放（可选） */
export function useBrowseHotkeys(handlers: Hotkeys) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const h = ref.current;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        h.prev();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        h.next();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        h.trash();
      } else if (e.key === " " && h.togglePlay) {
        e.preventDefault();
        h.togglePlay();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

type UploadDestBarProps = {
  label: string;
  dest: string | null;
  count: number;
  unit: string;
  busy: boolean;
  moving: boolean;
  moveProgress: string | null;
  onPick: () => void;
  onClear: () => void;
  onUpload: () => void;
};

export function UploadDestBar({
  label,
  dest,
  count,
  unit,
  busy,
  moving,
  moveProgress,
  onPick,
  onClear,
  onUpload,
}: UploadDestBarProps) {
  const title = !dest
    ? "请先设置目的地"
    : count === 0
      ? `没有可上传的${unit}`
      : `将 ${count}${unit}全部 mv 到目的地`;

  return (
    <div className="folder-picker">
      <div className="folder-picker__label">{label}</div>
      <div className="folder-picker__row">
        <div
          className={`folder-picker__path ${dest ? "" : "is-empty"}`}
          title={dest ?? undefined}
        >
          {dest || "尚未设置目的地"}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onPick}
          disabled={busy}
        >
          设置目的地
        </button>
        {dest && (
          <button type="button" className="btn" onClick={onClear} disabled={busy}>
            清除
          </button>
        )}
        <button
          type="button"
          className="btn btn-accent"
          disabled={busy || !dest || count === 0}
          onClick={onUpload}
          title={title}
        >
          {moving ? moveProgress || "上传中…" : `上传全部 (${count})`}
        </button>
      </div>
    </div>
  );
}

export function BatchResultBanner({ result }: { result: BatchMoveResult | null }) {
  if (!result) return null;

  const problems = [
    ...result.failed.map((f) => `失败  ${baseName(f.path)}  ${f.error}`),
    ...result.verifyFailed.map(
      (m) =>
        `校验异常  ${baseName(m.from)} → ${baseName(m.to)}  sourceGone=${m.sourceGone} destOk=${m.destOk}`,
    ),
  ];

  return (
    <div className={`banner ${result.allOk ? "banner-info" : "banner-warn"}`}>
      <div>
        上次上传校验：成功 {result.moved.length}/{result.total}，校验通过{" "}
        {result.verifiedOk}
        {result.failed.length > 0 ? `，失败 ${result.failed.length}` : ""}
        {result.verifyFailed.length > 0
          ? `，校验异常 ${result.verifyFailed.length}`
          : ""}
      </div>
      <button
        type="button"
        className="linkish"
        onClick={() => window.videoTools.openPath(result.destDir)}
      >
        打开目的地文件夹
      </button>
      {problems.length > 0 && (
        <details className="batch-detail">
          <summary>查看明细</summary>
          <pre>{problems.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

export function ProgressBar({ progress }: { progress: DedupProgress | null }) {
  const pct =
    progress && progress.total
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="panel progress">
      <div className="progress__meta">
        <span>
          {progress ? `${progress.current} / ${progress.total}` : "准备中…"}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="progress__bar">
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      {progress?.file && (
        <div className="progress__file" title={progress.file}>
          {progress.file}
        </div>
      )}
    </div>
  );
}
