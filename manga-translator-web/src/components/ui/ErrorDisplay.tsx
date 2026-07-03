'use client';

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

interface ErrorDisplayProps {
  /** 错误信息 */
  message?: string;
  /** 错误详情 */
  detail?: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 自定义类名 */
  className?: string;
  /** 是否全屏居中 */
  fullScreen?: boolean;
}

/** 通用错误展示组件 */
export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  message = '加载失败',
  detail,
  onRetry,
  className,
  fullScreen = false,
}) => {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-5 px-4 animate-fade-in',
        fullScreen ? 'h-screen' : 'py-20',
        className
      )}
    >
      <div className="relative">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-900/20 flex items-center justify-center shadow-inner-glow ring-1 ring-red-200/50 dark:ring-red-800/30">
          <AlertCircle size={36} className="text-red-400 dark:text-red-400" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shadow-sm">
          <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse-soft" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">
          {message}
        </p>
        {detail && (
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-2 max-w-md leading-relaxed">
            {detail}
          </p>
        )}
      </div>
      {onRetry && (
        <button onClick={onRetry} className="btn-primary text-sm px-5 mt-1">
          <RefreshCw size={16} />
          重试
        </button>
      )}
    </div>
  );
};
