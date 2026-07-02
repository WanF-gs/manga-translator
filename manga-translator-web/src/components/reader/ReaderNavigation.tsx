'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

interface ReaderNavigationProps {
  /** 当前页码（0-based） */
  currentPage: number;
  /** 总页数 */
  totalPages: number;
  /** 上一页 */
  onPrev: () => void;
  /** 下一页 */
  onNext: () => void;
  /** 跳转到指定页 */
  onGoTo?: (page: number) => void;
  /** 是否显示页码输入跳转 */
  showGoto?: boolean;
  /** 显示变体 */
  variant?: 'dark' | 'light';
  /** 自定义 className */
  className?: string;
}

/** 阅读器翻页导航：上一页/下一页 + 进度条 + 页码跳转 */
export const ReaderNavigation: React.FC<ReaderNavigationProps> = ({
  currentPage,
  totalPages,
  onPrev,
  onNext,
  onGoTo,
  showGoto = true,
  variant = 'dark',
  className,
}) => {
  const isDark = variant === 'dark';
  const isFirst = currentPage === 0;
  const isLast = currentPage >= totalPages - 1;

  const progressWidth = totalPages > 0 ? ((currentPage + 1) / totalPages) * 100 : 0;

  return (
    <div className={clsx('flex flex-col items-center gap-2', className)}>
      {/* 翻页按钮行 */}
      <div className="flex items-center gap-6">
        <button
          onClick={onPrev}
          disabled={isFirst}
          className={clsx(
            'p-2 rounded-lg transition-colors',
            isDark
              ? 'text-white/80 hover:bg-white/10 disabled:opacity-30'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 disabled:opacity-30'
          )}
          title="上一页 (←)"
        >
          <ChevronLeft size={24} />
        </button>

        {/* 进度条 + 页码 */}
        <div className="flex items-center gap-3">
          <span className={clsx('text-xs w-8 text-right', isDark ? 'text-white/60' : 'text-slate-500')}>
            {currentPage + 1}
          </span>
          <div
            className={clsx(
              'h-1 w-40 md:w-64 rounded-full overflow-hidden cursor-pointer',
              isDark ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'
            )}
            onClick={(e) => {
              if (!onGoTo) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              const target = Math.round(ratio * (totalPages - 1));
              onGoTo(target);
            }}
          >
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-300',
                isDark ? 'bg-primary-500' : 'bg-primary-500'
              )}
              style={{ width: `${progressWidth}%` }}
            />
          </div>
          <span className={clsx('text-xs w-8', isDark ? 'text-white/60' : 'text-slate-500')}>
            {totalPages}
          </span>
        </div>

        <button
          onClick={onNext}
          disabled={isLast}
          className={clsx(
            'p-2 rounded-lg transition-colors',
            isDark
              ? 'text-white/80 hover:bg-white/10 disabled:opacity-30'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 disabled:opacity-30'
          )}
          title="下一页 (→)"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* 页码跳转输入 */}
      {showGoto && (
        <div className="flex items-center gap-2">
          <span className={clsx('text-xs', isDark ? 'text-white/40' : 'text-slate-400')}>
            跳转到
          </span>
          <input
            type="number"
            min={1}
            max={totalPages}
            defaultValue={currentPage + 1}
            key={currentPage}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onGoTo) {
                const val = parseInt((e.target as HTMLInputElement).value);
                if (val >= 1 && val <= totalPages) {
                  onGoTo(val - 1);
                }
              }
            }}
            className={clsx(
              'w-14 px-2 py-0.5 text-xs rounded border text-center',
              isDark
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
            )}
          />
          <span className={clsx('text-xs', isDark ? 'text-white/40' : 'text-slate-400')}>
            页
          </span>
        </div>
      )}
    </div>
  );
};
