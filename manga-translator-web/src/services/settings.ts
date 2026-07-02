/**
 * 用户设置 API 服务
 * 对接后端 user_service settings 路由
 */

import request from './request';
import type { ApiResponse, UserSettings } from '@/types';

export type ExportFormat = 'jpg' | 'png' | 'webp' | 'cbz' | 'pdf';

export interface UserSettingsFull extends UserSettings {
  default_font_family?: string;
  default_font_size?: number;
  default_font_color?: string;
  translation_style?: 'simplified' | 'traditional';
  auto_save_progress?: boolean;
  theme?: 'light' | 'dark' | 'system';
  language?: string;
}

export const settingsApi = {
  /** 获取用户设置 */
  get: (config?: Record<string, unknown>) =>
    request.get<ApiResponse<UserSettingsFull>>('/user/settings', config),

  /** 更新用户设置（部分更新） */
  update: (data: Partial<UserSettingsFull>) =>
    request.put<ApiResponse<UserSettingsFull>>('/user/settings', data),

  /** 重置为默认值 */
  reset: () =>
    request.delete<ApiResponse<UserSettingsFull>>('/user/settings'),
};
