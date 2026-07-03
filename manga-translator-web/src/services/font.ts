/**
 * 字体管理 API 服务
 * 对接后端 project_service (端口 8002)
 */

import request from './request';
import type { ApiResponse } from '@/types';

export interface FontData {
  font_id: string;
  user_id: string;
  name: string;
  file_url: string;
  file_size: number;
  category: 'dialogue' | 'narration' | 'onomatopoeia' | 'title';
  style_tags: string[];
  license: 'free_commercial' | 'attribution' | 'personal_only';
  language_tags: string[];
  is_active: boolean;
  created_at: string;
}

export interface FontUploadParams {
  name: string;
  file: File;
  category: string;
  license: string;
  language_tags?: string[];
}

export interface FontListParams {
  category?: string;
  language?: string;
  license?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface SmartMatchParams {
  tone_type?: string;
  bubble_type?: string;
  style_tag?: string;
  language?: string;
  text?: string;
  project_id?: string;
}

export interface SmartMatchResult {
  font: FontData;
  score: number;
  reason?: string;
  coverage_risk?: boolean;
}

export interface SmartMatchResponse {
  recommendations: SmartMatchResult[];
  best_match: FontData | null;
}

export const fontApi = {
  /** 获取字体列表 */
  getList: (params?: FontListParams) =>
    request.get<ApiResponse<{ items: FontData[]; total: number }>>('/fonts', { params }),

  /** 上传字体（文件通过 FormData 体，元数据通过 URL Query） */
  upload: (formData: FormData, params?: Record<string, string>) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => { if (v) searchParams.set(k, v); });
    }
    const qs = searchParams.toString();
    return request.post<ApiResponse<FontData>>(`/fonts/upload${qs ? `?${qs}` : ''}`, formData, {
      headers: { 'Content-Type': undefined },
    });
  },

  /** 删除字体 */
  delete: (fontId: string) =>
    request.delete<ApiResponse<null>>(`/fonts/${fontId}`),

  /** 智能匹配字体 */
  smartMatch: (params: SmartMatchParams) =>
    request.get<ApiResponse<SmartMatchResponse>>('/fonts/smart-match', { params }),

  /** 更新字体信息 */
  update: (fontId: string, data: Partial<FontData>) =>
    request.put<ApiResponse<FontData>>(`/fonts/${fontId}`, data),

  /** 缺字检测（v3.0）：检测指定文本在指定字体下的覆盖率 */
  glyphCoverage: (body: { text: string; font_id?: string; font_family?: string }) =>
    request.post<ApiResponse<{
      coverage: number;
      missing_chars: string[];
      needs_fallback: boolean;
      total_chars?: number;
      covered_chars?: number;
    }>>('/fonts/glyph-coverage', body),
};
