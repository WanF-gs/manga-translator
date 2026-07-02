/**
 * 项目管理 API 服务
 */

import request from './request';
import type {
  ApiResponse,
  PaginatedData,
  ProjectData,
  CreateProjectParams,
  ChapterData,
  CreateChapterParams,
} from '@/types';

export const projectApi = {
  // ===== 作品 =====

  /** 获取作品列表 */
  getList: (params?: {
    page?: number;
    page_size?: number;
    sort_by?: 'updated_at' | 'name' | 'created_at';
    status?: string;
  }) =>
    request.get<ApiResponse<PaginatedData<ProjectData>>>('/projects', { params }),

  /** 获取作品详情 */
  getDetail: (projectId: string) =>
    request.get<ApiResponse<ProjectData>>(`/projects/${projectId}`),

  /** 创建作品 */
  create: (data: CreateProjectParams) =>
    request.post<ApiResponse<ProjectData>>('/projects', data),

  /** 更新作品 */
  update: (projectId: string, data: Partial<ProjectData>) =>
    request.put<ApiResponse<ProjectData>>(`/projects/${projectId}`, data),

  /** 删除作品（移入回收站） */
  delete: (projectId: string) =>
    request.delete<ApiResponse<null>>(`/projects/${projectId}`),

  /** 收藏/取消收藏 */
  toggleFavorite: (projectId: string, isFavorite: boolean) =>
    request.put<ApiResponse<ProjectData>>(`/projects/${projectId}`, { is_favorite: isFavorite }),

  // ===== 章节 =====

  /** 获取章节列表 */
  getChapters: (projectId: string) =>
    request.get<ApiResponse<ChapterData[]>>(`/projects/${projectId}/chapters`),

  /** 创建章节 */
  createChapter: (projectId: string, data: CreateChapterParams) =>
    request.post<ApiResponse<ChapterData>>(`/projects/${projectId}/chapters`, data),

  /** 更新章节 */
  updateChapter: (chapterId: string, data: Partial<ChapterData>) =>
    request.put<ApiResponse<ChapterData>>(`/chapters/${chapterId}`, data),

  /** 删除章节 */
  deleteChapter: (chapterId: string) =>
    request.delete<ApiResponse<null>>(`/chapters/${chapterId}`),

  /** 章节排序 */
  sortChapters: (chapterId: string, sortOrder: number) =>
    request.put<ApiResponse<null>>(`/chapters/${chapterId}/sort`, { sort_order: sortOrder }),
};
