'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Progress, message, Button, Tooltip } from 'antd';
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
  RefreshCw,
  Eye,
  Download,
  X,
  Zap,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { pageApi } from '@/services/page';

interface BatchPageInfo {
  page_id: string;
  label: string;
  status: string;
  thumbnail_color: string;
  sort_order?: number;
  original_url?: string;
  processed_url?: string;
  error_msg?: string;
}

type PageProcessStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface BatchProgressModalProps {
  open: boolean;
  projectId: string;
  pages: BatchPageInfo[];
  sourceLang?: string;
  onComplete: () => void;
  onClose: () => void;
}

/** 单页状态 */
function PageStatusItem({
  page,
  status,
}: {
  page: BatchPageInfo;
  status: PageProcessStatus;
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-2 px-3 py-2 rounded-lg transition-all',
        status === 'processing' && 'bg-primary-50 dark:bg-primary-900/20',
        status === 'completed' && 'bg-green-50 dark:bg-green-900/20',
        status === 'failed' && 'bg-red-50 dark:bg-red-900/20'
      )}
    >
      {/* 缩略图色块 */}
      <div
        className="w-8 h-10 rounded flex-shrink-0 flex items-center justify-center"
        style={{ backgroundColor: page.thumbnail_color + '30' }}
      >
        <span className="text-xs font-bold opacity-40" style={{ color: page.thumbnail_color }}>
          {page.sort_order || page.label.replace('第', '').replace('页', '')}
        </span>
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
          {page.label}
        </p>
        {status === 'failed' && page.error_msg && (
          <p className="text-[10px] text-red-400 truncate">{page.error_msg}</p>
        )}
      </div>

      {/* 状态图标 */}
      <div className="flex-shrink-0">
        {status === 'pending' && <Clock size={14} className="text-slate-300 dark:text-slate-600" />}
        {status === 'processing' && <Loader2 size={14} className="text-primary-500 animate-spin" />}
        {status === 'completed' && <CheckCircle2 size={14} className="text-green-500" />}
        {status === 'failed' && <AlertCircle size={14} className="text-red-500" />}
      </div>
    </div>
  );
}

