/// <reference types="vite/client" />

import type { VideoToolsApi } from "./types/api";

declare global {
  interface Window {
    videoTools: VideoToolsApi;
  }
}

export {};
