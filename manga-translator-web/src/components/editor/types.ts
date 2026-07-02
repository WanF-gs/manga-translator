/**
 * 编辑器内部类型定义
 */

import type { TextRegion, RegionType, StyleConfig, RegionBoundary } from '@/types';

// Re-export types that consumers import from this module
export type { StyleConfig };

/** 页面提要（侧边栏列表用） */
export interface PageThumbnail {
  page_id: string;
  chapter_id?: string;
  label: string;
  thumbnail_url?: string;
  thumbnail_color: string;
  status: 'pending' | 'translating' | 'reviewed' | 'completed';
  sort_order: number;
}

/** 章节提要 */
export interface ChapterSummary {
  chapter_id: string;
  name: string;
  sort_order: number;
  pages: PageThumbnail[];
}

/** 编辑器使用的选区数据（扩展 TextRegion） */
export interface EditorRegion extends TextRegion {
  /** 原图原始像素坐标（绝对像素值，非百分比）——多边形时为其包围盒 */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 多边形/贝塞尔顶点（原始图像像素坐标）。
   * 当 boundary_mode 为 polygon/bezier 时存在，用于节点级编辑。
   */
  points?: [number, number][];
}

/** 处理步骤 */
export interface ProcessStep {
  key: string;
  label: string;
  icon: string;
}

/** 处理步骤定义 */
export const PROCESS_STEPS: ProcessStep[] = [
  { key: 'detect', label: '文字检测', icon: 'ScanEye' },
  { key: 'ocr', label: 'OCR识别', icon: 'Type' },
  { key: 'translate', label: '智能翻译', icon: 'Languages' },
  { key: 'inpaint', label: '背景修复', icon: 'Paintbrush' },
  { key: 'render', label: '排版回填', icon: 'Image' },
];

/** 区域类型展示配置 */
export interface RegionTypeConfig {
  border: string;
  bg: string;
  label: string;
  color: string;
}

export const REGION_TYPE_CONFIGS: Record<RegionType, RegionTypeConfig> = {
  speech: { border: 'border-blue-400', bg: 'bg-blue-400/30', label: '对话', color: '#3B82F6' },
  thought: { border: 'border-purple-400', bg: 'bg-purple-400/30', label: '独白', color: '#8B5CF6' },
  narration: { border: 'border-amber-400', bg: 'bg-amber-400/30', label: '旁白', color: '#F59E0B' },
  onomatopoeia: { border: 'border-red-400', bg: 'bg-red-400/30', label: '拟声', color: '#EF4444' },
  effect: { border: 'border-emerald-400', bg: 'bg-emerald-400/30', label: '效果', color: '#10B981' },
};

/** 页面状态展示配置 */
export interface PageStatusConfig {
  color: string;
  bg: string;
  label: string;
}

export const PAGE_STATUS_CONFIGS: Record<string, PageStatusConfig> = {
  pending: { color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', label: '待处理' },
  translating: { color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/30', label: '翻译中' },
  reviewed: { color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/30', label: '已校对' },
  completed: { color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/30', label: '已完成' },
};

/** 字体选项 */
export const FONT_OPTIONS = [
  { value: '内置漫画对话体', label: '漫画对话体 (默认)' },
  { value: '内置漫画旁白体', label: '漫画旁白体' },
  { value: '内置拟声词样式', label: '拟声词样式' },
  { value: 'Noto Sans SC', label: 'Noto Sans SC' },
  { value: 'LXGW WenKai', label: '霞鹜文楷' },
];

/** 字号范围 */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 72;

/** 默认样式配置 */
export const DEFAULT_STYLE: StyleConfig = {
  font_family: '内置漫画对话体',
  font_size: 16,
  color: '#000000',
  stroke_width: 0,
  stroke_color: '#FFFFFF',
  text_align: 'center',
  vertical: false,
};
