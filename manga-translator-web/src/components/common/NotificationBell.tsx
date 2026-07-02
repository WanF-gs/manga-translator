'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, CheckCheck, X, Loader2, Clock, Download, Share2, Shield, Info } from 'lucide-react';
import clsx from 'clsx';
import { notificationApi } from '@/services/notification';
import { API_BASE_URL } from '@/constants';
import { useAuthStore } from '@/stores/authStore';
import type { NotificationItem, NotificationType } from '@/services/notification';

const NOTIFICATION_ICONS: Record<NotificationType, React.ElementType> = {
  system: Info,
  task: Clock,
  export: Download,
  share: Share2,
  security: Shield,
};

const NOTIFICATION_COLORS: Record<NotificationType, string> = {
  system: 'text-blue-500 bg-blue-50 dark:bg-blue-900/30',
  task: 'text-amber-500 bg-amber-50 dark:bg-amber-900/30',
  export: 'text-green-500 bg-green-50 dark:bg-green-900/30',
  share: 'text-purple-500 bg-purple-50 dark:bg-purple-900/30',
  security: 'text-red-500 bg-red-50 dark:bg-red-900/30',
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
}

/** 顶部导航栏通知铃铛 */
export const NotificationBell: React.FC = () => {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  // 加载未读数量和列表
  const loadUnread = useCallback(async () => {
    try {
      const [countRes, listRes] = await Promise.all([
        notificationApi.getUnreadCount(),
        notificationApi.getList({ page: 1, page_size: 10, status: 'unread' }),
      ]);
      setUnreadCount(countRes.data?.data?.count || 0);

      const data = listRes.data?.data;
      const items = (data as any)?.items || (Array.isArray(data) ? data : []);
      setList(items);
    } catch {
      // 后端不可用忽略
    }
  }, []);

  // 数据加载 + 轮询（延迟启动，避免与路由切换争抢带宽）
  useEffect(() => {
    if (!accessToken) {
      setUnreadCount(0);
      setList([]);
      return;
    }
    const timer = window.setTimeout(() => {
      loadUnread();
    }, 2000);
    const poll = window.setInterval(loadUnread, 30000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [loadUnread, accessToken]);

  // WebSocket 仅在用户打开通知面板时连接，避免登录后阻塞主线程
  useEffect(() => {
    if (!accessToken || !open) return;

    let ws: WebSocket | null = null;
    let cancelled = false;

    const connect = () => {
      try {
        // 从 API_BASE_URL 推导 WebSocket URL，附带 JWT token 认证
        const apiUrl = new URL(API_BASE_URL || '/api/v1', window.location.origin);
        const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${apiUrl.host}/api/v1/ws/notifications?token=${encodeURIComponent(accessToken)}`;
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          console.log('[WS] 通知推送已连接');
        };

        ws.onmessage = (event) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'new_notification' || data.type === 'notification') {
              setUnreadCount((prev) => prev + 1);
              loadUnread();
            }
          } catch { /* ignore */ }
        };

        ws.onclose = () => {
          if (cancelled) return;
          console.log('[WS] 通知推送已断开');
        };

        ws.onerror = () => {
          // 连接失败时静默处理，使用轮询兜底
        };
      } catch {
        // WebSocket不可用时仅使用轮询
      }
    };

    connect();

    return () => {
      cancelled = true;
      // 仅在 WebSocket 已连接或正在连接时关闭，避免 "closed before established" 错误
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED && wsRef.current.readyState !== WebSocket.CLOSING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    };
  }, [accessToken, open, loadUnread]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await notificationApi.markRead(id);
      setList((prev) => prev.filter((n) => n.notification_id !== id));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await notificationApi.markAllRead();
      setList([]);
      setUnreadCount(0);
    } catch { /* ignore */ }
  }, []);

  const handleOpen = () => {
    setOpen(!open);
    if (!open) {
      setLoading(true);
      notificationApi.getList({ page: 1, page_size: 10 })
        .then((res) => {
          const data = res.data?.data;
          const items = (data as any)?.items || (Array.isArray(data) ? data : []);
          setList(items);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden">
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              通知 ({list.length})
            </h3>
            {list.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-primary-500 hover:text-primary-600 flex items-center gap-1"
              >
                <CheckCheck size={12} />
                全部已读
              </button>
            )}
          </div>

          {/* 列表 */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <Bell size={28} className="mb-2 opacity-30" />
                <p className="text-xs">暂无通知</p>
              </div>
            ) : (
              list.map((item) => {
                const Icon = NOTIFICATION_ICONS[item.type] || Info;
                const colorClass = NOTIFICATION_COLORS[item.type] || '';
                return (
                  <div
                    key={item.notification_id}
                    className={clsx(
                      'flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative',
                      item.status === 'unread' && 'bg-primary-50/50 dark:bg-primary-900/10'
                    )}
                  >
                    <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', colorClass)}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                        {item.content}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {formatTime(item.created_at)}
                      </p>
                    </div>
                    {item.status === 'unread' && (
                      <button
                        onClick={() => handleMarkRead(item.notification_id)}
                        className="absolute top-2 right-2 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-300 hover:text-slate-500 transition-colors"
                        title="标记已读"
                      >
                        <X size={12} />
                      </button>
                    )}
                    {/* 未读标记 */}
                    {item.status === 'unread' && (
                      <div className="absolute top-3 left-2 w-2 h-2 rounded-full bg-primary-500" />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 底部 */}
          <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-center">
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/** 通知列表页面组件 */
export const NotificationList: React.FC = () => {
  const [list, setList] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page: 1, page_size: 50 };
      if (filter === 'unread') params.status = 'unread';
      const res = await notificationApi.getList(params);
      const data = res.data?.data;
      const items = (data as any)?.items || (Array.isArray(data) ? data : []);
      setList(items);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadList(); }, [loadList]);

  const handleMarkRead = useCallback(async (id: string) => {
    await notificationApi.markRead(id).catch(() => {});
    loadList();
  }, [loadList]);

  const handleMarkAllRead = useCallback(async () => {
    await notificationApi.markAllRead().catch(() => {});
    loadList();
  }, [loadList]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div>
      {/* 过滤器 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                'px-3 py-1 text-xs rounded-full transition-colors',
                filter === f
                  ? 'bg-primary-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              )}
            >
              {f === 'all' ? '全部' : '未读'}
            </button>
          ))}
        </div>
        {list.some((n) => n.status === 'unread') && (
          <button
            onClick={handleMarkAllRead}
            className="text-xs text-primary-500 flex items-center gap-1"
          >
            <CheckCheck size={12} /> 全部已读
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">暂无通知</div>
      ) : (
        <div className="space-y-2">
          {list.map((item) => {
            const Icon = NOTIFICATION_ICONS[item.type] || Info;
            const colorClass = NOTIFICATION_COLORS[item.type] || '';
            return (
              <div
                key={item.notification_id}
                className={clsx(
                  'flex items-start gap-3 p-3 rounded-xl transition-colors',
                  item.status === 'unread'
                    ? 'bg-primary-50/50 dark:bg-primary-900/10'
                    : 'bg-white dark:bg-slate-900'
                )}
                onClick={() => item.status === 'unread' && handleMarkRead(item.notification_id)}
              >
                <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', colorClass)}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {item.title}
                    </p>
                    {item.status === 'unread' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{item.content}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{formatTime(item.created_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
