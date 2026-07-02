/**
 * API 密钥管理 API 服务
 * 对接后端 user_service (端口 8001)
 */

import request from './request';
import type { ApiResponse } from '@/types';

export interface ApiKeyData {
  key_id: string;
  user_id: string;
  name: string;
  key_prefix: string; // msk_xxxx...
  key_hash: string;   // never returned except on creation
  raw_key?: string;   // only returned once on creation
  is_active: boolean;
  rate_limit_per_minute: number;
  total_calls: number;
  last_used_at?: string;
  created_at: string;
}

export interface CreateApiKeyParams {
  name: string;
  rate_limit_per_minute?: number;
}

export interface ApiKeyUsageStats {
  key_id: string;
  total_calls: number;
  calls_today: number;
  calls_this_hour: number;
  last_used_at?: string;
}

export const apiKeyApi = {
  /** 获取 API Key 列表 */
  getList: () =>
    request.get<ApiResponse<ApiKeyData[]>>('/api-keys'),

  /** 创建 API Key */
  create: (data: CreateApiKeyParams) =>
    request.post<ApiResponse<ApiKeyData>>('/api-keys', data),

  /** 删除/禁用 API Key */
  delete: (keyId: string) =>
    request.delete<ApiResponse<null>>(`/api-keys/${keyId}`),

  /** 获取使用统计 */
  getStats: (keyId: string) =>
    request.get<ApiResponse<ApiKeyUsageStats>>(`/api-keys/${keyId}/stats`),
};
