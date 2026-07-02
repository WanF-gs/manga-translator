/**
 * 样式预设 API 服务
 */
import request from './request';
import type { ApiResponse, StylePreset } from '@/types';

export const presetApi = {
  /** 获取预设列表，可按分类筛选 */
  getList: (category?: string) =>
    request.get<ApiResponse<StylePreset[]>>('/presets', { params: { category } }),

  /** 创建新预设 */
  create: (data: Omit<StylePreset, 'preset_id' | 'created_at'>) =>
    request.post<ApiResponse<StylePreset>>('/presets', data),

  /** 删除预设 */
  delete: (presetId: string) =>
    request.delete<ApiResponse<null>>(`/presets/${presetId}`),

  /** 将预设应用到指定区域 */
  apply: (presetId: string, regionIds: string[]) =>
    request.post<ApiResponse<null>>(`/presets/${presetId}/apply`, { region_ids: regionIds }),
};
