'use client';

import React, { useState, useCallback } from 'react';
import { Tooltip, Modal, message, Switch } from 'antd';
import { Languages, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

interface StyleToggleProps {
  currentStyle: 'simplified' | 'traditional';
  onToggle: (style: 'simplified' | 'traditional') => void;
  disabled?: boolean;
}

/** 简体/繁体翻译风格切换 */
export const StyleToggle: React.FC<StyleToggleProps> = ({
  currentStyle,
  onToggle,
  disabled = false,
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleToggle = useCallback(() => {
    const target = currentStyle === 'simplified' ? 'traditional' : 'simplified';
    Modal.confirm({
      title: '切换翻译风格',
      icon: <AlertTriangle size={18} className="text-amber-500" />,
      content: (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            将翻译风格从
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {currentStyle === 'simplified' ? ' 简体中文 ' : ' 繁体中文 '}
            </span>
            切换为
            <span className="font-medium text-primary-600 dark:text-primary-400">
              {target === 'simplified' ? ' 简体中文 ' : ' 繁体中文 '}
            </span>
          </p>
          <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠️ 切换后需要对已翻译的文字区域重新翻译。当前已翻译的 {target === 'simplified' ? '繁体' : '简体'} 内容将被保留，新翻译会使用 {target === 'simplified' ? '简体' : '繁体'} 输出。
            </p>
          </div>
        </div>
      ),
      okText: '确认切换并重新翻译',
      cancelText: '取消',
      onOk: () => {
        onToggle(target);
        message.success(`已切换至${target === 'simplified' ? '简体中文' : '繁体中文'}风格`);
      },
    });
  }, [currentStyle, onToggle]);

  return (
    <div className="flex items-center gap-2">
      <Languages size={14} className="text-slate-400" />
      <span className="text-xs text-slate-500">翻译风格:</span>
      <div className={clsx(
        'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        currentStyle === 'simplified'
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400'
      )}>
        <span>{currentStyle === 'simplified' ? '简体' : '繁體'}</span>
      </div>
      <Tooltip title="切换简体/繁体翻译风格">
        <button
          onClick={handleToggle}
          disabled={disabled}
          className="text-[10px] text-primary-500 hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          切换
        </button>
      </Tooltip>
    </div>
  );
};
