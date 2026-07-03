/**
 * 团队协作 API 服务
 * 对接后端 project_service (端口 8002)
 */

import request from './request';
import type { ApiResponse } from '@/types';

export interface ProjectMember {
  member_id: string;
  project_id: string;
  user_id: string;
  user_name: string;
  role: 'owner' | 'editor' | 'translator' | 'viewer';
  joined_at: string;
}

export interface PageLock {
  lock_id: string;
  page_id: string;
  user_id: string;
  user_name: string;
  locked_at: string;
  expires_at: string;
}

export interface CommentData {
  comment_id: string;
  page_id: string;
  region_id?: string;
  user_id: string;
  user_name: string;
  content: string;
  mention_user_ids: string[];
  resolved: boolean;
  created_at: string;
}

export interface ChangeLogEntry {
  log_id: string;
  page_id: string;
  user_id: string;
  user_name: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface SnapshotData {
  snapshot_id: string;
  project_id: string;
  name: string;
  description?: string;
  page_count: number;
  created_by: string;
  created_at: string;
}

export const collaborationApi = {
  // ===== 页面锁 =====
  /** 获取页面锁状态 */
  getPageLock: (pageId: string) =>
    request.get<ApiResponse<PageLock | null>>(`/collaboration/locks/${pageId}`),

  /** 获取锁 */
  acquireLock: (pageId: string) =>
    request.post<ApiResponse<PageLock>>(`/collaboration/locks/${pageId}/acquire`),

  /** 释放锁 */
  releaseLock: (pageId: string) =>
    request.post<ApiResponse<null>>(`/collaboration/locks/${pageId}/release`),

  // ===== 评论 =====
  /** 获取页面评论 */
  getComments: (pageId: string) =>
    request.get<ApiResponse<CommentData[]>>(`/collaboration/comments/${pageId}`),

  /** 创建评论 */
  createComment: (data: {
    project_id: string;
    page_id: string;
    region_id?: string;
    content: string;
    mention_user_ids?: string[];
  }) =>
    request.post<ApiResponse<CommentData>>('/collaboration/comments', data),

  /** 解决评论 */
  resolveComment: (commentId: string) =>
    request.post<ApiResponse<null>>(`/collaboration/comments/${commentId}/resolve`),

  // ===== 变更日志 =====
  /** 获取变更日志 */
  getChangeLogs: (pageId: string) =>
    request.get<ApiResponse<ChangeLogEntry[]>>(`/collaboration/logs/${pageId}`),

  // ===== 成员管理 =====
  /** 获取项目成员列表 */
  getMembers: (projectId: string) =>
    request.get<ApiResponse<{ members: ProjectMember[] }>>(`/collaboration/projects/${projectId}/members`),

  /** 添加项目成员 */
  addMember: (projectId: string, data: { user_id: string; role: string }) =>
    request.post<ApiResponse<ProjectMember>>(`/collaboration/projects/${projectId}/members`, data),

  /** 更新成员角色 */
  updateMemberRole: (projectId: string, userId: string, role: string) =>
    request.put<ApiResponse<ProjectMember>>(`/collaboration/projects/${projectId}/members/${userId}`, { role }),

  /** 移除项目成员 */
  removeMember: (projectId: string, userId: string) =>
    request.delete<ApiResponse<null>>(`/collaboration/projects/${projectId}/members/${userId}`),

  // ===== 快照 =====
  /** 获取快照列表 */
  getSnapshots: (projectId: string) =>
    request.get<ApiResponse<SnapshotData[]>>(`/collaboration/snapshots/${projectId}`),

  /** 创建快照 */
  createSnapshot: (projectId: string, data: { name: string; description?: string }) =>
    request.post<ApiResponse<SnapshotData>>(`/collaboration/snapshots/${projectId}`, data),

  /** 删除快照 */
  deleteSnapshot: (snapshotId: string) =>
    request.delete<ApiResponse<null>>(`/collaboration/snapshots/${snapshotId}`),
};
