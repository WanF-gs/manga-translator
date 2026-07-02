'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { WifiOff, X, RefreshCw } from 'lucide-react';

/**
 * 全局网络状态指示器
 * P0 FIX: z-index 降至 z-50 不阻挡页面交互，改为可关闭提示条
 */
export const NetworkStatusBar: React.FC = () => {
  const [backendOffline, setBackendOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkBackend = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      // 200=logged in, 401=backend reachable but not logged in, both mean backend is up
      setBackendOffline(false);
    } catch {
      setBackendOffline(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkBackend();
    const interval = setInterval(checkBackend, 30000);

    const originalFetch = window.fetch;
    let failedCount = 0;
    window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        if (!response.ok && response.status >= 500) {
          failedCount++;
          if (failedCount >= 3 && !backendOffline) {
            setBackendOffline(true);
          }
        } else {
          failedCount = 0;
          if (backendOffline) {
            setBackendOffline(false);
            setDismissed(false);
          }
        }
        return response;
      } catch {
        failedCount++;
        if (failedCount >= 3) {
          setBackendOffline(true);
        }
        throw new Error('Network request failed');
      }
    };

    return () => {
      clearInterval(interval);
      window.fetch = originalFetch;
    };
  }, [checkBackend, backendOffline]);

  if (!backendOffline || dismissed) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 pointer-events-auto"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <WifiOff size={16} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200 truncate">
            后端服务未连接 — 部分功能暂时不可用
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={checkBackend}
            disabled={checking}
            className="flex items-center gap-1 px-2 py-1 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded transition-colors"
          >
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
            重试
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 rounded"
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default NetworkStatusBar;
