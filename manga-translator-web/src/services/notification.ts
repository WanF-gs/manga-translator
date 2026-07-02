/**
 * 通知中心 API 服务
 * 对接后端 notification_service
 */

import request from './request';
import type { ApiResponse, PaginatedData } from '@/types';
import { API_FAST_TIMEOUT_MS } from '@/constants';

const fastOpts = { timeout: API_FAST_TIMEOUT_MS };

export type NotificationType = 'system' | 'task' | 'export' | 'share' | 'security';
export type NotificationStatus = 'unread' | 'read';

export interface NotificationItem {
  notification_id: string;
  type: NotificationType;
  title: string;
  content: string;
  status: NotificationStatus;
  related_id?: string;
  related_type?: string;
  created_at: string;
  read_at?: string;
}

export const notificationApi = {
  /** 获取通知列表 */
  getList: (params?: {
    page?: number;
    page_size?: number;
    status?: NotificationStatus;
    type?: NotificationType;
  }) =>
    request.get<ApiResponse<PaginatedData<NotificationItem>>>('/notifications', {
      params,
      ...fastOpts,
    }),

  /** 获取未读数量 */
  getUnreadCount: () =>
    request.get<ApiResponse<{ count: number }>>('/notifications/unread-count', fastOpts),

  /** 标记已读 */
  markRead: (notificationId: string) =>
    request.put<ApiResponse<null>>(`/notifications/${notificationId}/read`, undefined, fastOpts),

  /** 全部已读 */
  markAllRead: () =>
    request.put<ApiResponse<null>>('/notifications/read-all', undefined, fastOpts),

  /** 删除通知 */
  delete: (notificationId: string) =>
    request.delete<ApiResponse<null>>(`/notifications/${notificationId}`, fastOpts),
};
