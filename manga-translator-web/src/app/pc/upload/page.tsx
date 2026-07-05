'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Upload, LogIn, Plus, ArrowRight, Globe, FileText, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { Select, Button, Input, Progress, App, Alert } from 'antd';
import { useAuthHydrated, useHasAuth } from '@/hooks/useAuthHydrated';
import { projectApi } from '@/services/project';
import type { SourceLang } from '@/types';

const SOURCE_LANG_OPTIONS: { value: SourceLang; label: string }[] = [
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'en', label: '英语' },
  { value: 'zh', label: '中文' },
];

const TARGET_LANG_OPTIONS = [
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
];

const SUPPORTED_FORMATS_TEXT = 'JPG / PNG / WebP / CBZ / ZIP / RAR / PDF';
const SUPPORTED_EXTENSIONS = '.jpg,.jpeg,.png,.webp,.cbz,.zip,.rar,.pdf';

type UploadState = 'idle' | 'creating' | 'uploading' | 'done' | 'error';

/**
 * 上传翻译入口页 — 独立上传页面
 * 未登录：展示完整上传表单预览，点击上传区域引导登录
 * 已登录：直接上传文件并创建翻译项目
 */
export default function UploadPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const authReady = useAuthHydrated();
  const hasAuth = useHasAuth();

  const [projectName, setProjectName] = useState('');
  const [sourceLang, setSourceLang] = useState<SourceLang>('ja');
  const [targetLang, setTargetLang] = useState('zh');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const goLogin = useCallback(() => {
    router.push('/login?redirect=/pc/upload');
  }, [router]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // 自动使用文件名作为项目名
      if (!projectName) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        setProjectName(nameWithoutExt || '未命名作品');
      }
    }
    // reset so the same file can be selected again
    e.target.value = '';
  }, [projectName]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!projectName) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        setProjectName(nameWithoutExt || '未命名作品');
      }
    }
  }, [projectName]);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) {
      message.warning('请先选择要上传的文件');
      return;
    }
    setErrorMsg('');
    setUploadState('creating');

    try {
      // Step 1: 创建项目
      const projectRes = await projectApi.create({
        name: projectName || '未命名作品',
        source_lang: sourceLang,
        default_target_lang: targetLang,
      });
      const projectId = projectRes.data?.data?.project_id;
      if (!projectId) throw new Error('创建项目失败');
      setCreatedProjectId(projectId);

      // Step 2: 创建默认章节
      const chapterRes = await projectApi.createChapter(projectId, {
        name: '第1话',
      });
      const chapterId = chapterRes.data?.data?.chapter_id;
      if (!chapterId) throw new Error('创建章节失败');

      // Step 3: 上传文件到章节
      setUploadState('uploading');
      const formData = new FormData();
      formData.append('file', selectedFile);

      const { default: request } = await import('@/services/request');
      const { API_UPLOAD_TIMEOUT_MS } = await import('@/constants');
      const ARCHIVE_EXTS = ['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.pdf'];
      const fileExt = '.' + selectedFile.name.split('.').pop()?.toLowerCase();
      const isArchive = ARCHIVE_EXTS.includes(fileExt);

      if (isArchive) {
        await request.post(`/chapters/${chapterId}/pages/upload-archive`, formData, {
          timeout: API_UPLOAD_TIMEOUT_MS,
          onUploadProgress: (e) => {
            if (e.total) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
          },
        });
      } else {
        await request.post(`/chapters/${chapterId}/pages/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: API_UPLOAD_TIMEOUT_MS,
          onUploadProgress: (e) => {
            if (e.total) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
          },
        });
      }

      setUploadState('done');
      message.success('上传成功！正在跳转到翻译编辑器...');

      // 跳转到项目详情页
      setTimeout(() => {
        router.push(`/pc/projects/${projectId}`);
      }, 1500);
    } catch (err: any) {
      setUploadState('error');
      const msg = err?.response?.data?.message || err?.message || '上传失败，请重试';
      setErrorMsg(msg);
      message.error(msg);
    }
  }, [selectedFile, projectName, sourceLang, targetLang, message, router]);

  // 等待认证状态加载
  if (!authReady) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-center text-sm text-slate-500">
        加载中...
      </div>
    );
  }

  // 未登录：展示预览引导登录
  if (!hasAuth) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12" data-testid="upload-guest-page">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-900/30 mb-4">
            <Upload size={32} className="text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">上传漫画翻译</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            支持 {SUPPORTED_FORMATS_TEXT} 等格式
          </p>
        </div>

        <div className="glass-card p-8 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                <Globe size={12} /> 源语言
              </label>
              <Select
                defaultValue="ja"
                options={SOURCE_LANG_OPTIONS}
                className="w-full"
                disabled
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                <Globe size={12} /> 目标语言
              </label>
              <Select
                defaultValue="zh"
                options={TARGET_LANG_OPTIONS}
                className="w-full"
                disabled
              />
            </div>
          </div>

          <button
            type="button"
            onClick={goLogin}
            className="w-full border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 dark:hover:bg-primary-900/10 transition-colors"
            data-testid="upload-dropzone"
          >
            <Upload size={40} className="mx-auto mb-3 text-slate-400" />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              拖拽文件到此处，或点击选择文件上传
            </p>
            <p className="text-xs text-slate-400 mt-1">
              图片 ≤50MB，压缩包/PDF ≤500MB · 登录后即可上传
            </p>
          </button>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/login?redirect=/pc/upload"
              className="btn-primary flex-1 justify-center py-2.5"
              data-testid="upload-login-btn"
            >
              <LogIn size={18} />
              登录后上传
            </Link>
            <Link
              href="/register"
              className="btn-ghost flex-1 justify-center py-2.5 border border-slate-200 dark:border-slate-700"
            >
              <Plus size={18} />
              注册新账号
            </Link>
          </div>

          <Link
            href="/pc"
            className="flex items-center justify-center gap-1 text-sm text-slate-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            返回作品列表
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  // 已登录：完整上传页面
  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
              <Upload size={22} className="text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">上传翻译</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                上传漫画文件并开始翻译
              </p>
            </div>
          </div>
          <Link
            href="/pc"
            className="text-sm text-slate-500 hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-1"
          >
            <ArrowRight size={14} className="rotate-180" />
            返回列表
          </Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* 项目名称 */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <FileText size={14} /> 作品名称
          </label>
          <Input
            placeholder="输入作品名称（将自动使用文件名）"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            size="large"
            disabled={uploadState !== 'idle'}
          />
        </div>

        {/* 语言选择 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Globe size={14} /> 源语言
            </label>
            <Select
              value={sourceLang}
              onChange={(v) => setSourceLang(v)}
              options={SOURCE_LANG_OPTIONS}
              className="w-full"
              size="large"
              disabled={uploadState !== 'idle'}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Globe size={14} /> 目标语言
            </label>
            <Select
              value={targetLang}
              onChange={(v) => setTargetLang(v)}
              options={TARGET_LANG_OPTIONS}
              className="w-full"
              size="large"
              disabled={uploadState !== 'idle'}
            />
          </div>
        </div>

        {/* 错误提示 */}
        {uploadState === 'error' && errorMsg && (
          <Alert
            type="error"
            showIcon
            icon={<AlertCircle size={16} />}
            message="上传失败"
            description={errorMsg}
            closable
            onClose={() => { setErrorMsg(''); setUploadState('idle'); }}
            action={
              <Button size="small" onClick={() => { setUploadState('idle'); setErrorMsg(''); }}>
                重试
              </Button>
            }
          />
        )}

        {/* 文件上传区域 */}
        {uploadState === 'idle' || uploadState === 'error' ? (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-10 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 dark:hover:bg-primary-900/10 transition-colors"
          >
            {selectedFile ? (
              <div className="space-y-3">
                <div className="w-14 h-14 mx-auto rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
                  <FileText size={28} className="text-primary-500" />
                </div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 break-all">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-slate-400">
                  {(selectedFile.size / 1024 / 1024).toFixed(1)} MB · 点击重新选择
                </p>
              </div>
            ) : (
              <>
                <Upload size={40} className="mx-auto mb-3 text-slate-400" />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  拖拽文件到此处，或点击选择文件上传
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  支持 {SUPPORTED_FORMATS_TEXT} · 图片 ≤50MB，压缩包/PDF ≤500MB
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_EXTENSIONS}
              onChange={handleFileSelect}
              className="sr-only"
              aria-label="选择漫画文件上传"
            />
          </div>
        ) : uploadState === 'creating' ? (
          <div className="border-2 border-dashed border-primary-300 dark:border-primary-700 rounded-xl p-10 text-center bg-primary-50/30 dark:bg-primary-900/10">
            <Loader2 size={40} className="mx-auto mb-3 text-primary-500 animate-spin" />
            <p className="text-sm text-slate-600 dark:text-slate-400">正在创建翻译项目...</p>
          </div>
        ) : uploadState === 'uploading' ? (
          <div className="border-2 border-dashed border-primary-300 dark:border-primary-700 rounded-xl p-10 text-center bg-primary-50/30 dark:bg-primary-900/10">
            <Loader2 size={40} className="mx-auto mb-3 text-primary-500 animate-spin" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              正在上传文件...
            </p>
            <Progress percent={uploadProgress} status="active" size="small" />
            <p className="text-xs text-slate-400 mt-2">
              {selectedFile?.name} ({(selectedFile ? selectedFile.size / 1024 / 1024 : 0).toFixed(1)} MB)
            </p>
          </div>
        ) : (
          <div className="border-2 border-dashed border-green-300 dark:border-green-700 rounded-xl p-10 text-center bg-green-50/30 dark:bg-green-900/10">
            <CheckCircle size={40} className="mx-auto mb-3 text-green-500" />
            <p className="text-sm font-medium text-green-700 dark:text-green-300 mb-1">
              上传完成！
            </p>
            <p className="text-xs text-slate-400">
              正在跳转到翻译编辑器...
            </p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <Button
            type="primary"
            size="large"
            icon={<Upload size={18} />}
            onClick={handleUpload}
            loading={uploadState === 'creating' || uploadState === 'uploading'}
            disabled={
              !selectedFile ||
              uploadState === 'done' ||
              uploadState === 'creating' ||
              uploadState === 'uploading'
            }
            block
            className="h-12"
          >
            {uploadState === 'idle' || uploadState === 'error'
              ? '开始上传翻译'
              : uploadState === 'uploading' 
                ? '上传中...' 
                : uploadState === 'creating'
                  ? '创建项目中...'
                  : '上传完成'}
          </Button>
          <Link
            href="/pc"
            className="btn-ghost flex items-center justify-center py-2.5 px-4 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            取消
          </Link>
        </div>

        {/* 使用提示 */}
        <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-2">上传提示</p>
          <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
            <li>支持的图片格式：JPG、PNG、WebP（单张 ≤50MB）</li>
            <li>支持的压缩包格式：CBZ、ZIP、RAR（≤500MB）</li>
            <li>支持的文档格式：PDF（≤500MB）</li>
            <li>上传后将自动创建翻译项目并进入编辑器</li>
            <li>翻译完成后可选择导出为 PDF 或多格式图片</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
