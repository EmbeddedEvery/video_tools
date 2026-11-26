import type { ComponentType } from "react";
import { ImageBrowseTool } from "./image-browse/ImageBrowseTool";
import { VideoBrowseTool } from "./video-browse/VideoBrowseTool";
import { VideoDedupTool } from "./video-dedup/VideoDedupTool";

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  /** 侧栏短标签 */
  shortLabel: string;
  Component: ComponentType;
};

/**
 * 后续新工具：在此注册即可出现在侧栏。
 * 例：{ id: "compress", name: "...", Component: CompressTool }
 */
export const tools: ToolDefinition[] = [
  {
    id: "video-dedup",
    name: "视频查重",
    shortLabel: "查重",
    description: "提取中间帧生成 hash，扫描文件夹找出重复或相似视频",
    Component: VideoDedupTool,
  },
  {
    id: "video-browse",
    name: "视频浏览",
    shortLabel: "视频",
    description: "递归扫描目录中的视频，边看边删，支持上一条 / 下一条与批量上传",
    Component: VideoBrowseTool,
  },
  {
    id: "image-browse",
    name: "图片浏览",
    shortLabel: "图片",
    description: "递归扫描目录中的图片，边看边删，支持上一条 / 下一条与批量上传",
    Component: ImageBrowseTool,
  },
];

export function getTool(id: string): ToolDefinition | undefined {
  return tools.find((t) => t.id === id);
}
