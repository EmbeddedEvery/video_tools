#!/usr/bin/env python3
"""
视频查重：提取中间帧并生成 hash，用 hash 判断是否重复。

依赖：ffmpeg / ffprobe（系统已安装）、Pillow（可选，用于感知 hash）
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".m4v", ".wmv", ".ts"}


def require_bin(name: str) -> str:
    path = shutil.which(name)
    if not path:
        sys.exit(f"未找到 {name}，请先安装并加入 PATH")
    return path


FFPROBE = require_bin("ffprobe")
FFMPEG = require_bin("ffmpeg")


def probe_duration(video: Path) -> float:
    """返回视频时长（秒）。"""
    cmd = [
        FFPROBE,
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(video),
    ]
    out = subprocess.check_output(cmd, text=True).strip()
    if not out or out == "N/A":
        raise RuntimeError(f"无法读取时长: {video}")
    return float(out)


def extract_middle_frame(video: Path, out_png: Path) -> None:
    """定位到视频中间时间点，导出一帧 PNG。"""
    duration = probe_duration(video)
    # 极短视频取起点，否则取正中间
    ts = 0.0 if duration < 0.2 else duration / 2.0
    cmd = [
        FFMPEG,
        "-hide_banner", "-loglevel", "error",
        "-ss", f"{ts:.3f}",
        "-i", str(video),
        "-frames:v", "1",
        "-y",
        str(out_png),
    ]
    subprocess.check_call(cmd)
    if not out_png.exists() or out_png.stat().st_size == 0:
        raise RuntimeError(f"中间帧提取失败: {video}")


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def average_hash(png: Path, size: int = 16) -> str:
    """
    简单感知 hash（aHash）：缩放到 size×size 灰度图，按均值二值化。
    对重编码/轻微压缩更稳；完全相同内容几乎一定相同。
    """
    try:
        from PIL import Image
    except ImportError:
        sys.exit("感知 hash 需要 Pillow：pip install Pillow")

    with Image.open(png) as im:
        im = im.convert("L").resize((size, size), Image.Resampling.LANCZOS)
        pixels = list(im.getdata())
    avg = sum(pixels) / len(pixels)
    bits = "".join("1" if p >= avg else "0" for p in pixels)
    # 压成十六进制，长度 = size*size/4
    return f"{int(bits, 2):0{size * size // 4}x}"


def hamming(a: str, b: str) -> int:
    """十六进制 aHash 的汉明距离。"""
    if len(a) != len(b):
        return max(len(a), len(b)) * 4
    xa, xb = int(a, 16), int(b, 16)
    return (xa ^ xb).bit_count()


def frame_hash(video: Path, method: str = "ahash") -> str:
    """提取中间帧并计算 hash。"""
    with tempfile.TemporaryDirectory(prefix="vdedup_") as tmp:
        png = Path(tmp) / "mid.png"
        extract_middle_frame(video, png)
        if method == "md5":
            return md5_file(png)
        if method == "ahash":
            return average_hash(png)
        raise ValueError(f"未知 method: {method}")


def iter_videos(root: Path) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix.lower() in VIDEO_EXTS else []
    return sorted(
        p for p in root.rglob("*")
        if p.is_file() and p.suffix.lower() in VIDEO_EXTS
    )


def load_index(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"method": "ahash", "entries": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def save_index(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cmd_hash(args: argparse.Namespace) -> None:
    video = Path(args.video).resolve()
    h = frame_hash(video, args.method)
    print(h)


def cmd_index(args: argparse.Namespace) -> None:
    root = Path(args.path).resolve()
    index_path = Path(args.index).resolve()
    data = load_index(index_path)
    data["method"] = args.method
    entries: dict[str, str] = data.setdefault("entries", {})

    videos = iter_videos(root)
    if not videos:
        print("未找到视频文件", file=sys.stderr)
        return

    ok, fail = 0, 0
    for i, video in enumerate(videos, 1):
        key = str(video)
        if not args.force and key in entries:
            print(f"[{i}/{len(videos)}] skip {video.name}")
            continue
        try:
            h = frame_hash(video, args.method)
            entries[key] = h
            ok += 1
            print(f"[{i}/{len(videos)}] {h}  {video.name}")
        except Exception as e:
            fail += 1
            print(f"[{i}/{len(videos)}] FAIL {video.name}: {e}", file=sys.stderr)

    save_index(index_path, data)
    print(f"完成：成功 {ok}，失败 {fail}，索引 {index_path}")


def cmd_check(args: argparse.Namespace) -> None:
    video = Path(args.video).resolve()
    index_path = Path(args.index).resolve()
    data = load_index(index_path)
    method = args.method or data.get("method", "ahash")
    entries: dict[str, str] = data.get("entries", {})
    if not entries:
        print("索引为空，请先运行 index", file=sys.stderr)
        sys.exit(1)

    h = frame_hash(video, method)
    threshold = args.threshold

    matches: list[tuple[str, int | None]] = []
    for path, stored in entries.items():
        if Path(path).resolve() == video:
            continue
        if method == "md5":
            if stored == h:
                matches.append((path, 0))
        else:
            dist = hamming(h, stored)
            if dist <= threshold:
                matches.append((path, dist))

    matches.sort(key=lambda x: (x[1] if x[1] is not None else 0, x[0]))

    print(f"hash={h}  method={method}")
    if not matches:
        print("未发现重复")
        sys.exit(0)

    print(f"发现 {len(matches)} 个相似/重复：")
    for path, dist in matches:
        tag = f"dist={dist}" if dist is not None else "exact"
        print(f"  [{tag}] {path}")
    sys.exit(2)  # 非零表示有重复，便于脚本判断


def cmd_find(args: argparse.Namespace) -> None:
    """在目录内两两查重（可先建索引再比对，也可一次性扫完）。"""
    root = Path(args.path).resolve()
    index_path = Path(args.index).resolve() if args.index else None
    method = args.method

    if index_path and index_path.exists() and not args.rebuild:
        data = load_index(index_path)
        method = data.get("method", method)
        entries: dict[str, str] = dict(data.get("entries", {}))
    else:
        entries = {}
        videos = iter_videos(root)
        for i, video in enumerate(videos, 1):
            try:
                entries[str(video)] = frame_hash(video, method)
                print(f"[{i}/{len(videos)}] hashed {video.name}", file=sys.stderr)
            except Exception as e:
                print(f"[{i}/{len(videos)}] FAIL {video.name}: {e}", file=sys.stderr)
        if index_path:
            save_index(index_path, {"method": method, "entries": entries})

    # 按 hash 分组（md5 精确；ahash 再按阈值聚类）
    items = list(entries.items())
    reported: set[frozenset[str]] = set()
    groups = 0

    if method == "md5":
        buckets: dict[str, list[str]] = {}
        for path, h in items:
            buckets.setdefault(h, []).append(path)
        for h, paths in buckets.items():
            if len(paths) < 2:
                continue
            groups += 1
            print(f"\n=== 重复组 #{groups}  hash={h} ===")
            for p in paths:
                print(f"  {p}")
    else:
        n = len(items)
        for i in range(n):
            for j in range(i + 1, n):
                p1, h1 = items[i]
                p2, h2 = items[j]
                dist = hamming(h1, h2)
                if dist <= args.threshold:
                    key = frozenset((p1, p2))
                    if key in reported:
                        continue
                    reported.add(key)
                    groups += 1
                    print(f"\n=== 相似对 #{groups}  dist={dist} ===")
                    print(f"  {p1}")
                    print(f"  {p2}")

    if groups == 0:
        print("未发现重复")
    else:
        print(f"\n共 {groups} 组", file=sys.stderr)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="基于视频中间帧 hash 的查重工具",
    )
    p.add_argument(
        "--method",
        choices=("ahash", "md5"),
        default="ahash",
        help="ahash=感知hash(默认，抗重编码)；md5=中间帧文件精确hash",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("hash", help="计算单个视频的中间帧 hash")
    sp.add_argument("video")
    sp.set_defaults(func=cmd_hash)

    sp = sub.add_parser("index", help="扫描目录，写入 hash 索引")
    sp.add_argument("path", help="视频文件或目录")
    sp.add_argument("-o", "--index", default="video_hashes.json", help="索引文件路径")
    sp.add_argument("--force", action="store_true", help="已存在也重新计算")
    sp.set_defaults(func=cmd_index)

    sp = sub.add_parser("check", help="对照索引检查某视频是否重复")
    sp.add_argument("video")
    sp.add_argument("-i", "--index", default="video_hashes.json")
    sp.add_argument(
        "-t", "--threshold",
        type=int, default=5,
        help="ahash 汉明距离阈值（越小越严，默认 5）",
    )
    sp.set_defaults(func=cmd_check)

    sp = sub.add_parser("find", help="在目录内查找重复/相似视频")
    sp.add_argument("path")
    sp.add_argument("-o", "--index", default="video_hashes.json", help="读写索引")
    sp.add_argument("--rebuild", action="store_true", help="忽略旧索引，重新计算")
    sp.add_argument("-t", "--threshold", type=int, default=5)
    sp.set_defaults(func=cmd_find)

    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
