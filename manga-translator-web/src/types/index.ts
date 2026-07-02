// 类型导出汇总

import type { StyleConfig } from './region';

export * from './api';
export * from './project';
export * from './page';
export * from './region';
export type { OnomatopoeiaMode, CultureStrategy } from './region';

// 用户相关
export interface UserData {
  user_id: string;
  email?: string;
  phone?: string;
  nickname: string;
  avatar_url?: string;
  plan_type: 'free' | 'premium';
  premium_expires?: string;
  created_at: string;
}

export interface UserSettings {
  default_engine: 'basic' | 'multimodal';
  default_target_lang: string;
  default_export_format: 'jpg' | 'png' | 'webp';
  default_export_quality: number;
  default_font_style: string;
  auto_preprocess: boolean;
  notifications_enabled: boolean;
}

// 导出相关
export type ExportFormat = 'jpg' | 'png' | 'webp' | 'cbz' | 'pdf';
export type ExportResolution = 'original' | '1080p' | '2k' | '4k';
export type BilingualMode = 'side-by-side' | 'top-bottom' | 'in-bubble';
export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ExportConfig {
  format: ExportFormat;
  quality: number;
  resolution: ExportResolution;
  bilingual_mode?: BilingualMode;
  naming_rule?: string;
  chapters: string[];
}

export interface ExportTask {
  task_id: string;
  project_id: string;
  format: ExportFormat;
  quality: number;
  resolution: ExportResolution;
  bilingual_mode?: BilingualMode;
  status: ExportStatus;
  progress: number;
  result_url?: string;
  error_msg?: string;
  created_at: string;
  completed_at?: string;
}

// 样式预设
export type PresetCategory = 'speech' | 'thought' | 'narration' | 'onomatopoeia' | 'effect';
export type PresetScope = 'system' | 'account' | 'project';

export interface StylePreset {
  preset_id: string;
  name: string;
  category: PresetCategory;
  style_config: StyleConfig;
  scope: PresetScope;
  created_at: string;
}
