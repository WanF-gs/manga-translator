'use client';

import React from 'react';
import { Slider, Tooltip as AntTooltip } from 'antd';
import {
  ScanEye,
  Type,
  Languages,
  Paintbrush,
  FileImage,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import clsx from 'clsx';
import { PAGE_STATUS_CONFIGS } from './types';

interface StatusBarProps {
  /** 当前页码（1-based） */
  currentPageNumber: number;
  /** 总页数 */
  totalPages: number;
  /** 页面状态 */
  pageStatus: 'pending' | 'translating' | 'reviewed' | 'completed';
  /** 文字区域数量 */
  regionCount: number;
  /** 处理进度（已处理页数/总页数） */
  progress: number;
  /** 缩放百分比 */
  scale: number;
  /** 缩放变更回调 */
  onScaleChange: (scale: number) => void;
  /** 图片尺寸 */
  imageWidth?: number;
  imageHeight?: number;
  /** 当前活跃处理步骤 */
  activeStep?: string | null;
  /** 是否正在处理 */
  isProcessing?: boolean;
  /** 失败步骤的key（null表示无失败） */
  failedStep?: string | null;
  /** 失败错误信息 */
  errorMessage?: string | null;
  /** 重试某步骤的回调 */
  onRetryStep?: (stepKey: string) => void;
  /** 步骤是否可点击交互（专业编辑模式） */
  interactive?: boolean;
  /** 点击某个步骤，从该步开始执行到结束 */
  onClickStep?: (stepKey: string) => void;
}

/** 处理步骤定义 */
const PROCESS_STEPS: { key: string; label: string; icon: React.ElementType }[] = [
  { key: 'detect', label: '文字检测', icon: ScanEye },
  { key: 'ocr', label: 'OCR识别', icon: Type },
  { key: 'translate', label: '智能翻译', icon: Languages },
  { key: 'inpaint', label: '背景修复', icon: Paintbrush },
  { key: 'render', label: '排版回填', icon: FileImage },
];

/** 底部状态栏 */
export const StatusBar: React.FC<StatusBarProps> = ({
  currentPageNumber,
  totalPages,
  pageStatus,
  regionCount,
  progress,
  scale,
  onScaleChange,
  imageWidth,
  imageHeight,
  activeStep,
  isProcessing,
  failedStep,
  errorMessage,
  onRetryStep,
  interactive = false,
  onClickStep,
}) => {
  const statusConfig = PAGE_STATUS_CONFIGS[pageStatus];

  return (
    <div className="h-9 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border-t border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 text-xs text-slate-500 flex-shrink-0">
      {/* 左侧：页面信息 + 状态 + 处理流程 */}
      <div className="flex items-center gap-4 min-w-0">
        <span className="text-slate-400 flex-shrink-0">
          页面 {currentPageNumber}/{totalPages}
        </span>

        {/* 状态 */}
        <span className={clsx('flex items-center gap-1 flex-shrink-0', statusConfig?.color)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', statusConfig?.color.replace('text', 'bg'))} />
          {statusConfig?.label || '待处理'}
        </span>

        {/* 处理步骤流程指示器 */}
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {PROCESS_STEPS.map((step, idx) => {
            const isActive = activeStep === step.key;
            const isFailed = failedStep === step.key;
            const stepIdx = PROCESS_STEPS.findIndex(s => s.key === activeStep);
            const isDone = activeStep && idx < stepIdx;
            // 专业模式下可点击（非处理中、非失败），失败时由 onRetryStep 处理
            const canClick = interactive && !isProcessing && !isFailed;
            // 已完成步骤不可点击（没必要重跑）
            const canInteract = canClick && !isDone;

            const stepEl = (
              <span
                className={clsx(
                  'transition-colors flex-shrink-0',
                  isFailed && 'text-red-500',
                  isActive && !isFailed && 'text-primary-500',
                  isDone && 'text-green-500',
                  !isActive && !isDone && !isFailed && canInteract && 'text-slate-400 hover:text-primary-500',
                  !isActive && !isDone && !isFailed && !canInteract && 'text-slate-300 dark:text-slate-600'
                )}
                title={isFailed ? `${step.label} (失败)` : step.label}
              >
                {isFailed ? (
                  <AlertCircle size={12} />
                ) : isProcessing && isActive ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : isDone ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <step.icon size={12} />
                )}
              </span>
            );

            return (
              <React.Fragment key={step.key}>
                {isFailed && onRetryStep ? (
                  <AntTooltip title={`重试: ${step.label}`}>
                    <button
                      onClick={() => onRetryStep(step.key)}
                      className="transition-colors hover:scale-110"
                    >
                      {stepEl}
                      <RotateCcw size={10} className="inline ml-0.5 text-red-500" />
                    </button>
                  </AntTooltip>
                ) : canInteract && onClickStep ? (
                  <AntTooltip title={`从此步骤开始执行: ${step.label}`}>
                    <button
                      onClick={() => onClickStep(step.key)}
                      className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      {stepEl}
                    </button>
                  </AntTooltip>
                ) : (
                  stepEl
                )}
                {idx < PROCESS_STEPS.length - 1 && (
                  <span className={clsx(
                    'mx-0.5 flex-shrink-0',
                    isFailed ? 'text-red-400' : 'text-slate-300 dark:text-slate-600'
                  )}>→</span>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <span className="flex-shrink-0">检测到 {regionCount} 个文字区域</span>

        {/* 错误信息 */}
        {errorMessage && (
          <span className="text-red-500 truncate max-w-[180px]" title={errorMessage}>
            <AlertCircle size={10} className="inline mr-0.5" />
            {errorMessage}
          </span>
        )}
      </div>

      {/* 右侧：缩放 + 尺寸信息 */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* 处理进度条 */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400">进度</span>
          <div className="w-20 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
          <span className="text-slate-400 w-8 text-right">
            {Math.round(progress * totalPages)}/{totalPages}
          </span>
        </div>

        {/* 缩放 */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{scale}%</span>
          <Slider
            min={10}
            max={400}
            step={5}
            value={scale}
            onChange={onScaleChange}
            className="w-24"
            tooltip={{ formatter: (v) => `${v}%` }}
          />
        </div>

        {/* 尺寸信息 */}
        {imageWidth && imageHeight && (
          <span className="text-slate-400">
            {imageWidth}×{imageHeight}px
          </span>
        )}
      </div>
    </div>
  );
};