/** 对比查看器 */
function ComparisonView({
  originalUrl,
  processedUrl,
  onClose,
}: {
  originalUrl?: string;
  processedUrl?: string;
  onClose: () => void;
}) {
  const [sliderPos, setSliderPos] = useState(50);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>
      <div
        className="relative max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/60 hover:text-white"
        >
          <X size={24} />
        </button>

        <div className="relative overflow-hidden rounded-lg" style={{ width: '800px', height: '600px' }}>
          {/* 处理后图片（底层） */}
          {processedUrl && (
            <img
              src={processedUrl}
              alt="处理后"
              className="absolute inset-0 w-full h-full object-contain"
            />
          )}
          {/* 原始图片（clip裁剪） */}
          {originalUrl && (
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              <img
                src={originalUrl}
                alt="原始"
                className="absolute inset-0 w-full h-full object-contain"
              />
            </div>
          )}
          {/* 对比中线 */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-white shadow-lg cursor-ew-resize"
            style={{ left: `${sliderPos}%` }}
          >
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
              <ChevronLeft size={12} className="-mr-1" />
              <ChevronRight size={12} className="-ml-1" />
            </div>
          </div>
          {/* 拖拽手柄区域 */}
          <input
            type="range"
            min={0}
            max={100}
            value={sliderPos}
            onChange={(e) => setSliderPos(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
          />
        </div>

        <div className="flex justify-center gap-4 mt-4">
          <span className="text-xs text-white/60">← 原始</span>
          <span className="text-xs text-white/60">处理后 →</span>
        </div>
      </div>
    </div>
  );
}

export const BatchProgressModal: React.FC<BatchProgressModalProps> = ({
  open,
  projectId,
  pages,
  sourceLang,
  onComplete,
  onClose,
}) => {
  const [overallProgress, setOverallProgress] = useState(0);
  const [pageStatuses, setPageStatuses] = useState<Record<string, PageProcessStatus>>({});
  const [currentStep, setCurrentStep] = useState('开始处理...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonPage, setComparisonPage] = useState<BatchPageInfo | null>(null);

  const processingRef = useRef(false);

  const [processedPages, setProcessedPages] = useState<BatchPageInfo[]>([]);

  const processAllPages = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    setError(null);
    setOverallProgress(0);

    // 初始化所有页面状态为 pending
    const initial: Record<string, PageProcessStatus> = {};
    pages.forEach((p) => (initial[p.page_id] = 'pending'));
    setPageStatuses(initial);
    
    let completed = 0;
    const total = pages.length;
    const failedPageIds: string[] = [];

    for (const page of pages) {
      setCurrentStep(`正在处理: ${page.label}`);
      setPageStatuses((prev) => ({ ...prev, [page.page_id]: 'processing' }));

      try {
        // 执行完整的 5 步处理流程
        const steps: Array<{ key: string; fn: () => Promise<any> }> = [
          { key: 'detect', fn: () => pageApi.detectRegions(page.page_id) },
          { key: 'ocr', fn: () => pageApi.runOCR(page.page_id, sourceLang) },
          { key: 'translate', fn: () => pageApi.translate(page.page_id, { target_lang: 'zh-CN' }) },
          { key: 'inpaint', fn: () => pageApi.inpaint(page.page_id) },
          {
            key: 'render',
            fn: async () => {
              const detailRes = await pageApi.getDetail(page.page_id);
              const detail = detailRes.data?.data as any;
              const regions = (detail?.regions || [])
                .filter((r: any) => r.translated_text)
                .map((r: any) => ({
                  region_id: r.region_id,
                  translated_text: r.translated_text,
                  font_size: r.style_config?.font_size,
                  font_family: r.style_config?.font_family,
                  font_color: r.style_config?.color,
                  alignment: r.style_config?.text_align,
                  line_spacing: r.style_config?.line_height,
                }));
              return pageApi.render(page.page_id, regions.length > 0 ? regions : undefined);
            },
          },
        ];

        for (const step of steps) {
          setCurrentStep(`${page.label} - ${step.key === 'detect' ? '检测' : step.key === 'ocr' ? '识别' : step.key === 'translate' ? '翻译' : step.key === 'inpaint' ? '修复' : '渲染'}`);
          try {
            await step.fn();
          } catch (stepErr: any) {
            if (stepErr?.response?.status === 404) {
              continue; // 接口跳不可用，跳过该步骤
            }
            throw stepErr;
          }
        }

        // 获取处理后的页面数据
        try {
          const pageRes = await pageApi.getDetail(page.page_id);
          const pageData = pageRes.data?.data as any;
          setProcessedPages((prev) => [
            ...prev,
            {
              ...page,
              original_url: pageData?.original_url,
              processed_url: pageData?.processed_url,
            },
          ]);
        } catch {
          // 忽略获取详情失败
        }

        setPageStatuses((prev) => ({ ...prev, [page.page_id]: 'completed' }));
      } catch (err: any) {
        const statusCode = err?.response?.status || 0;
        if (statusCode === 404) {
          setPageStatuses((prev) => ({ ...prev, [page.page_id]: 'completed' }));
          message.warning(`${page.label} 部分处理步骤不可用`);
        } else {
          // 自动重试1次
          setCurrentStep(`${page.label} - 失败，正在自动重试...`);
          try {
            await pageApi.retry(page.page_id);
            // 重试成功
            try {
              const pageRes = await pageApi.getDetail(page.page_id);
              const pageData = pageRes.data?.data as any;
              setProcessedPages((prev) => [
                ...prev,
                {
                  ...page,
                  original_url: pageData?.original_url,
                  processed_url: pageData?.processed_url,
                },
              ]);
            } catch { /* ignore */ }
            setPageStatuses((prev) => ({ ...prev, [page.page_id]: 'completed' }));
          } catch {
            // 重试仍失败，标记为失败并跳过
            failedPageIds.push(page.page_id);
            setPageStatuses((prev) => ({ ...prev, [page.page_id]: 'failed' }));
            setProcessedPages((prev) => [
              ...prev,
              { ...page, error_msg: `重试后仍失败: ${err?.message || '处理失败'}` },
            ]);
          }
        }
      }

      completed++;
      setOverallProgress(Math.round((completed / total) * 100));
    }

    setCurrentStep('全部页面处理完成');
    setIsProcessing(false);
    setIsComplete(true);
    processingRef.current = false;

    // 汇总失败页面
    if (failedPageIds.length > 0) {
      const failedLabels = pages
        .filter((p) => failedPageIds.includes(p.page_id))
        .map((p) => p.label)
        .join('、');
      message.warning({
        content: `处理完成：${pages.length - failedPageIds.length}/${pages.length} 页成功。失败页面：${failedLabels}`,
        duration: 5,
      });
    }

    // 通知父组件
    onComplete();
  }, [pages, onComplete]);

  const handleRetryFailed = useCallback(async () => {
    const failedPages = Object.entries(pageStatuses)
      .filter(([, status]) => status === 'failed')
      .map(([id]) => pages.find((p) => p.page_id === id))
      .filter(Boolean) as BatchPageInfo[];

    if (failedPages.length === 0) {
      message.info('没有需要重试的页面');
      return;
    }

    for (const page of failedPages) {
      setCurrentStep(`重试: ${page.label}`);
      setPageStatuses((prev) => ({ ...prev, [page.page_id]: 'processing' }));
      try {
        await pageApi.retry(page.page_id);
        setPageStatuses((prev) => ({ ...prev, [page.page_id]: 'completed' }));
        message.success(`${page.label} 重试成功`);
      } catch (err: any) {
        setPageStatuses((prev) => ({ ...prev, [page.page_id]: 'failed' }));
      }
    }

    const allDone = Object.values(pageStatuses).every((s) => s === 'completed');
    if (allDone) setIsComplete(true);
  }, [pageStatuses, pages]);

  const failedCount = Object.values(pageStatuses).filter((s) => s === 'failed').length;
  const completedCount = Object.values(pageStatuses).filter((s) => s === 'completed').length;

  return (
    <>
      <Modal
        title={
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-primary-500" />
            <span className="text-base font-semibold">
              {isComplete ? '批量处理完成' : isProcessing ? '批量处理中' : '批量处理'}
            </span>
          </div>
        }
        open={open}
        onCancel={onClose}
        width={560}
        footer={
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">
              {isComplete
                ? `完成 ${completedCount}/${pages.length} 页`
                : isProcessing
                ? `处理中 ${completedCount}/${pages.length} 页`
                : '准备处理'}
            </span>
            <div className="flex gap-2">
              {failedCount > 0 && (
                <Button
                  icon={<RefreshCw size={14} />}
                  onClick={handleRetryFailed}
                  disabled={isProcessing}
                >
                  重试失败 ({failedCount})
                </Button>
              )}
              {isComplete && processedPages.length > 0 && (
                <Button
                  type="primary"
                  icon={<Eye size={14} />}
                  onClick={() => setComparisonPage(processedPages[0])}
                >
                  查看结果
                </Button>
              )}
              {!isProcessing && !isComplete && (
                <Button
                  type="primary"
                  icon={<Zap size={14} />}
                  onClick={processAllPages}
                >
                  开始处理
                </Button>
              )}
              <Button onClick={onClose}>
                {isComplete ? '完成' : '取消'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 py-2">
          {/* 总体进度 */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-slate-500">
              <span>总体进度</span>
              <span>{overallProgress}%</span>
            </div>
            <Progress
              percent={overallProgress}
              status={isComplete ? 'success' : isProcessing ? 'active' : 'normal'}
              strokeColor={isComplete ? '#10B981' : '#6366F1'}
              size="small"
            />
          </div>

          {/* 当前步骤 */}
          <p className="text-xs text-slate-400">
            {isProcessing ? (
              <span className="flex items-center gap-1">
                <Loader2 size={12} className="animate-spin text-primary-500" />
                {currentStep}
              </span>
            ) : error ? (
              <span className="flex items-center gap-1 text-red-500">
                <AlertCircle size={12} />
                {error}
              </span>
            ) : (
              currentStep
            )}
          </p>

          {/* 页面状态列表 */}
          <div className="max-h-80 overflow-y-auto space-y-1 border border-slate-200 dark:border-slate-700 rounded-lg p-1">
            {pages.map((page) => (
              <PageStatusItem
                key={page.page_id}
                page={page}
                status={pageStatuses[page.page_id] || 'pending'}
              />
            ))}
          </div>

          {/* 预览对比（完成后） */}
          {isComplete && processedPages.length > 0 && (
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                处理结果预览
              </p>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {processedPages.map((page) => (
                  <button
                    key={page.page_id}
                    onClick={() => setComparisonPage(page)}
                    className="flex-shrink-0 w-16 h-20 rounded-lg flex flex-col items-center justify-center gap-1 transition-all hover:scale-105 border border-slate-200 dark:border-slate-700 hover:border-primary-400"
                    style={{ backgroundColor: page.thumbnail_color + '20' }}
                  >
                    <span className="text-lg font-bold opacity-40" style={{ color: page.thumbnail_color }}>
                      {page.sort_order || '?'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {page.error_msg ? '失败' : '完成'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* 全屏对比查看器 */}
      {comparisonPage && (
        <ComparisonView
          originalUrl={comparisonPage.original_url}
          processedUrl={comparisonPage.processed_url}
          onClose={() => setComparisonPage(null)}
        />
      )}
    </>
  );
};
