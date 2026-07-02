/**
 * 页面管理 & 处理任务 API 服务
 */

import request from './request';
import type { ApiResponse, PageData, TextRegion } from '@/types';
import { API_UPLOAD_TIMEOUT_MS } from '@/constants';

export const pageApi = {
  // ===== 页面管理 =====

  /** 获取页面列表 */
  getList: (chapterId: string) =>
    request.get<ApiResponse<PageData[]>>(`/chapters/${chapterId}/pages`),

  /** 获取页面详情（含文字区域） */
  getDetail: (pageId: string) =>
    request.get<ApiResponse<PageData & { regions: TextRegion[] }>>(`/pages/${pageId}`),

  /** 上传压缩包/PDF（自动拆分页面） */
  uploadArchive: (chapterId: string, formData: FormData, onProgress?: (progress: number) => void, signal?: AbortSignal) =>
    request.post<ApiResponse<PageData>>(`/chapters/${chapterId}/pages/upload-archive`, formData, {
      timeout: API_UPLOAD_TIMEOUT_MS,
      signal,
      onUploadProgress: (event) => {
        if (event.total) {
          onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      },
    }),

  /** 上传页面 */
  upload: (chapterId: string, formData: FormData, onProgress?: (progress: number) => void, signal?: AbortSignal) =>
    request.post<ApiResponse<PageData>>(`/chapters/${chapterId}/pages/upload`, formData, {
      timeout: API_UPLOAD_TIMEOUT_MS,
      signal,
      onUploadProgress: (event) => {
        if (event.total) {
          onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      },
    }),

  /** 删除页面 */
  delete: (pageId: string) =>
    request.delete<ApiResponse<null>>(`/pages/${pageId}`),

  /** 页面排序 */
  sort: (pageId: string, sortOrder: number) =>
    request.put<ApiResponse<null>>(`/pages/${pageId}/sort`, { sort_order: sortOrder }),

  /** 更新页面状态 */
  updateStatus: (pageId: string, status: string) =>
    request.put<ApiResponse<null>>(`/pages/${pageId}/status`, { status }),

  // ===== AI处理任务 =====
  // P0 FIX: 所有 AI 管线方法均支持 AbortSignal，用于页面切换/重复触发时主动中断旧请求

  /** 文字区域检测（timeout设为5分钟，大图检测较慢） */
  detectRegions: (pageId: string, signal?: AbortSignal, language?: string) =>
    request.post<ApiResponse<{ regions: TextRegion[]; detected_count: number }>>(
      `/pages/${pageId}/detect`,
      { language: language || 'ja' },
      { timeout: 300000, signal }
    ),

  /** 更新文字区域 */
  updateRegions: (pageId: string, regions: TextRegion[]) =>
    request.put<ApiResponse<null>>(`/pages/${pageId}/regions`, { regions }),

  /** OCR识别（100个区域可能需要2-3分钟，timeout设为5分钟） */
  runOCR: (pageId: string, language?: string, signal?: AbortSignal) =>
    request.post<ApiResponse<{ results: Array<{ region_id: string; text: string; confidence: number; char_confidences?: number[] }> }>>(
      `/pages/${pageId}/ocr`,
      { language },
      { timeout: 300000, signal } // 5分钟超时，100区域OCR需要较长时间
    ),

  /** 翻译（支持拟声词模式和文化策略，timeout设为5分钟） */
  translate: (pageId: string, options?: {
    target_lang?: string;
    onomatopoeia_mode?: 'keep_annotation' | 'replace' | 'bilingual';
    culture_strategy?: 'localize' | 'footnote' | 'tooltip';
  }, signal?: AbortSignal) =>
    request.post<ApiResponse<{ regions: Array<{ region_id: string; translated_text: string }> }>>(
      `/pages/${pageId}/translate`,
      {
        target_lang: options?.target_lang,
        onomatopoeia_mode: options?.onomatopoeia_mode,
        culture_strategy: options?.culture_strategy,
      },
      { timeout: 300000, signal }
    ),

  /** 背景修复（timeout设为5分钟，100区域修复较慢） */
  inpaint: (pageId: string, method: 'lama' | 'sd_inpaint' | 'telea' = 'lama', signal?: AbortSignal) =>
    request.post<ApiResponse<{ processed_url?: string; result_url?: string }>>(
      `/pages/${pageId}/inpaint`,
      { method },
      { timeout: 300000, signal }
    ),

  /** 文字回填渲染（timeout设为5分钟，100区域渲染较慢） */
  render: (pageId: string, regions?: Array<{ region_id: string; translated_text: string; font_size?: number; font_family?: string; font_color?: string; alignment?: string; line_spacing?: number }>, signal?: AbortSignal) =>
    request.post<ApiResponse<{ processed_url: string; result_url?: string }>>(
      `/pages/${pageId}/render`,
      { regions, preserve_style: true, auto_resize: true },
      { timeout: 300000, signal }
    ),

  /** 批量全流程处理 */
  batchProcess: (projectId: string, options?: { target_lang?: string; pages?: string[] }) =>
    request.post<ApiResponse<{ task_id: string; status: string }>>(
      `/projects/${projectId}/batch-process`,
      options
    ),

  /** 重试失败处理 */
  retry: (pageId: string) =>
    request.post<ApiResponse<null>>(`/pages/${pageId}/retry`),

  /** 导入智能预处理（PRD 2.1.3）— 倾斜校正/黑边裁切/重复检测/曝光优化 */
  preprocess: (pageId: string, options?: {
    auto_rotate?: boolean;
    auto_crop?: boolean;
    duplicate_check?: boolean;
    exposure_fix?: boolean;
  }) =>
    request.post<ApiResponse<{
      task_id: string;
      status: string;
      page_id: string;
      results: Record<string, any>;
      processed_url?: string | null;
      message?: string;
    }>>(`/pages/${pageId}/preprocess`, options),
};
