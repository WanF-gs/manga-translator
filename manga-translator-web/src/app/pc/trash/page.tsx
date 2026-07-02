'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Modal, message, Spin, Empty, Popconfirm, Tooltip } from 'antd';
import {
  Trash2,
  RotateCcw,
  Trash,
  Clock,
  AlertTriangle,
  RefreshCw,
  Image,
  ArchiveRestore,
  ShieldAlert,
} from 'lucide-react';
import clsx from 'clsx';
import { trashApi } from '@/services/trash';
import type { TrashItem } from '@/services/trash';
import { useAuthStore } from '@/stores/authStore';

function formatDays(days: number): string {
  if (days <= 0) return '即将删除';
  if (days === 1) return '明天删除';
  return `${days} 天后自动删除`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const LANG_LABELS: Record<string, string> = {
  ja: '🇯🇵 日文', zh: '🇨🇳 中文', en: '🇺🇸 英文', ko: '🇰🇷 韩文',
};

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await trashApi.getList({ page: 1, page_size: 50 });
      const data = res.data?.data;
      const list = (data as any)?.items || (Array.isArray(data) ? data : []);
      setItems(list);
    } catch (err: any) {
      const code = err?.response?.status || 0;
      if (code !== 404 && code !== 0) {
        message.error('加载回收站失败');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  // FIX: P0 - 与 useProjects 对齐，同时检查 token
  useEffect(() => { if (isAuthenticated || accessToken) loadItems(); }, [loadItems, isAuthenticated, accessToken]);

  const handleRestore = useCallback(async (projectId: string) => {
    setRestoring((prev) => new Set(prev).add(projectId));
    try {
      await trashApi.restore(projectId);
      setItems((prev) => prev.filter((i) => i.project_id !== projectId));
      message.success('已恢复');
    } catch (err: any) {
      message.error(err?.message || '恢复失败');
    } finally {
      setRestoring((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }, []);

  const handlePermanentDelete = useCallback(async (projectId: string) => {
    setDeleting((prev) => new Set(prev).add(projectId));
    try {
      await trashApi.permanentDelete(projectId);
      setItems((prev) => prev.filter((i) => i.project_id !== projectId));
      message.success('已永久删除');
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      {/* 头部 */}
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">回收站</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                已删除的项目将在30天后自动清除 · 共 {items.length} 项
              </p>
            </div>
          </div>
          <Button
            icon={<RefreshCw size={14} />}
            onClick={loadItems}
            loading={loading}
            size="small"
          >
            刷新
          </Button>
        </div>
      </div>

      {/* 内容 */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spin size="large" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Trash2 size={40} className="text-slate-300 dark:text-slate-500" />
              </div>
              <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-2">
                回收站为空
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                删除的作品会暂时存放在这里，在30天内你可以随时恢复。超期后系统会自动永久清理。
              </p>
              <div className="flex items-center justify-center gap-6 text-xs text-slate-400">
                <div className="flex items-center gap-1.5">
                  <ArchiveRestore size={14} />
                  <span>支持恢复</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldAlert size={14} />
                  <span>30天保留期</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const daysLeft = item.days_remaining || Math.max(0, Math.ceil(
                (new Date(item.auto_delete_at || '').getTime() - Date.now()) / 86400000
              ));
              const isUrgent = daysLeft <= 3;
              const isRestoring = restoring.has(item.project_id);
              const isDeleting = deleting.has(item.project_id);

              return (
                <div
                  key={item.project_id}
                  className={clsx(
                    'glass-card-hover p-4 flex items-center gap-4',
                    isUrgent && 'border-red-200 dark:border-red-800'
                  )}
                >
                  {/* 封面 */}
                  <div className="w-16 h-20 rounded-lg bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-700 dark:to-slate-600 flex-shrink-0 flex items-center justify-center">
                    <Image size={24} className="text-white/60" />
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {item.name}
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>{LANG_LABELS[item.source_lang] || item.source_lang}</span>
                      <span>·</span>
                      <span>{item.page_count || 0} 页</span>
                      <span>·</span>
                      <span>删除于 {formatDate(item.deleted_at)}</span>
                    </div>
                    {/* 倒计时 */}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Clock size={12} className={isUrgent ? 'text-red-400' : 'text-amber-400'} />
                      <span
                        className={clsx(
                          'text-xs',
                          isUrgent ? 'text-red-400 font-medium' : 'text-amber-500'
                        )}
                      >
                        {formatDays(daysLeft)}
                      </span>
                      {isUrgent && (
                        <AlertTriangle size={12} className="text-red-400" />
                      )}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      icon={<RotateCcw size={14} />}
                      onClick={() => handleRestore(item.project_id)}
                      loading={isRestoring}
                      size="small"
                      type="primary"
                      ghost
                    >
                      恢复
                    </Button>
                    <Popconfirm
                      title="确定要永久删除吗？"
                      description="此操作不可撤销"
                      onConfirm={() => handlePermanentDelete(item.project_id)}
                      okText="永久删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        icon={<Trash size={14} />}
                        loading={isDeleting}
                        size="small"
                        danger
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="h-8" />
      </div>
    </div>
  );
}
