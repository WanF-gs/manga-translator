'use client';

import React from 'react';
import { Inbox } from 'lucide-react';
import clsx from 'clsx';

interface EmptyStateProps {
  /** 图标（默认 Inbox） */
  icon?: React.ReactNode;
  /** 主标题 */
  title?: string;
  /** 副标题 */
  description?: string;
  /** 操作按钮文字 */
  actionLabel?: string;
  /** 操作按钮点击回调 */
  onAction?: () => void;
  /** 自定义类名 */
  className?: string;
}

/** 通用空状态组件 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title = '暂无数据',
  description,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center py-20 px-4 animate-fade-in',
        className
      )}
    >
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center shadow-inner-glow">
          {icon || <Inbox size={36} className="text-slate-300 dark:text-slate-500" />}
        </div>
        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center shadow-sm">
          <div className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500" />
        </div>
      </div>
      <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">
        {title}
      </p>
      {description && (
        <p className="text-sm mt-2 text-slate-400 dark:text-slate-500 max-w-xs text-center leading-relaxed">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="btn-primary mt-7 text-sm px-5"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
