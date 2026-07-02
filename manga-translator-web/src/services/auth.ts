/**
 * 认证 API 服务
 * 对接后端 /api/v1/auth/* 接口
 */

import request from './request';
import type { ApiResponse } from '@/types';
import { API_AUTH_TIMEOUT_MS } from '@/constants';

export interface LoginParams {
  account: string;
  password: string;
  remember_me?: boolean;
}

export interface RegisterParams {
  email: string;
  password: string;
  nickname: string;
}

export interface AuthTokens {
  user: {
    user_id: string;
    email?: string;
    phone?: string;
    nickname: string;
    avatar_url?: string;
    plan_type: 'free' | 'premium';
  };
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

export const authApi = {
  /** 邮箱登录 */
  login: (data: LoginParams) =>
    request.post<ApiResponse<AuthTokens>>('/auth/login', data, { timeout: API_AUTH_TIMEOUT_MS }),

  /** 邮箱注册 */
  register: (data: RegisterParams) =>
    request.post<ApiResponse<AuthTokens>>('/auth/register', data, { timeout: API_AUTH_TIMEOUT_MS }),

  /** 刷新Token */
  refreshToken: (refreshToken: string) =>
    request.post<ApiResponse<{ access_token: string; refresh_token: string }>>(
      '/auth/refresh',
      { refresh_token: refreshToken },
      { timeout: API_AUTH_TIMEOUT_MS }
    ),

  /** 登出 */
  logout: () => request.post<ApiResponse<null>>('/auth/logout'),

  /** 获取当前用户信息 */
  getProfile: () => request.get<ApiResponse<AuthTokens['user']>>('/user/profile'),
};
