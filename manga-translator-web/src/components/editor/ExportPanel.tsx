'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button, Slider, Select, Radio, Progress, App, Modal } from 'antd';
import {
  Download,
  FileImage,
  FileArchive,
  FileText,
  X,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RefreshCw,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { exportApi } from '@/services/export';
import { pageApi } from '@/services/page';
import type { ExportFormat } from '@/services/export';
import type { BilingualMode, ExportResolution } from '@/types';

interface ExportPanelProps {
  currentPageId: string | null;
  chapterId?: string;
  projectId: string;
  allPageCount: number;
  onClose: () => void;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string; icon: React.ElementType; desc: string }[] = [
  { value: 'png', label: 'PNG', icon: FileImage, desc: '无损压缩，适合印刷' },
  { value: 'jpg', label: 'JPG', icon: FileImage, desc: '有损压缩，文件更小' },
  { value: 'webp', label: 'WebP', icon: FileImage, desc: '新一代格式，体积小质量高' },
  { value: 'cbz', label: 'CBZ', icon: FileArchive, desc: '漫画压缩包格式' },
  { value: 'pdf', label: 'PDF', icon: FileText, desc: '便携文档格式' },
];

const RESOLUTION_OPTIONS: { value: ExportResolution; label: string }[] = [
  { value: 'original', label: '原始尺寸' },
  { value: '1080p', label: '1080p' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];

const BILINGUAL_OPTIONS: { value: BilingualMode; label: string }[] = [
  { value: 'side-by-side', label: '左右对照' },
  { value: 'top-bottom', label: '上下对照' },
  { value: 'in-bubble', label: '气泡内嵌' },
];

type ExportScope = 'current' | 'chapter' | 'project';
type ExportPhase = 'config' | 'processing' | 'done' | 'error';

export const ExportPanel: React.FC<ExportPanelProps> = ({
  currentPageId,
  chapterId,
  projectId,
  allPageCount,
  onClose,
}) => {
  const [scope, setScope] = useState<ExportScope>('current');
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(90);
  const [resolution, setResolution] = useState<ExportResolution>('original');
  const [bilingualMode, setBilingualMode] = useState<BilingualMode>('side-by-side');
  const [includeBilingual, setIncludeBilingual] = useState(false);

  const [phase, setPhase] = useState<ExportPhase>('config');
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { message } = App.useApp();
  const MESSAGE_KEY = 'export-panel';

  // FIX: 防止快速双击创建多个导出任务
  const isSubmittingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const startPolling = useCallback((tid: string) => {
    let attempts = 0;
    const maxAttempts = 120;

    pollTimerRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await exportApi.getStatus(tid);
        const status = res.data?.data;
        if (!status) return;

        setProgress(status.progress || 0);

        if (status.status === 'completed') {
          clearInterval(pollTimerRef.current!);
          pollTimerRef.current = null;
          setPhase('done');
          const url = status.output_url || status.download_url;
          if (url) {
            setDownloadUrl(url);
            const fname = status.output_filename || status.filename || `export_${tid}`;
            setFilename(fname);
            exportApi.downloadFile(url, fname);
            message.success({ content: '导出完成！', key: MESSAGE_KEY });
          } else {
            try {
              const dlRes = await exportApi.getDownload(tid);
              const dlData = dlRes.data?.data;
              if (dlData?.download_url) {
                setDownloadUrl(dlData.download_url);
                setFilename(dlData.filename || `export_${tid}`);
                exportApi.downloadFile(dlData.download_url, dlData.filename || `export_${tid}`);
                message.success({ content: '导出完成！', key: MESSAGE_KEY });
              }
            } catch {
              message.success({ content: '导出任务已完成', key: MESSAGE_KEY });
            }
          }
        } else if (status.status === 'failed') {
          clearInterval(pollTimerRef.current!);
          pollTimerRef.current = null;
          setPhase('error');
          setErrorMsg(status.error || status.error_msg || '导出失败');
          message.error({ content: '导出失败', key: MESSAGE_KEY });
        } else if (attempts >= maxAttempts) {
          clearInterval(pollTimerRef.current!);
          pollTimerRef.current = null;
          setPhase('error');
          setErrorMsg('导出超时，请稍后重试');
          message.warning({ content: '导出超时，请稍后重试', key: MESSAGE_KEY });
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(pollTimerRef.current!);
          pollTimerRef.current = null;
          setPhase('error');
          setErrorMsg('进度查询超时');
          message.warning({ content: '进度查询超时', key: MESSAGE_KEY });
        }
      }
    }, 3000);
  }, [message]);

  const handleStartExport = useCallback(async () => {
    // FIX: 防止快速双击创建多个导出任务
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    setPhase('processing');
    setProgress(0);
    setErrorMsg(null);

    try {
      let result: any;
      let isSingleExport = false;

      if (scope === 'current' && currentPageId) {
        isSingleExport = true;
        // FIX: 单页导出前先重新渲染，确保属性面板修改的字体/字号/颜色生效
        try {
          message.loading({ content: '正在重新渲染译文...', key: 'export-render', duration: 0 });
          await pageApi.render(currentPageId);
          message.success({ content: '渲染完成，开始导出...', key: 'export-render' });
        } catch (renderErr: any) {
          message.warning({
            content: `渲染失败，将使用已有渲染结果导出：${renderErr?.message || '未知错误'}`,
            key: 'export-render',
          });
        }
        result = await exportApi.single(currentPageId, format, quality);
      } else if (scope === 'chapter' && chapterId) {
        message.loading({ content: '正在创建导出任务...', key: MESSAGE_KEY, duration: 0 });
        result = await exportApi.chapter(chapterId, format, quality, includeBilingual, bilingualMode);
      } else {
        message.loading({ content: '正在创建导出任务...', key: MESSAGE_KEY, duration: 0 });
        result = await exportApi.project(projectId, format, quality, includeBilingual, bilingualMode);
      }

      const taskData = result.data?.data || result.data;
      const tid = taskData?.task_id;

      // FIX: 单页导出后端始终同步完成（含 render 预处理），直接下载
      // 不检查 status 字段，避免字段名不匹配导致走入不必要的轮询
      if (isSingleExport && taskData?.download_url) {
        setPhase('done');
        setTaskId(tid || null);
        setDownloadUrl(taskData.download_url);
        const fname = taskData.filename || taskData.output_filename || `export.${format}`;
        setFilename(fname);
        exportApi.downloadFile(taskData.download_url, fname);
        message.success({ content: '导出完成！', key: MESSAGE_KEY });
      } else if (tid) {
        setTaskId(tid);
        message.loading({ content: '导出中...', key: MESSAGE_KEY, duration: 0 });
        startPolling(tid);
      } else if (taskData?.download_url) {
        setPhase('done');
        setDownloadUrl(taskData.download_url);
        setFilename(taskData.filename || `export.${format}`);
        exportApi.downloadFile(taskData.download_url, taskData.filename || `export.${format}`);
        message.success({ content: '导出完成！', key: MESSAGE_KEY });
      } else {
        message.warning({ content: '导出完成，但未获取到下载链接', key: MESSAGE_KEY });
        setPhase('done');
      }
    } catch (err: any) {
      const statusCode = err?.response?.status || 0;
      if (statusCode === 404) {
        setPhase('error');
        setErrorMsg('导出服务暂不可用，后端 export_service 未就绪');
        message.warning({ content: '导出服务暂不可用', key: MESSAGE_KEY });
      } else {
        setPhase('error');
        setErrorMsg(err?.message || '导出失败');
        message.error({ content: `导出失败: ${err?.message}`, key: MESSAGE_KEY });
      }
    } finally {
      isSubmittingRef.current = false;
    }
  }, [scope, currentPageId, chapterId, projectId, format, quality, startPolling, includeBilingual, bilingualMode, message]);

  const handleRetry = useCallback(() => {
    setPhase('config');
    setProgress(0);
    setErrorMsg(null);
    setTaskId(null);
  }, []);

  const getScopeLabel = () => {
    if (scope === 'current') return `当前页 (1页)`;
    if (scope === 'chapter') return '当前章节';
    return `全部 (${allPageCount}页)`;
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      {/* 头部 */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-900 dark:text-white">导出</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X size={14} className="text-slate-400" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {phase === 'config' && (
          <>
            {/* 导出范围 */}
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-2">
                导出范围
              </label>
              <Radio.Group
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="flex flex-col gap-2"
              >
                <Radio value="current" disabled={!currentPageId}>
                  当前页 {currentPageId ? '(1页)' : '(无选中页面)'}
                </Radio>
                <Radio value="chapter" disabled={!chapterId}>
                  当前章节 {!chapterId && '(无章节信息)'}
                </Radio>
                <Radio value="project">
                  全部页面 ({allPageCount}页)
                </Radio>
              </Radio.Group>
            </div>

            {/* 导出格式 */}
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-2">
                导出格式
              </label>
              <div className="grid grid-cols-1 gap-1">
                {FORMAT_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setFormat(opt.value)}
                      className={clsx(
                        'flex items-center gap-2 p-2 rounded-lg text-left transition-colors border',
                        format === opt.value
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      )}
                    >
                      <Icon size={16} className={format === opt.value ? 'text-primary-500' : 'text-slate-400'} />
                      <div>
                        <div className="text-xs font-medium">{opt.label}</div>
                        <div className="text-[10px] text-slate-400">{opt.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 质量调节（图片格式时显示） */}
            {['png', 'jpg', 'webp'].includes(format) && (
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1">
                  质量：{quality}%
                </label>
                <Slider
                  min={1}
                  max={100}
                  value={quality}
                  onChange={setQuality}
                  tooltip={{ formatter: (v) => `${v}%` }}
                />
              </div>
            )}

            {/* 分辨率 */}
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-2">
                分辨率
              </label>
              <Select
                value={resolution}
                onChange={setResolution}
                size="small"
                className="w-full"
                options={RESOLUTION_OPTIONS}
              />
            </div>

            {/* 双语模式 */}
            {scope !== 'current' && (
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-2">
                  双语对照导出
                </label>
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={includeBilingual}
                    onChange={(e) => setIncludeBilingual(e.target.checked)}
                    className="rounded"
                    id="include-bilingual"
                  />
                  <label htmlFor="include-bilingual" className="text-xs text-slate-600 dark:text-slate-400">
                    导出双语对照版本
                  </label>
                </div>
                {includeBilingual && (
                  <div>
                    <Radio.Group
                      value={bilingualMode}
                      onChange={(e) => setBilingualMode(e.target.value)}
                      className="w-full"
                    >
                      <div className="grid grid-cols-1 gap-2">
                        {BILINGUAL_OPTIONS.map((opt) => (
                          <label
                            key={opt.value}
                            className={clsx(
                              'flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-all',
                              bilingualMode === opt.value
                                ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                            )}
                          >
                            <Radio value={opt.value} className="mt-0.5" />
                            <div className="flex-1">
                              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                {opt.label}
                              </div>
                              {/* 可视化预览 */}
                              <div className="mt-1.5 h-12 rounded bg-slate-100 dark:bg-slate-800 flex items-center overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
                                {opt.value === 'side-by-side' && (
                                  <>
                                    <div className="flex-1 h-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-[8px] text-primary-600 dark:text-primary-400 border-r border-dashed border-primary-300">
                                      原文
                                    </div>
                                    <div className="flex-1 h-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-[8px] text-green-600 dark:text-green-400">
                                      译文
                                    </div>
                                  </>
                                )}
                                {opt.value === 'top-bottom' && (
                                  <div className="flex flex-col w-full h-full">
                                    <div className="flex-1 w-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-[8px] text-primary-600 dark:text-primary-400 border-b border-dashed border-primary-300">
                                      原文
                                    </div>
                                    <div className="flex-1 w-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-[8px] text-green-600 dark:text-green-400">
                                      译文
                                    </div>
                                  </div>
                                )}
                                {opt.value === 'in-bubble' && (
                                  <div className="flex-1 h-full bg-white dark:bg-slate-700 flex items-center justify-center relative">
                                    <div className="w-3/4 h-3/4 rounded-full border border-dashed border-primary-300 flex items-center justify-center">
                                      <span className="text-[7px] text-primary-500">日/中</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1">
                                {opt.value === 'side-by-side' && '左页原文，右页译文，适合横屏阅读'}
                                {opt.value === 'top-bottom' && '上方原文，下方译文，适合打印对照'}
                                {opt.value === 'in-bubble' && '气泡内同时显示双语，紧凑不占空间'}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </Radio.Group>
                  </div>
                )}
              </div>
            )}

            {/* 开始导出按钮 */}
            <Button
              type="primary"
              block
              size="large"
              icon={<Zap size={16} />}
              onClick={handleStartExport}
              className="mt-2"
              disabled={phase !== 'config' || (scope === 'current' && !currentPageId) || (scope === 'chapter' && !chapterId)}
              loading={phase === 'processing'}
            >
              开始导出 ({getScopeLabel()})
            </Button>
          </>
        )}

        {phase === 'processing' && (
          <div className="flex flex-col items-center py-8 space-y-6">
            <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
              <Loader2 size={32} className="text-primary-500 animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                正在导出{getScopeLabel()}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                格式: {format.toUpperCase()}
              </p>
            </div>
            <Progress
              percent={progress}
              status="active"
              strokeColor="#6366F1"
              className="w-full"
              format={(p) => `${p}%`}
            />
            <p className="text-xs text-slate-400">正在处理中，请稍候...</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center py-8 space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-green-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-green-600 dark:text-green-400">导出完成！</p>
              <p className="text-xs text-slate-400 mt-1">
                {filename}
              </p>
            </div>
            <Progress percent={100} status="success" strokeColor="#10B981" className="w-full" />
            <div className="flex gap-2 w-full">
              {downloadUrl && (
                <Button
                  block
                  icon={<Download size={14} />}
                  onClick={() => exportApi.downloadFile(downloadUrl, filename)}
                >
                  重新下载
                </Button>
              )}
              <Button block onClick={handleRetry}>
                新建导出
              </Button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center py-8 space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-red-500">导出失败</p>
              <p className="text-xs text-slate-400 mt-1">{errorMsg}</p>
            </div>
            <div className="flex gap-2 w-full">
              <Button
                block
                icon={<RefreshCw size={14} />}
                onClick={handleStartExport}
                type="primary"
              >
                重试
              </Button>
              <Button block onClick={handleRetry}>
                返回设置
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
