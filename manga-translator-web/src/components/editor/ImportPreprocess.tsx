'use client';

import React, { useState, useCallback } from 'react';
import { Button, Progress, Switch, message } from 'antd';
import {
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  X,
  SkipForward,
  Sparkles,
  Image,
  Maximize2,
} from 'lucide-react';
import clsx from 'clsx';

interface PreprocessResult {
  pageId: string;
  pageNumber: number;
  hasTilt: boolean;
  tiltAngle?: number;
  isDuplicate?: boolean;
  hasBlackBorder: boolean;
  blackBorderRatio?: number;
  quality: 'good' | 'acceptable' | 'poor';
  previewUrl?: string;
}

interface ImportPreprocessProps {
  results: PreprocessResult[];
  onConfirm: (selectedIds: string[]) => void;
  onSkip: () => void;
  onClose: () => void;
}

function QualityBadge({ quality }: { quality: PreprocessResult['quality'] }) {
  const configs = {
    good: { color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/20', icon: CheckCircle2, label: '良好' },
    acceptable: { color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: AlertTriangle, label: '可优化' },
    poor: { color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20', icon: X, label: '有瑕疵' },
  };
  const c = configs[quality];
  const Icon = c.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', c.bg, c.color)}>
      <Icon size={10} /> {c.label}
    </span>
  );
}

/** 导入智能预处理结果展示 */
export const ImportPreprocess: React.FC<ImportPreprocessProps> = ({
  results,
  onConfirm,
  onSkip,
  onClose,
}) => {
  const [selectedPages, setSelectedPages] = useState<Set<string>>(
    new Set(results.map((r) => r.pageId))
  );
  const [autoFix, setAutoFix] = useState(true);

  const togglePage = useCallback((pageId: string) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }, []);

  const goodCount = results.filter((r) => r.quality === 'good').length;
  const issueCount = results.length - goodCount;

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
              <Sparkles size={16} className="text-primary-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              导入预处理结果
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={14} className="text-slate-400" />
          </button>
        </div>

        {/* 摘要 */}
        <div className="flex items-center gap-4 text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            共 {results.length} 页
          </span>
          <span className="text-green-500">
            <CheckCircle2 size={12} className="inline mr-1" />
            {goodCount} 页良好
          </span>
          {issueCount > 0 && (
            <span className="text-amber-500">
              <AlertTriangle size={12} className="inline mr-1" />
              {issueCount} 页可优化
            </span>
          )}
        </div>
      </div>

      {/* 页面列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {results.map((page) => {
            const isSelected = selectedPages.has(page.pageId);
            return (
              <div
                key={page.pageId}
                onClick={() => togglePage(page.pageId)}
                className={clsx(
                  'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                  isSelected
                    ? 'border-primary-300 bg-primary-50/30 dark:bg-primary-900/10'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 opacity-60'
                )}
              >
                {/* 缩略图 */}
                <div className="w-12 h-16 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {page.previewUrl ? (
                    <img src={page.previewUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Image size={18} className="text-slate-300" />
                  )}
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      第 {page.pageNumber} 页
                    </span>
                    <QualityBadge quality={page.quality} />
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {page.hasTilt && (
                      <div className="flex items-center gap-1 text-[10px] text-amber-500">
                        <RotateCw size={10} />
                        倾斜 {page.tiltAngle?.toFixed(1)}°（可自动校正）
                      </div>
                    )}
                    {page.isDuplicate && (
                      <div className="flex items-center gap-1 text-[10px] text-amber-500">
                        <AlertTriangle size={10} />
                        疑似重复页面
                      </div>
                    )}
                    {page.hasBlackBorder && (
                      <div className="flex items-center gap-1 text-[10px] text-amber-500">
                        <Maximize2 size={10} />
                        有黑边（{(page.blackBorderRatio || 0).toFixed(0)}%）
                      </div>
                    )}
                  </div>
                </div>

                {/* 选中标记 */}
                <div className={clsx(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                  isSelected ? 'bg-primary-500 border-primary-500' : 'border-slate-300'
                )}>
                  {isSelected && <CheckCircle2 size={12} className="text-white" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部操作 */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600 dark:text-slate-400">自动修正倾斜和黑边</span>
          <Switch checked={autoFix} onChange={setAutoFix} />
        </div>
        <div className="flex gap-2">
          <Button block onClick={onSkip} icon={<SkipForward size={14} />}>
            跳过
          </Button>
          <Button
            block
            type="primary"
            onClick={() => onConfirm(Array.from(selectedPages))}
            disabled={selectedPages.size === 0}
          >
            导入 {selectedPages.size} 页{autoFix ? '（自动修正）' : ''}
          </Button>
        </div>
      </div>
    </div>
  );
};
