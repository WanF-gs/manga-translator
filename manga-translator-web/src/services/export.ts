/**
 * 导出服务 API
 * 对接后端 export_service（端口 8005）
 */

import request from './request';
import type { ApiResponse } from '@/types';
import { API_UPLOAD_TIMEOUT_MS } from '@/constants';

/** 导出范围 */
export type ExportScope = 'single' | 'chapter' | 'project';

/** 导出格式 */
export type ExportFormat = 'png' | 'jpg' | 'webp' | 'cbz' | 'pdf';

/** 导出任务状态 */
export interface ExportTaskStatus {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  output_url?: string;
  output_filename?: string;
  error?: string;
  expires_at?: string;
  estimated_time?: number;
  created_at: string;
}

/** 单页导出响应 */
export interface ExportResult {
  task_id: string;
  status: string;
  download_url: string;
  filename: string;
  expires_at: string;
}

/** 批量导出响应 */
export interface BatchExportResult {
  task_id: string;
  status: string;
  page_count: number;
  estimated_time: number;
}

export type BilingualMode = 'side-by-side' | 'top-bottom' | 'in-bubble';

export const exportApi = {
  /** 单页导出（PRD: POST /api/v1/export/single） */
  single: (pageId: string, format: ExportFormat = 'png', quality?: number, bilingual = false) =>
    request.post<ApiResponse<ExportResult>>('/export/single', {
      page_id: pageId,
      format,
      quality: quality ?? 90,
      bilingual,
    }),

  /** 章节导出（PRD: POST /api/v1/export/batch 批量导出） */
  chapter: (chapterId: string, format: ExportFormat = 'cbz', quality?: number, bilingual?: boolean, bilingualMode?: BilingualMode) => {
    const isArchive = ['cbz', 'pdf'].includes(format);
    return request.post<ApiResponse<BatchExportResult>>('/export/batch', {
      chapter_id: chapterId,
      format: isArchive ? 'png' : format,
      archive_format: isArchive ? format : undefined,
      quality: quality ?? 90,
      bilingual: bilingual ?? false,
      bilingual_mode: bilingualMode ?? 'side-by-side',
    }, { timeout: API_UPLOAD_TIMEOUT_MS });
  },

  /** 项目导出（全部章节，统一路径 /export/project） */
  project: (projectId: string, format: ExportFormat = 'cbz', quality?: number, bilingual?: boolean, bilingualMode?: BilingualMode) => {
    const isArchive = ['cbz', 'pdf'].includes(format);
    return request.post<ApiResponse<BatchExportResult>>('/export/project', {
      project_id: projectId,
      format: isArchive ? 'png' : format,
      archive_format: isArchive ? format : undefined,
      quality: quality ?? 90,
      bilingual: bilingual ?? false,
      bilingual_mode: bilingualMode ?? 'side-by-side',
    }, { timeout: API_UPLOAD_TIMEOUT_MS });
  },

  /** 查询导出任务进度 */
  getStatus: (taskId: string) =>
    request.get<ApiResponse<ExportTaskStatus>>(`/export/${taskId}/status`),

  /** 获取导出下载链接（PRD: GET /api/v1/export/download/:tid） */
  getDownload: (taskId: string) =>
    request.get<ApiResponse<{ download_url: string; filename: string }>>(
      `/export/download/${taskId}`
    ),

  /** 下载导出文件（触发浏览器下载） */
  downloadFile: (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },
};
