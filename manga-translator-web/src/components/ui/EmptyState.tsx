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
        'flex flex-col items-center justify-center py-16 px-4',
        className
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-5">
        {icon || <Inbox size={32} className="text-slate-300 dark:text-slate-600" />}
      </div>
      <p className="text-lg font-semibold text-slate-600 dark:text-slate-400">
        {title}
      </p>
      {description && (
        <p className="text-sm mt-1.5 text-slate-400 dark:text-slate-500 max-w-xs text-center">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="btn-primary mt-6 text-sm"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
