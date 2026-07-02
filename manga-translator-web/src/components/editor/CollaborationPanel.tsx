'use client';

import React from 'react';
import { Card, Table, Tag, Button, Tooltip, Empty, Space, Popconfirm, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Lock, Unlock, MessageSquare, Users, Clock, UserPlus,
  Shield, Eye, Edit3, BookOpen, CheckCircle2, XCircle
} from 'lucide-react';
import { collaborationApi, type ProjectMember, type PageLock, type CommentData, type ChangeLogEntry } from '@/services/collaboration';
import { useAuthStore } from '@/stores/authStore';

interface CollaborationPageProps {
  projectId: string;
  pageId?: string;
}

export function CollaborationPanel({ projectId, pageId }: CollaborationPageProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const router = useRouter();
  const currentUserId = useAuthStore((s) => s.user?.user_id);

  const { data: lockData, isLoading: lockLoading } = useQuery({
    queryKey: ['collaboration', 'lock', pageId],
    queryFn: async () => {
      if (!pageId) return null;
      const res = await collaborationApi.getPageLock(pageId);
      // 后端 check_lock 返回 {locked, locked_by, expires_at}，非 PageLock 结构
      return (res.data?.data || null) as any;
    },
    enabled: !!pageId,
    refetchInterval: 10_000,
  });

  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: ['collaboration', 'comments', pageId],
    queryFn: async () => {
      if (!pageId) return [];
      const res = await collaborationApi.getComments(pageId);
      // 后端返回 {comments: [...]}
      const d = res.data?.data as any;
      return (d?.comments || d || []) as CommentData[];
    },
    enabled: !!pageId,
    refetchInterval: 15_000,
  });

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['collaboration', 'logs', pageId],
    queryFn: async () => {
      if (!pageId) return [];
      const res = await collaborationApi.getChangeLogs(pageId);
      // 后端 logs 走分页响应 {items: [...]}
      const d = res.data?.data as any;
      return (d?.items || d || []) as ChangeLogEntry[];
    },
    enabled: !!pageId,
    staleTime: 30_000,
  });

  const acquireLock = useMutation({
    mutationFn: () => collaborationApi.acquireLock(pageId!),
    onSuccess: () => {
      message.success('已获取编辑锁');
      queryClient.invalidateQueries({ queryKey: ['collaboration', 'lock', pageId] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const releaseLock = useMutation({
    mutationFn: () => collaborationApi.releaseLock(pageId!),
    onSuccess: () => {
      message.success('已释放编辑锁');
      queryClient.invalidateQueries({ queryKey: ['collaboration', 'lock', pageId] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  // 后端 check_lock：{locked: bool, locked_by?: user_id, expires_at?}
  const isLocked = !!lockData?.locked;
  const lockedBy = lockData?.locked_by as string | undefined;
  const isLockedByMe = isLocked && !!currentUserId && lockedBy === currentUserId;

  const commentColumns: ColumnsType<CommentData> = [
    {
      title: '用户',
      dataIndex: 'user_name',
      key: 'user_name',
      width: 100,
      render: (name: string) => (
        <span className="flex items-center gap-1 text-xs">
          <div className="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
            <span className="text-[10px] text-primary-600">{name?.charAt(0)}</span>
          </div>
          {name}
        </span>
      ),
    },
    {
      title: '内容',
      dataIndex: 'content',
      key: 'content',
      render: (text: string) => <span className="text-xs">{text}</span>,
    },
    {
      title: '状态',
      dataIndex: 'resolved',
      key: 'resolved',
      width: 80,
      render: (resolved: boolean) => (
        resolved ? <Tag color="green" className="text-xs">已解决</Tag> : <Tag color="orange" className="text-xs">待处理</Tag>
      ),
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 130,
      render: (d: string) => <span className="text-xs text-slate-400">{new Date(d).toLocaleString('zh-CN')}</span>,
    },
  ];

  const logColumns: ColumnsType<ChangeLogEntry> = [
    {
      title: '用户',
      dataIndex: 'user_name',
      key: 'user_name',
      width: 100,
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 120,
      render: (action: string) => <Tag className="text-xs">{action}</Tag>,
    },
    {
      title: '详情',
      dataIndex: 'details',
      key: 'details',
      render: (details: Record<string, unknown>) => (
        <span className="text-xs text-slate-400">{JSON.stringify(details).slice(0, 100)}</span>
      ),
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (d: string) => <span className="text-xs text-slate-400">{new Date(d).toLocaleString('zh-CN')}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {/* 页面锁状态 */}
      {pageId && (
        <Card size="small" className={
          isLocked ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10' : ''
        }>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isLocked ? (
                <>
                  <Lock size={16} className="text-amber-500" />
                  <span className="text-sm text-amber-700 dark:text-amber-400">
                    {isLockedByMe ? '你正在编辑此页面' : `${lockData?.user_name || '他人'}正在编辑此页面`}
                  </span>
                  <Clock size={12} className="text-amber-400" />
                  <span className="text-xs text-amber-500">
                    {lockData?.expires_at && `锁将于 ${new Date(lockData.expires_at).toLocaleTimeString()} 过期`}
                  </span>
                </>
              ) : (
                <>
                  <Unlock size={16} className="text-green-500" />
                  <span className="text-sm text-green-600 dark:text-green-400">页面可编辑</span>
                </>
              )}
            </div>
            {isLocked ? (
              isLockedByMe && (
                <Button size="small" onClick={() => releaseLock.mutate()} loading={releaseLock.isPending}>
                  释放编辑锁
                </Button>
              )
            ) : (
              <Button size="small" type="primary" onClick={() => acquireLock.mutate()} loading={acquireLock.isPending}>
                获取编辑锁
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* 评论列表 */}
      {pageId && (
        <Card
          size="small"
          title={<span className="flex items-center gap-2"><MessageSquare size={14} />评论 ({comments?.length || 0})</span>}
        >
          {comments && comments.length > 0 ? (
            <Table
              columns={commentColumns}
              dataSource={comments}
              rowKey="comment_id"
              pagination={false}
              size="small"
            />
          ) : (
            <Empty description="暂无评论" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>
      )}

      {/* 变更日志 */}
      {pageId && (
        <Card
          size="small"
          title={<span className="flex items-center gap-2"><BookOpen size={14} />操作记录</span>}
        >
          {logs && logs.length > 0 ? (
            <Table
              columns={logColumns}
              dataSource={logs.slice(0, 10)}
              rowKey="log_id"
              pagination={false}
              size="small"
            />
          ) : (
            <Empty description="暂无操作记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>
      )}
    </div>
  );
}
