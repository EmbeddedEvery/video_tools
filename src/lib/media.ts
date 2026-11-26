import type { DedupGroup } from "@/types/api";

export function baseName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

/** 每组保留文件名最短的一个；同长度时保留路径字典序更小的 */
export function pickKeeper(paths: string[]): string {
  return [...paths].sort((a, b) => {
    const na = baseName(a);
    const nb = baseName(b);
    if (na.length !== nb.length) return na.length - nb.length;
    return a.localeCompare(b);
  })[0];
}

export function autoSelectForTrash(groups: DedupGroup[]): Set<string> {
  const selected = new Set<string>();
  for (const g of groups) {
    if (g.paths.length < 2) continue;
    const keep = pickKeeper(g.paths);
    for (const p of g.paths) {
      if (p !== keep) selected.add(p);
    }
  }
  return selected;
}
