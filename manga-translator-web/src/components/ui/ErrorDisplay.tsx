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
        'flex flex-col items-center justify-center gap-5 px-4',
        fullScreen ? 'h-screen' : 'py-16',
        className
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
        <AlertCircle size={32} className="text-red-400" />
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">
          {message}
        </p>
        {detail && (
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1.5 max-w-md leading-relaxed">
            {detail}
          </p>
        )}
      </div>
      {onRetry && (
        <button onClick={onRetry} className="btn-primary text-sm">
          <RefreshCw size={16} />
          重试
        </button>
      )}
    </div>
  );
};
