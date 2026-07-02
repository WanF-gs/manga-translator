'use client';

import React from 'react';
import { Progress } from 'antd';
import { CheckCircle2, Loader2, AlertCircle, Circle } from 'lucide-react';
import clsx from 'clsx';

export interface ProgressStep {
  /** 步骤标识 */
  key: string;
  /** 步骤显示名称 */
  label: string;
  /** 步骤状态 */
  status: 'pending' | 'active' | 'done' | 'error';
}

interface ProgressBarProps {
  /** 百分比 (0-100) */
  percent: number;
  /** 步骤配置（步骤模式） */
  steps?: ProgressStep[];
  /** 整体状态 */
  status?: 'active' | 'success' | 'error';
  /** 是否显示百分比文字 */
  showInfo?: boolean;
  /** 进度条宽度 className */
  className?: string;
}

/** 通用进度条组件：支持百分比模式 + 步骤模式 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  percent,
  steps,
  status = 'active',
  showInfo = true,
  className,
}) => {
  // 步骤模式
  if (steps && steps.length > 0) {
    const statusIcons: Record<string, React.ElementType> = {
      pending: Circle,
      active: Loader2,
      done: CheckCircle2,
      error: AlertCircle,
    };
    const statusColors: Record<string, string> = {
      pending: 'text-slate-300 dark:text-slate-600',
      active: 'text-primary-500',
      done: 'text-green-500',
      error: 'text-red-500',
    };

    return (
      <div className={clsx('w-full', className)}>
        {/* 步骤横条 */}
        <div className="flex items-center justify-between mb-2">
          {steps.map((step, idx) => {
            const Icon = statusIcons[step.status];
            const isLast = idx === steps.length - 1;
            return (
              <React.Fragment key={step.key}>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div
                    className={clsx(
                      'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300',
                      step.status === 'done' && 'bg-green-100 dark:bg-green-900/30',
                      step.status === 'active' && 'bg-primary-100 dark:bg-primary-900/30 ring-2 ring-primary-300 dark:ring-primary-700',
                      step.status === 'error' && 'bg-red-100 dark:bg-red-900/30 ring-2 ring-red-300',
                      step.status === 'pending' && 'bg-slate-100 dark:bg-slate-800',
                    )}
                  >
                    <Icon
                      size={14}
                      className={clsx(
                        statusColors[step.status],
                        step.status === 'active' && 'animate-spin'
                      )}
                    />
                  </div>
                  <span className={clsx(
                    'text-[10px] font-medium whitespace-nowrap',
                    statusColors[step.status]
                  )}>
                    {step.label}
                  </span>
                </div>
                {!isLast && (
                  <div className="flex-1 mx-1 h-0.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all duration-500',
                        step.status === 'done' ? 'bg-green-400 w-full' : 'w-0'
                      )}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
        {/* 百分比进度条 */}
        <Progress
          percent={percent}
          status={status === 'error' ? 'exception' : status === 'success' ? 'success' : 'active'}
          strokeColor={status === 'error' ? '#EF4444' : '#3B82F6'}
          showInfo={showInfo}
          size="small"
        />
      </div>
    );
  }

  // 纯百分比模式
  return (
    <div className={clsx('w-full', className)}>
      <Progress
        percent={percent}
        status={status === 'error' ? 'exception' : status === 'success' ? 'success' : 'active'}
        strokeColor={status === 'error' ? '#EF4444' : '#3B82F6'}
        showInfo={showInfo}
        size="small"
      />
    </div>
  );
};
