/**
 * 付费方案 API 服务
 * 对接后端 user_service (端口 8001)
 */

import request from './request';
import type { ApiResponse } from '@/types';

export interface PlanInfo {
  plan_id: string;
  name: string;
  type: 'free' | 'premium';
  price: number;
  currency: string;
  features: string[];
  quotas: {
    projects: number;
    pages_per_project: number;
    exports_per_day: number;
    api_calls_per_day: number;
    storage_gb: number;
    tts_minutes: number;
  };
}

export interface UserQuota {
  plan_type: string;
  quotas_used: {
    projects: number;
    exports_today: number;
    api_calls_today: number;
    storage_used_gb: number;
    tts_used_minutes: number;
  };
  quotas_limit: {
    projects: number;
    exports_per_day: number;
    api_calls_per_day: number;
    storage_gb: number;
    tts_minutes: number;
  };
}

export interface UpgradeOrder {
  order_id: string;
  out_trade_no: string;
  amount: number;
  months: number;
  pay_url: string;
  mode: 'alipay' | 'sandbox';
  message: string;
}

export interface OrderStatus {
  order_id: string;
  out_trade_no: string;
  status: 'created' | 'paid' | 'cancelled' | 'failed';
  amount: number;
  months: number;
  paid_at: string | null;
}

export const paymentApi = {
  /** 获取方案列表 */
  getPlans: () =>
    request.get<ApiResponse<PlanInfo[]>>('/payments/plans'),

  /** 获取用户配额 */
  getQuota: () =>
    request.get<ApiResponse<UserQuota>>('/payments/quota'),

  /** 检查某项配额 */
  checkQuota: (quotaType: string) =>
    request.post<ApiResponse<{ allowed: boolean; remaining: number }>>('/payments/check-quota', {
      quota_type: quotaType,
    }),

  /** 创建升级订单（返回支付跳转链接，权益需支付后由网关回调授予） */
  upgrade: (months: number = 1) =>
    request.post<ApiResponse<UpgradeOrder>>('/payments/upgrade', { months }),

  /** 查询订单状态（轮询支付结果） */
  getOrder: (orderId: string) =>
    request.get<ApiResponse<OrderStatus>>(`/payments/orders/${orderId}`),

  /** 降级到免费版 */
  downgrade: () =>
    request.post<ApiResponse<{ plan_type: string; message: string }>>('/payments/downgrade'),
};
