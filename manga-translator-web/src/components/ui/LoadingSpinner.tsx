'use client';

import React from 'react';
import { Spin } from 'antd';
import clsx from 'clsx';

interface LoadingSpinnerProps {
  /** 加载提示文字 */
  tip?: string;
  /** 是否全屏 */
  fullScreen?: boolean;
  /** 尺寸 */
  size?: 'small' | 'default' | 'large';
}

/** 通用加载动画组件（封装 Ant Design Spin） */
export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  tip = '加载中...',
  fullScreen = false,
  size = 'large',
}) => {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-4',
        fullScreen
          ? 'h-screen w-screen fixed inset-0 z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl'
          : 'py-16'
      )}
    >
      <Spin size={size}>
        <div className={size === 'small' ? 'p-4' : size === 'default' ? 'p-6' : 'p-8'} />
      </Spin>
      {tip && (
        <p className="text-sm text-slate-500 dark:text-slate-400 animate-pulse-soft font-medium">
          {tip}
        </p>
      )}
    </div>
  );
};
