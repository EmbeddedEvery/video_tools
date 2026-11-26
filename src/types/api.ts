export type DedupProgress = {
  current: number;
  total: number;
  file: string;
  status: "hashing" | "ok" | "fail";
  hash?: string;
  error?: string;
};

export type DedupIndex = {
  method: "ahash" | "md5";
  entries: Record<string, string>;
  failures: { path: string; error: string }[];
  total: number;
};

export type DedupGroup = {
  hash: string;
  distance: number;
  paths: string[];
};

export type FfmpegStatus = {
  ffmpeg: boolean;
  ffprobe: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
};

export type TrashResult = {
  ok: string[];
  failed: { path: string; error: string }[];
};

export type MoveResult = {
  from: string;
  to: string;
};

export type BatchMoveItem = MoveResult & {
  sourceGone: boolean;
  destOk: boolean;
  verified: boolean;
};

export type BatchMoveResult = {
  destDir: string;
  total: number;
  moved: BatchMoveItem[];
  failed: { path: string; error: string }[];
  verifiedOk: number;
  verifyFailed: BatchMoveItem[];
  allOk: boolean;
};

export type VideoToolsApi = {
  selectFolder: () => Promise<string | null>;
  openPath: (target: string) => Promise<string>;
  showItemInFolder: (target: string) => Promise<boolean>;
  trashItems: (paths: string[]) => Promise<TrashResult>;
  moveManyToDir: (payload: {
    sourcePaths: string[];
    destDir: string;
  }) => Promise<BatchMoveResult>;
  listVideos: (folderPath: string) => Promise<string[]>;
  listImages: (folderPath: string) => Promise<string[]>;
  indexImages: (payload: {
    paths: string[];
    method?: "ahash" | "md5";
  }) => Promise<DedupIndex>;
  toMediaUrl: (filePath: string) => string;
  ffmpegStatus: () => Promise<FfmpegStatus>;
  dedupIndex: (payload: {
    folderPath: string;
    method?: "ahash" | "md5";
  }) => Promise<DedupIndex>;
  dedupFind: (payload: {
    index: DedupIndex;
    threshold?: number;
  }) => Promise<DedupGroup[]>;
  onDedupProgress: (handler: (progress: DedupProgress) => void) => () => void;
  onImagesProgress: (handler: (progress: DedupProgress) => void) => () => void;
};
