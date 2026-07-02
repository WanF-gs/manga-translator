/**
 * 术语库 API 服务
 */
import request from './request';
import type { ApiResponse } from '@/types';

export interface TermEntry {
  term_id: string;
  source_text: string;
  target_text: string;
  note?: string;
  category?: string;
  scope: 'account' | 'project';
  project_id?: string;
  created_at: string;
  updated_at: string;
}

export interface TermListParams {
  scope?: string;
  category?: string;
  keyword?: string;
  project_id?: string;
  page?: number;
  page_size?: number;
}

export interface TermListResponse {
  items: TermEntry[];
  total: number;
  page: number;
  page_size: number;
}

export const termApi = {
  /** 获取术语列表 */
  getList: (params?: TermListParams) =>
    request.get<ApiResponse<TermListResponse>>('/terms', { params }),

  /** 创建术语 */
  create: (data: {
    source_text: string;
    target_text: string;
    note?: string;
    category?: string;
    scope?: 'account' | 'project';
    project_id?: string;
  }) =>
    request.post<ApiResponse<TermEntry>>('/terms', data),

  /** 更新术语 */
  update: (termId: string, data: Partial<TermEntry>) =>
    request.put<ApiResponse<TermEntry>>(`/terms/${termId}`, data),

  /** 删除术语 */
  delete: (termId: string) =>
    request.delete<ApiResponse<null>>(`/terms/${termId}`),

  /** CSV 导入 */
  import: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request.post<ApiResponse<{ imported: number }>>('/terms/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /** CSV 导出 */
  export: (params?: { scope?: string; project_id?: string }) =>
    request.get('/terms/export', {
      params,
      responseType: 'blob',
    }),
};
