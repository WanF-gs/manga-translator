// 文字区域相关类型定义

export type RegionType = 'speech' | 'thought' | 'narration' | 'onomatopoeia' | 'effect';

/** 拟声词处理模式 */
export type OnomatopoeiaMode = 'keep_annotation' | 'replace' | 'bilingual';

/** 文化梗处理策略 */
export type CultureStrategy = 'localize' | 'footnote' | 'tooltip';

export interface RegionBoundary {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 多边形/贝塞尔顶点（原始图像像素坐标），配合 boundary_mode 使用 */
  points?: [number, number][];
  rotation?: number;
}

/** 选区包围模式: rect-矩形(降级) | polygon-多边形(优选) | bezier-贝塞尔曲线 [PRD §2.2.8] */
export type BoundaryMode = 'rect' | 'polygon' | 'bezier';

export interface StyleConfig {
  font_family: string;
  font_size: number;
  color: string;
  stroke_width?: number;
  stroke_color?: string;
  opacity?: number;
  text_align?: 'left' | 'center' | 'right';
  vertical?: boolean;
  letter_spacing?: number;
  line_height?: number;
}

export interface TextRegion {
  region_id: string;
  page_id: string;
  type: RegionType;
  boundary: RegionBoundary;
  /** 选区包围模式，默认 rect [PRD §2.2.8] */
  boundary_mode?: BoundaryMode;
  original_text?: string;
  translated_text?: string;
  confidence?: number;
  /** P0: 字符级置信度数组，与 original_text 字符位置对应 (0.0-1.0) */
  char_confidences?: number[];
  is_locked: boolean;
  style_config?: StyleConfig;
  /** 拟声词处理模式 */
  onomatopoeia_mode?: OnomatopoeiaMode;
  /** 文化梗处理策略 */
  culture_strategy?: CultureStrategy;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// 区域类型颜色映射
export const REGION_TYPE_COLORS: Record<RegionType, string> = {
  speech: '#3B82F6',
  thought: '#8B5CF6',
  narration: '#F59E0B',
  onomatopoeia: '#EF4444',
  effect: '#10B981',
};

export const REGION_TYPE_LABELS: Record<RegionType, string> = {
  speech: '对话气泡',
  thought: '内心独白',
  narration: '旁白',
  onomatopoeia: '拟声词',
  effect: '效果字',
};

/** 拟声词处理模式标签 */
export const ONOMATOPOEIA_MODE_LABELS: Record<OnomatopoeiaMode, string> = {
  keep_annotation: '保留+译注',
  replace: '替换',
  bilingual: '双语叠加',
};

/** 文化梗策略标签 */
export const CULTURE_STRATEGY_LABELS: Record<CultureStrategy, string> = {
  localize: '本地化替换',
  footnote: '页脚注释',
  tooltip: '悬浮注释',
};
