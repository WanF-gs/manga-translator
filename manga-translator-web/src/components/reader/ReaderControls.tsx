'use client';

import React from 'react';
import { BookOpen, Columns2, Volume2 } from 'lucide-react';
import clsx from 'clsx';

/** 阅读布局模式 */
export type ReaderLayoutMode = 'single' | 'double' | 'bilingual';
/** 内容显示模式 */
export type DisplayMode = 'translated' | 'original' | 'bilingual';

interface ReaderControlsProps {
  /** 阅读布局模式 */
  layoutMode: ReaderLayoutMode;
  /** 布局模式切换 */
  onLayoutModeChange: (mode: ReaderLayoutMode) => void;
  /** 内容显示模式 */
  displayMode: DisplayMode;
  /** 显示模式切换 */
  onDisplayModeChange: (mode: DisplayMode) => void;
  /** 主题色，默认 dark（深色阅读器） */
  variant?: 'dark' | 'light';
  /** 是否紧凑布局（移动端） */
  compact?: boolean;
  /** 自定义 className */
  className?: string;
  /** R6: 朗读功能回调 */
  onAudioToggle?: () => void;
  isAudioPlaying?: boolean;
  showAudioButton?: boolean;
}

/** 阅读器控制栏：布局模式 + 显示模式切换 */
export const ReaderControls: React.FC<ReaderControlsProps> = ({
  layoutMode,
  onLayoutModeChange,
  displayMode,
  onDisplayModeChange,
  variant = 'dark',
  compact = false,
  className,
  onAudioToggle,
  isAudioPlaying = false,
  showAudioButton = false,
}) => {
  const isDark = variant === 'dark';

  const btnBase = clsx(
    'transition-colors',
    compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-xs',
    isDark
      ? 'text-white/60 hover:text-white'
      : 'text-slate-500 hover:text-slate-700'
  );

  const btnActive = clsx(
    'rounded-md',
    isDark
      ? 'bg-white/20 text-white'
      : 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
  );

  return (
    <div className={clsx('flex items-center gap-3', className)}>
      {/* 布局模式 */}
      <div
        className={clsx(
          'flex items-center gap-1 rounded-lg p-0.5',
          isDark ? 'bg-white/10 backdrop-blur-sm' : 'bg-slate-100 dark:bg-slate-800'
        )}
      >
        <button
          onClick={() => onLayoutModeChange('single')}
          className={clsx(btnBase, layoutMode === 'single' && btnActive)}
        >
          <BookOpen size={compact ? 12 : 14} className={compact ? '' : 'inline mr-1'} />
          {!compact && '单页'}
        </button>
        <button
          onClick={() => onLayoutModeChange('double')}
          className={clsx(btnBase, layoutMode === 'double' && btnActive)}
        >
          <Columns2 size={compact ? 12 : 14} className={compact ? '' : 'inline mr-1'} />
          {!compact && '双页'}
        </button>
        <button
          onClick={() => onLayoutModeChange('bilingual')}
          className={clsx(btnBase, layoutMode === 'bilingual' && btnActive)}
        >
          <Columns2 size={compact ? 12 : 14} className={compact ? '' : 'inline mr-1'} />
          {!compact && '对照'}
        </button>
      </div>

      {/* 显示模式 */}
      <div
        className={clsx(
          'flex items-center gap-1 rounded-lg p-0.5',
          isDark ? 'bg-white/10 backdrop-blur-sm' : 'bg-slate-100 dark:bg-slate-800'
        )}
      >
        <button
          onClick={() => onDisplayModeChange('translated')}
          className={clsx(btnBase, 'rounded-md', displayMode === 'translated' && btnActive)}
        >
          {compact ? '译' : '译文'}
        </button>
        <button
          onClick={() => onDisplayModeChange('original')}
          className={clsx(btnBase, 'rounded-md', displayMode === 'original' && btnActive)}
        >
          {compact ? '原' : '原文'}
        </button>
        <button
          onClick={() => onDisplayModeChange('bilingual')}
          className={clsx(btnBase, 'rounded-md', displayMode === 'bilingual' && btnActive)}
        >
          {compact ? '双' : '双语'}
        </button>
      </div>

      {/* R6: 朗读按钮 */}
      {showAudioButton && onAudioToggle && (
        <button
          onClick={onAudioToggle}
          className={clsx(
            btnBase,
            'rounded-lg flex items-center gap-1',
            isAudioPlaying && (isDark ? 'text-primary-400 bg-white/10' : 'text-primary-600 bg-primary-50')
          )}
          title={isAudioPlaying ? '停止朗读' : '朗读当前页'}
        >
          <Volume2 size={compact ? 12 : 14} className={isAudioPlaying ? 'animate-pulse' : ''} />
          {!compact && (isAudioPlaying ? '停止' : '朗读')}
        </button>
      )}
    </div>
  );
};
