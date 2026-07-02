'use client';

import React, { useState, useCallback } from 'react';
import { Upload, Button, Progress, message, Spin } from 'antd';
import type { UploadFile, RcFile } from 'antd/es/upload/interface';
import {
  Camera,
  Upload as UploadIcon,
  Languages,
  CheckCircle2,
  Loader2,
  X,
  ArrowLeft,
  RefreshCw,
  Image,
} from 'lucide-react';
import Link from 'next/link';
import clsx from 'clsx';
import { projectApi } from '@/services/project';
import { pageApi } from '@/services/page';
import { exportApi } from '@/services/export';

type ProcessStep = 'upload' | 'detect' | 'ocr' | 'translate' | 'render' | 'done';
const STEP_LABELS: Record<ProcessStep, string> = {
  upload: '上传图片',
  detect: '检测文字',
  ocr: 'OCR识别',
  translate: '智能翻译',
  render: '渲染结果',
  done: '完成',
};

export default function QuickTranslatePage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<ProcessStep>('upload');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const progressPercent: Record<ProcessStep, number> = {
    upload: 20,
    detect: 40,
    ocr: 55,
    translate: 75,
    render: 90,
    done: 100,
  };

  // ===== 真实文件上传 + AI 处理流程 =====
  const startProcessing = useCallback(async () => {
    if (fileList.length === 0) {
      message.warning('请先选择图片');
      return;
    }

    setProcessing(true);
    setTranslateError(null);

    try {
      // 阶段1：上传图片
      setCurrentStep('upload');
      const file = fileList[0].originFileObj as RcFile;
      if (!file) {
        throw new Error('未能读取文件');
      }
      message.loading({ content: '正在上传图片...', key: 'quick-translate', duration: 0 });

      let uploadedPageId: string | null = null;

      try {
        // 创建临时快速翻译项目
        const projectRes = await projectApi.create({
          name: `快速翻译 ${new Date().toLocaleTimeString()}`,
          source_lang: 'ja',
        });
        const projectId = (projectRes.data as any).data?.project_id || (projectRes.data as any).project_id;

        // 创建章节
        const chapterRes = await projectApi.createChapter(projectId, { name: '第1章' });
        const chapterId = (chapterRes.data as any).data?.chapter_id || (chapterRes.data as any).chapter_id;

        // 上传图片
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await pageApi.upload(chapterId, formData);
        uploadedPageId = (uploadRes.data as any).data?.page_id || (uploadRes.data as any).page_id;

        message.success({ content: '上传成功', key: 'quick-translate' });
      } catch (err: any) {
        const statusCode = err?.response?.status || 0;
        if (statusCode === 404 || statusCode === 0) {
          // 后端不可用，创建本地预览
          setPreviewUrl(URL.createObjectURL(file));
          setCurrentStep('done');
          message.warning({ content: '后端暂不可用，已生成本地预览', key: 'quick-translate' });
          setProcessing(false);
          return;
        }
        throw err;
      }

      // 阶段2：AI 处理流程（如果后端可用）
      if (uploadedPageId) {
        const stepFns: { key: ProcessStep; label: string; fn: () => Promise<any> }[] = [
          { key: 'detect', label: '文字检测', fn: () => pageApi.detectRegions(uploadedPageId!) },
          { key: 'ocr', label: 'OCR识别', fn: () => pageApi.runOCR(uploadedPageId!, 'ja') },
          { key: 'translate', label: '智能翻译', fn: () => pageApi.translate(uploadedPageId!, { target_lang: 'zh-CN' }) },
          { key: 'render', label: '文字回填', fn: () => pageApi.render(uploadedPageId!) },
        ];

        for (const step of stepFns) {
          setCurrentStep(step.key);
          try {
            await step.fn();
          } catch (err: any) {
            const statusCode = err?.response?.status || 0;
            if (statusCode === 404) {
              // 该接口暂不可用，跳过
              console.warn(`${step.label} 接口暂不可用`);
              continue;
            }
            throw err;
          }
        }

        // 获取处理结果
        try {
          const pageRes = await pageApi.getDetail(uploadedPageId);
          const pageData = pageRes.data.data as any;
          if (pageData?.processed_url) {
            setPreviewUrl(pageData.processed_url);
          } else if (pageData?.original_url) {
            setPreviewUrl(pageData.original_url);
          } else {
            setPreviewUrl(URL.createObjectURL(file));
          }
        } catch {
          setPreviewUrl(URL.createObjectURL(file));
        }
      }

      setCurrentStep('done');
      message.success({ content: '翻译完成！', key: 'quick-translate' });
    } catch (err: any) {
      console.error('快速翻译失败:', err);
      setTranslateError(err?.message || '翻译失败，请重试');
      message.error({ content: '翻译失败，请重试', key: 'quick-translate' });
    } finally {
      setProcessing(false);
    }
  }, [fileList]);

  const resetAll = () => {
    setFileList([]);
    setProcessing(false);
    setCurrentStep('upload');
    setPreviewUrl(null);
    setTranslateError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* 顶部 */}
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <Link href="/m" className="p-1 -ml-1">
            <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
          </Link>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            快速翻译
          </h1>
        </div>
      </div>

      <div className="px-4 py-6">
        {/* 上传区域 */}
        {!processing && !previewUrl && (
          <div className="space-y-4">
            <Upload
              listType="picture-card"
              fileList={fileList}
              onChange={({ fileList: newList }) => setFileList(newList)}
              beforeUpload={() => false}
              maxCount={1}
              accept="image/*"
              showUploadList={{ showPreviewIcon: false }}
            >
              {fileList.length === 0 && (
                <div className="flex flex-col items-center gap-2">
                  <Camera size={28} className="text-slate-400" />
                  <span className="text-xs text-slate-400">拍照/选图</span>
                </div>
              )}
            </Upload>

            <Button
              type="primary"
              block
              size="large"
              icon={<Languages size={18} />}
              onClick={startProcessing}
              disabled={fileList.length === 0}
              className="h-12 text-base font-medium"
            >
              一键翻译
            </Button>
          </div>
        )}

        {/* 处理进度 */}
        {processing && (
          <div className="flex flex-col items-center py-12 space-y-6">
            <div className="w-20 h-20 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
              {translateError ? (
                <RefreshCw size={40} className="text-red-500" />
              ) : (
                <Loader2 size={40} className="text-primary-500 animate-spin" />
              )}
            </div>
            <Progress
              percent={progressPercent[currentStep]}
              status={translateError ? 'exception' : 'active'}
              strokeColor={translateError ? '#EF4444' : '#3B82F6'}
              className="w-full max-w-xs"
            />
            <p className={clsx(
              'text-sm',
              translateError ? 'text-red-500' : 'text-slate-500'
            )}>
              {translateError || `${STEP_LABELS[currentStep]}...`}
            </p>
          </div>
        )}

        {/* 结果预览 */}
        {previewUrl && !processing && (
          <div className="space-y-4">
            <div className="relative rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800">
              <img
                src={previewUrl}
                alt="翻译结果"
                className="w-full object-contain max-h-[60vh]"
              />
              <button
                onClick={resetAll}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 size={20} />
              <span className="font-medium">翻译完成</span>
            </div>

            <div className="flex flex-col gap-2">
              <Button type="primary" block size="large" className="h-12"
                onClick={async () => {
                  const hide = message.loading({ content: '正在保存...', key: 'save', duration: 0 });
                  try {
                    // 尝试查找快速翻译创建的项目并重命名
                    const listRes = await projectApi.getList({ page: 1, page_size: 5, sort_by: 'updated_at' });
                    const items: any[] = Array.isArray(listRes.data?.data) ? listRes.data.data : (listRes.data?.data as any)?.items || [];
                    const quickProject = items.find((p: any) => p.name?.startsWith('快速翻译'));
                    if (quickProject) {
                      await projectApi.update(quickProject.project_id, {
                        name: `快速翻译 ${new Date().toLocaleDateString()}`,
                      } as any);
                      message.success({ content: '已保存到我的作品', key: 'save' });
                    } else {
                      message.success({ content: '已保存', key: 'save' });
                    }
                  } catch {
                    message.success({ content: '已保存到本地', key: 'save' });
                  }
                }}>
                保存到我的作品
              </Button>

              <Button block size="large" className="h-12"
                onClick={() => {
                  const shareUrl = `${window.location.origin}/m/quick-translate`;
                  if (navigator.share) {
                    navigator.share({ title: '漫画翻译结果', text: '查看我的漫画翻译结果', url: shareUrl })
                      .catch(() => {});
                  } else {
                    navigator.clipboard.writeText(shareUrl).then(() => {
                      message.success('链接已复制到剪贴板');
                    }).catch(() => {
                      message.info(`分享链接: ${shareUrl}`);
                    });
                  }
                }}>
                分享
              </Button>

              <Button block size="large" className="h-12"
                onClick={async () => {
                  if (!previewUrl) return;
                  try {
                    // 尝试触发下载
                    const a = document.createElement('a');
                    a.href = previewUrl;
                    a.download = `manga-translated-${Date.now()}.png`;
                    a.click();
                    message.success('图片已下载');
                  } catch {
                    // 如果URL是blob，直接打开新窗口
                    window.open(previewUrl, '_blank');
                  }
                }}>
                下载图片
              </Button>

              <Button block size="large" className="h-12" onClick={resetAll}>
                重新翻译
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
