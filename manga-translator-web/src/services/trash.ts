/**
 * 回收站 API 服务
 * 对接后端 project_service (trash 路由)
 */

import request from './request';
import type { ApiResponse, PaginatedData, ProjectData } from '@/types';

export interface TrashItem extends ProjectData {
  deleted_at: string;
  auto_delete_at: string; // 30天后自动删除时间
  days_remaining: number;
}

export const trashApi = {
  /** 获取回收站列表 */
  getList: (params?: { page?: number; page_size?: number }) =>
    request.get<ApiResponse<PaginatedData<TrashItem>>>('/trash', { params }),

  /** 恢复项目 */
  restore: (projectId: string) =>
    request.post<ApiResponse<ProjectData>>(`/trash/${projectId}/restore`),

  /** 永久删除 */
  permanentDelete: (projectId: string) =>
    request.delete<ApiResponse<null>>(`/trash/${projectId}/permanent`),
};
