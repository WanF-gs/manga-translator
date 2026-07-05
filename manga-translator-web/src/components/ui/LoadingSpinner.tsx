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
        'flex flex-col items-center justify-center gap-6',
        fullScreen
          ? 'h-screen w-screen fixed inset-0 z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-2xl'
          : 'py-24'
      )}
    >
      {/* 更精致的加载动画 */}
      <div className="relative">
        {/* 外圈装饰 */}
        <div className="w-16 h-16 rounded-full border-2 border-slate-100 dark:border-slate-800 absolute inset-0" />
        <div className="w-16 h-16 rounded-full border-2 border-transparent border-t-primary-500 border-r-primary-400 animate-spin" />
        {/* 内圈渐变 */}
        <div className="absolute inset-1 rounded-full bg-gradient-to-br from-primary-50 to-blue-50 dark:from-primary-950/30 dark:to-blue-950/20 flex items-center justify-center">
          <Spin size={size === 'large' ? 'default' : 'small'}>
            <div className={size === 'small' ? 'p-2' : size === 'default' ? 'p-3' : 'p-4'} />
          </Spin>
        </div>
      </div>
      {tip && (
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium tracking-wide animate-pulse-soft">
          {tip}
        </p>
      )}
    </div>
  );
};
