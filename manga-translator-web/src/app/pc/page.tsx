'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/stores/authStore';
import { Modal, Form, Input, Select, Popconfirm, Skeleton, App } from 'antd';
import {
  Plus,
  Search,
  Upload,
  Star,
  Trash2,
  Clock,
  CheckCircle2,
  Image,
  Grid3X3,
  List,
  ArrowUpDown,
  Sparkles,
  Languages,
  RefreshCw,
  AlertCircle,
  X,
  LogIn,
  Crown,
} from 'lucide-react';
import clsx from 'clsx';
import { projectApi } from '@/services/project';
import { useProjects } from '@/hooks/useApiQueries';
import { useAuthHydrated, useHasAuth } from '@/hooks/useAuthHydrated';
import { useOptimisticMutation } from '@/hooks/useQueryState';
import { ProgressiveImage } from '@/components/common/ProgressiveImage';
import { resolveProcessedImageUrl } from '@/utils/pageImage';
import type { ProjectData, CreateProjectParams, SourceLang } from '@/types';

// ===== 时间格式化 =====
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
}

// ===== 语言标签 =====
const LANG_LABELS: Record<string, string> = {
  ja: '日语',
  zh: '中文',
  en: '英语',
  ko: '韩语',
};

const LANG_OPTIONS: { value: SourceLang; label: string }[] = [
  { value: 'ja', label: '日语' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ko', label: '韩语' },
];

const TARGET_LANG_OPTIONS: { value: string; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
];

// ===== Skeleton 加载组件 =====
function ProjectCardSkeleton() {
  return (
    <div className="glass-card overflow-hidden animate-pulse-soft">
      <div className="aspect-[3/4] skeleton" />
      <div className="p-3 space-y-2.5">
        <div className="h-4 w-3/4 skeleton rounded-lg" />
        <div className="h-3 w-1/2 skeleton rounded-lg" />
        <div className="h-3 w-1/3 skeleton rounded-lg" />
      </div>
    </div>
  );
}

// ===== 项目卡片组件 =====
function ProjectCard({
  project,
  onDelete,
  onToggleFavorite,
  index = 0,
}: {
  project: ProjectData;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string, fav: boolean) => void;
  index?: number;
}) {
  const progress = project.page_count
    ? (project.completed_count || 0) / project.page_count
    : 0;
  const isCompleted = progress >= 1;
  const coverUrl = resolveProcessedImageUrl(project.cover_url);

  return (
    <div
      className="group block overflow-hidden relative animate-fade-in-up"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {/* 玻璃态卡片容器 */}
      <div className="glass-card-hover relative overflow-hidden rounded-2xl">
        {/* 卡片顶部装饰渐变条 */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-400 via-blue-500 to-accent-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-20" />

        <Link href={`/pc/projects/${project.project_id}`}>
          {/* 封面区域 */}
          <div className="relative aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 overflow-hidden">
            {coverUrl ? (
              <>
                <ProgressiveImage
                  src={coverUrl}
                  alt={project.name}
                  aspectRatio="3/4"
                  className="absolute inset-0 w-full h-full transition-transform duration-700 ease-out group-hover:scale-110"
                  lazy={true}
                />
                {/* 封面悬停时的渐变叠加 */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              </>
            ) : (
              <>
                <div className="absolute inset-0 bg-gradient-to-br from-primary-500 via-violet-500 to-rose-400 dark:from-primary-600 dark:via-violet-600 dark:to-rose-500 transition-all duration-700 ease-out group-hover:scale-105" />
                {/* 装饰几何形状 */}
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 group-hover:scale-150 transition-transform duration-700 ease-out" />
                <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-white/10 group-hover:scale-125 transition-transform duration-700 ease-out delay-100" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="p-5 rounded-2xl bg-white/10 backdrop-blur-sm group-hover:bg-white/20 transition-all duration-500 group-hover:scale-110">
                    <Image size={48} className="text-white/80 group-hover:text-white transition-all duration-500" />
                  </div>
                </div>
              </>
            )}

            {/* 收藏标记 - 更精致的样式 */}
            {project.is_favorite && (
              <div className="absolute top-3 right-3 z-10">
                <div className="p-1.5 rounded-lg bg-amber-400/90 backdrop-blur-sm shadow-lg shadow-amber-500/25">
                  <Star size={16} className="text-white fill-white" />
                </div>
              </div>
            )}

            {/* 进度条 - 更精致的设计 */}
            <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/30 backdrop-blur-sm">
              <div
                className={clsx(
                  'h-full transition-all duration-1000 ease-out relative',
                  isCompleted
                    ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                    : 'bg-gradient-to-r from-white/90 to-white/70'
                )}
                style={{ width: `${Math.max(progress * 100, 2)}%` }}
              >
                {!isCompleted && progress > 0 && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white shadow-lg animate-pulse" />
                )}
              </div>
            </div>

            {/* 悬停时显示的操作按钮 */}
            <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0 z-10">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onToggleFavorite(project.project_id, project.is_favorite);
                }}
                className="p-2 rounded-lg bg-white/80 dark:bg-slate-800/80 backdrop-blur-md text-slate-500 hover:text-amber-500 transition-all shadow-sm hover:shadow-md"
                title={project.is_favorite ? '取消收藏' : '收藏'}
              >
                <Star size={14} className={project.is_favorite ? 'fill-amber-400 text-amber-400' : ''} />
              </button>
            </div>
          </div>

          {/* 信息区域 - 更精致的排版和间距 */}
          <div className="p-4 space-y-3">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors leading-snug">
              {project.name}
            </h3>

            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 text-xs font-semibold">
                <Languages size={12} />
                {LANG_LABELS[project.source_lang] || project.source_lang}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                {project.completed_count || 0}/{project.page_count || 0} 页
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                <Clock size={11} className="flex-shrink-0" />
                <span>{formatTime(project.updated_at)}</span>
              </div>

              {/* 完成标记 */}
              {isCompleted && (project.page_count || 0) > 0 && (
                <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                  <div className="p-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/30">
                    <CheckCircle2 size={10} />
                  </div>
                  <span>已完成</span>
                </div>
              )}
            </div>

            {/* 进度百分比指示器 */}
            {progress > 0 && !isCompleted && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">进度</span>
                  <span className="font-semibold text-primary-600 dark:text-primary-400">{Math.round(progress * 100)}%</span>
                </div>
                <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-400 to-primary-500 rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </Link>

        {/* 删除按钮 */}
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0 z-10">
          <Popconfirm
            title="确定要删除这个作品吗？"
            description="删除后可在回收站恢复"
            onConfirm={() => onDelete(project.project_id)}
            okText="确定"
            cancelText="取消"
          >
            <button
              className="p-2 rounded-lg bg-white/80 dark:bg-slate-800/80 backdrop-blur-md text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all shadow-sm hover:shadow-md"
              onClick={(e) => e.preventDefault()}
            >
              <Trash2 size={14} />
            </button>
          </Popconfirm>
        </div>
      </div>
    </div>
  );
}

// ===== 新建作品 Modal（含文件上传） =====
function CreateProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'processing'>('idle');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif', '.cbz', '.zip', '.rar', '.cbr', '.7z', '.cb7', '.pdf'];
  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif'];
  const SUPPORTED_MIME = [
    'image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif',
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    'application/pdf', 'application/x-cbz', 'application/x-cbr', 'application/vnd.rar',
    'application/x-zip-compressed', 'application/octet-stream',
    'application/vnd.comicbook+zip', 'application/vnd.comicbook+rar',
    'application/x-7z-compressed', 'application/x-cb7',
  ];

  const validateFile = (file: File): string | null => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext) && !SUPPORTED_MIME.includes(file.type)) {
      return `不支持的文件格式: ${file.name}`;
    }
    if (file.size > 500 * 1024 * 1024) {
      return `文件过大: ${file.name}（最大 500MB）`;
    }
    // 图片文件（按扩展名或MIME判断）限制 50MB
    const isImage = IMAGE_EXTENSIONS.includes(ext) || file.type.startsWith('image/');
    if (isImage && file.size > 50 * 1024 * 1024) {
      return `图片过大: ${file.name}（最大 50MB）`;
    }
    return null;
  };

  const handleFilesSelected = useCallback((newFiles: File[]) => {
    const validFiles: File[] = [];
    for (const f of newFiles) {
      const err = validateFile(f);
      if (err) {
        message.warning(err);
      } else {
        validFiles.push(f);
      }
    }
    if (validFiles.length > 0) {
      if (files.length + validFiles.length > 200) {
        message.warning('最多一次上传 200 张图片');
        validFiles.splice(200 - files.length);
      }
      setFiles(prev => [...prev, ...validFiles]);
    }
  }, [files.length]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFilesSelected(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) {
      handleFilesSelected(Array.from(e.dataTransfer.files));
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 关闭时重置（上传中也能立即关闭）
  const handleClose = () => {
    // 取消正在进行的上传请求
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    setFiles([]);
    setUploadProgress(0);
    setCurrentFileIndex(0);
    setUploadPhase('idle');
    form.resetFields();
    onClose();
  };

  const handleSubmit = async () => {
    // 创建新的 AbortController
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      const values = await form.validateFields();
      setLoading(true);

      // 1. 创建作品
      const project = await projectApi.create(values as CreateProjectParams);
      const projectData = (project.data as any)?.data || project.data;
      const projectId = projectData?.project_id;
      if (!projectId) throw new Error('作品创建失败：未获取到项目ID');

      let chapterId: string | undefined;
      let firstPageId: string | undefined;

      // 2. 如果有上传文件，创建章节并上传页面
      if (files.length > 0) {
        // 创建默认章节
        const chapter = await projectApi.createChapter(projectId, { name: '第1话' });
        const chapterData = (chapter.data as any)?.data || chapter.data;
        chapterId = chapterData?.chapter_id;
        if (!chapterId) throw new Error('章节创建失败');

        // 分离压缩包/PDF 与图片文件
        const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif'];
        const archiveFiles = files.filter(f => {
          const ext = '.' + f.name.split('.').pop()?.toLowerCase();
          return ['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.pdf'].includes(ext);
        });
        const imageFiles = files.filter(f => {
          const ext = '.' + f.name.split('.').pop()?.toLowerCase();
          return IMAGE_EXTS.includes(ext);
        });

        const totalTasks = archiveFiles.length + (imageFiles.length > 0 ? 1 : 0);

        const { pageApi } = await import('@/services/page');
        let successCount = 0;
        let completedTask = 0;

        const updateOverallProgress = (taskProgress: number) => {
          const taskWeight = 100 / totalTasks;
          const overallProgress = (completedTask * taskWeight) + (taskProgress / 100) * taskWeight;
          setUploadProgress(Math.round(overallProgress));
          if (taskProgress >= 100) {
            setUploadPhase('processing');
          }
        };

        setUploadPhase('uploading');

        // 批量上传所有图片（一次请求，速度快很多）
        if (imageFiles.length > 0) {
          const imageFormData = new FormData();
          imageFiles.forEach(f => imageFormData.append('files', f));
          try {
            setUploadPhase('uploading');
            const uploadRes = await pageApi.upload(chapterId, imageFormData, (pct) => {
              updateOverallProgress(pct);
            }, signal);
            const uploadData = (uploadRes.data as any)?.data || uploadRes.data;
            firstPageId = uploadData?.pages?.[0]?.page_id;
            successCount += imageFiles.length;
          } catch (err: any) {
            if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return; // 用户主动取消
            message.warning('图片文件上传失败，已跳过');
          }
          completedTask++;
          updateOverallProgress(100);
        }

        // 逐个上传压缩包
        for (const archiveFile of archiveFiles) {
          // 检查是否已被取消
          if (signal.aborted) break;
          setCurrentFileIndex(completedTask);
          const formData = new FormData();
          formData.append('file', archiveFile);
          try {
            setUploadPhase('uploading');
            const archiveRes = await pageApi.uploadArchive(chapterId, formData, (pct) => {
              updateOverallProgress(pct);
            }, signal);
            if (!firstPageId) {
              const archiveData = (archiveRes.data as any)?.data || archiveRes.data;
              firstPageId = archiveData?.pages?.[0]?.page_id;
            }
            successCount++;
          } catch (err: any) {
            if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') break;
            message.warning(`文件 "${archiveFile.name}" 上传失败，已跳过`);
          }
          completedTask++;
          updateOverallProgress(100);
          setCurrentFileIndex(completedTask);
        }

        if (successCount > 0) {
          message.success(`作品创建成功，已上传 ${successCount} 个文件`);
        } else if (!signal.aborted) {
          message.success('作品创建成功');
        }
      } else {
        message.success('作品创建成功（空项目，可在编辑器中上传页面）');
      }

      if (!signal.aborted) {
        form.resetFields();
        setFiles([]);
        setUploadProgress(0);
        onCreated();
        onClose();

        const params = new URLSearchParams();
        if (chapterId) params.set('chapter', chapterId);
        if (firstPageId) params.set('page', firstPageId);
        const query = params.toString();
        router.push(`/pc/projects/${projectId}${query ? `?${query}` : ''}`);
      }
    } catch (err: any) {
      if (err?.errorFields) return;
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
      message.error(err.message || '创建失败');
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    if (IMAGE_EXTENSIONS.includes('.' + ext)) return '🖼️';
    if (ext === 'pdf') return '📄';
    return '📦';
  };

  return (
    <Modal
      title="新建作品"
      open={open}
      onOk={handleSubmit}
      onCancel={handleClose}
      confirmLoading={loading}
      cancelButtonProps={{ disabled: false }}
      closable={true}
      maskClosable={!loading}
      keyboard={!loading}
      okText={files.length > 0 ? '创建并上传' : '创建空项目'}
      cancelText={loading ? '取消上传' : '取消'}
      centered
      width={560}
      afterClose={() => { setFiles([]); setUploadProgress(0); }}
    >
      <Form form={form} layout="vertical" className="mt-4">
        <Form.Item
          name="name"
          label="作品名称"
          rules={[{ required: true, message: '请输入作品名称' }]}
        >
          <Input placeholder="例如：海贼王 第1088话" />
        </Form.Item>
        <Form.Item
          name="source_lang"
          label="源语言"
          rules={[{ required: true, message: '请选择源语言' }]}
          initialValue="ja"
        >
          <Select options={LANG_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="default_target_lang"
          label="目标语言（翻译方向）"
          rules={[{ required: true, message: '请选择目标语言' }]}
          initialValue="zh-CN"
        >
          <Select options={TARGET_LANG_OPTIONS} />
        </Form.Item>
      </Form>

      {/* 文件上传区域 */}
      <div className="mt-2 mb-2">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          上传漫画文件 <span className="text-xs text-slate-400 font-normal">（可选，支持 JPG/PNG/WebP/BMP/TIFF/GIF/CBZ/ZIP/RAR/CBR/7Z/CB7/PDF）</span>
        </div>

        {/* 拖拽上传区 */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all ${
            dragOver
              ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
              : 'border-slate-300 dark:border-slate-600 hover:border-primary-400 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Upload size={24} className="mx-auto mb-1 text-slate-400" />
          <p className="text-xs text-slate-500">拖拽文件到此处，或点击选择</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            图片 ≤50MB，压缩包/PDF ≤500MB，最多 200 个文件
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,.cbz,.zip,.rar,.7z,.pdf"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        {/* 已选文件列表 */}
        {files.length > 0 && (
          <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-800 rounded text-xs">
                <span>{getFileIcon(f.name)}</span>
                <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{f.name}</span>
                <span className="text-slate-400 flex-shrink-0">{formatFileSize(f.size)}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500 flex-shrink-0"
                  disabled={loading}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 上传进度 */}
        {loading && files.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className={uploadPhase === 'processing' ? 'text-amber-600 font-medium' : 'text-slate-500'}>
                {uploadPhase === 'uploading' && `正在上传... ${uploadProgress}%`}
                {uploadPhase === 'processing' && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    后端正在处理文件，请稍候...
                  </span>
                )}
              </span>
              {uploadPhase === 'uploading' && <span className="text-slate-400">{uploadProgress}%</span>}
            </div>
            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  uploadPhase === 'processing'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-gradient-to-r from-blue-500 to-primary-500'
                }`}
                style={{ width: `${Math.max(uploadProgress, 2)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ===== 主页面 =====
export default function ProjectListPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <Skeleton active />
        </div>
      }
    >
      <ProjectListPageContent />
    </React.Suspense>
  );
}

function ProjectListPageContent() {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const authReady = useAuthHydrated();
  const hasAuth = useHasAuth();
  const { user } = useAuthStore();

  // FIX: P0-登录态数据加载 - 使用 store 的 _hydrated 替代本地 useState
  // store._hydrated 由 onRehydrateStorage 回调设置，确保与 isAuthenticated 同步
  // 避免本地 hydrated=true 时 isAuthenticated 仍为 false 的时序问题
  useEffect(() => {
    // DEV: 开发模式绕过认证 — 仅开发环境可用
    if (typeof window !== 'undefined' && window.location.search.includes('dev_bypass=1') && process.env.NODE_ENV !== 'production') {
      // 直接设置 auth store 状态，跳过水合等待
      useAuthStore.setState({
        accessToken: 'dev_bypass_token',
        refreshToken: 'dev_bypass_refresh',
        isAuthenticated: true,
        _hydrated: true,
        user: {
          user_id: 'dev-test',
          email: 'test@example.com',
          nickname: 'DevTest',
          plan_type: 'free',
          created_at: new Date().toISOString()
        }
      });
    }
  }, []);

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updated_at' | 'name' | 'created_at'>('updated_at');
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const clearCreateQuery = useCallback(() => {
    if (searchParams.get('create') === '1') {
      router.replace('/pc', { scroll: false });
    }
  }, [router, searchParams]);

  const handleCloseCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    clearCreateQuery();
  }, [clearCreateQuery]);

  // /pc/upload 或 ?create=1 跳转时自动打开新建弹窗（需登录）
  useEffect(() => {
    if (searchParams.get('create') !== '1') return;
    if (hasAuth) {
      setCreateModalOpen(true);
      clearCreateQuery();
    } else {
      router.push('/login?redirect=/pc?create=1');
    }
  }, [searchParams, hasAuth, router, clearCreateQuery]);

  const handleCreateClick = useCallback(() => {
    if (!hasAuth) {
      router.push('/login?redirect=/pc?create=1');
      return;
    }
    setCreateModalOpen(true);
  }, [hasAuth, router]);

  const handleQuickTranslate = useCallback(() => {
    router.push(hasAuth ? '/pc/upload' : '/login?redirect=/pc/upload');
  }, [hasAuth, router]);

  // ===== React Query 数据获取 =====
  const { data: projects = [], isLoading: loading, error, refetch } = useProjects({ sort_by: sortBy });

  // P1 修复: 水合完成后主动触发数据刷新，确保"已登录但无数据"的场景被修复
  // 场景：直接访问 /pc（cookie 有效）→ Zustand 水合前 Query disabled → 水合后需显式触发
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (authReady && hasAuth && !didInitialFetch.current) {
      didInitialFetch.current = true;
      const t = setTimeout(() => refetch(), 100);
      return () => clearTimeout(t);
    }
  }, [authReady, hasAuth, refetch]);

  // P1 安全网: hydration 异常时 800ms 后强制重试（缩短等待，符合 PRD 2s 页面加载）
  useEffect(() => {
    const t = setTimeout(() => {
      if (loading && hasAuth && !didInitialFetch.current) {
        didInitialFetch.current = true;
        refetch();
      }
    }, 800);
    return () => clearTimeout(t);
  }, [loading, hasAuth, refetch]);

  // ===== 删除项目（乐观更新） =====
  const deleteMutation = useOptimisticMutation(
    (projectId: string) => projectApi.delete(projectId),
    {
      queryKey: ['projects', 'list', { sort_by: sortBy }],
      onOptimisticUpdate: (oldData: ProjectData[] | undefined, projectId: string) =>
        (oldData || []).filter((p: ProjectData) => p.project_id !== projectId),
      onSuccess: () => message.success('已移入回收站'),
      onError: (err: Error) => message.error(err.message || '删除失败'),
    }
  );

  const handleDelete = useCallback(
    (projectId: string) => deleteMutation.mutate(projectId),
    [deleteMutation]
  );

  // ===== 收藏切换（乐观更新） =====
  const favMutation = useOptimisticMutation(
    ({ projectId, isFavorite }: { projectId: string; isFavorite: boolean }) =>
      projectApi.toggleFavorite(projectId, !isFavorite),
    {
      queryKey: ['projects', 'list', { sort_by: sortBy }],
      onOptimisticUpdate: (oldData: ProjectData[] | undefined, variables) =>
        (oldData || []).map((p: ProjectData) =>
          p.project_id === variables.projectId ? { ...p, is_favorite: !variables.isFavorite } : p
        ),
    }
  );

  const handleToggleFavorite = useCallback(
    (projectId: string, isFavorite: boolean) =>
      favMutation.mutate({ projectId, isFavorite }),
    [favMutation]
  );

  // ===== 客户端过滤 =====
  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ===== 排序选项 =====
  const sortOptions = [
    { key: 'updated_at', label: '更新时间' },
    { key: 'name', label: '名称' },
    { key: 'created_at', label: '创建时间' },
  ];

  // 访客态：无需等待 API，直接展示引导 UI（NEW-BUG-002）
  if (!hasAuth) {
    return (
      <div className="h-full overflow-y-auto" data-testid="guest-guide-page">
        <div className="max-w-xl mx-auto px-6 py-20 text-center">
          <div className="relative inline-flex">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-400 via-blue-500 to-violet-500 mb-6 shadow-lg shadow-primary-500/25">
              <Image size={36} className="text-white/80" />
            </div>
            <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md animate-float">
              <Sparkles size={12} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3 tracking-tight">
            漫画翻译工作台
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed mb-10">
            登录后即可上传漫画、管理作品并使用 AI 翻译功能
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/login?redirect=/pc" className="btn-primary py-3 px-8 text-base">
              <LogIn size={18} />
              登录
            </Link>
            <Link href="/register" className="btn-secondary py-3 px-8 text-base">
              注册账号
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 已登录但 auth store 尚未就绪：短暂骨架屏（最多 500ms 后 authReady 兜底）
  if (!authReady) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Skeleton active />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 顶部操作栏 */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex-shrink-0">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text">
                我的作品
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                {loading
                  ? '加载中...'
                  : error
                    ? '加载失败，请检查网络或稍后重试'
                    : `共 ${projects.length} 个作品项目`}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* 搜索 - 更精致的样式 */}
              <div className="relative group">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary-500 transition-colors" />
                <input
                  type="text"
                  placeholder="搜索作品..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input-field pl-10 pr-4 py-2.5 w-56 text-sm rounded-2xl"
                />
                {/* 聚焦时的装饰 */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary-500/5 to-accent-500/5 opacity-0 focus-within:opacity-100 transition-opacity duration-300 pointer-events-none" />
              </div>

              {/* 视图切换 - 更精致的样式 */}
              <div className="flex bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-1 shadow-sm">
                <button
                  onClick={() => setViewMode('grid')}
                  className={clsx(
                    'p-2 rounded-xl transition-all duration-300',
                    viewMode === 'grid'
                      ? 'bg-white dark:bg-slate-700 shadow-md text-primary-600 dark:text-primary-400 shadow-slate-200/50 dark:shadow-slate-900/50'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-white/50 dark:hover:bg-slate-700/50'
                  )}
                  title="网格视图"
                >
                  <Grid3X3 size={16} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={clsx(
                    'p-2 rounded-xl transition-all duration-300',
                    viewMode === 'list'
                      ? 'bg-white dark:bg-slate-700 shadow-md text-primary-600 dark:text-primary-400 shadow-slate-200/50 dark:shadow-slate-900/50'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-white/50 dark:hover:bg-slate-700/50'
                  )}
                  title="列表视图"
                >
                  <List size={16} />
                </button>
              </div>

              {/* 排序 - 更精致的样式 */}
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm shadow-sm">
                <ArrowUpDown size={14} className="text-slate-400" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="text-sm bg-transparent border-none text-slate-600 dark:text-slate-300 cursor-pointer focus:outline-none font-medium min-w-[80px]"
                >
                  {sortOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 新建作品 - 更精致的按钮 */}
              <button
                className="btn-primary text-sm px-5 py-2.5 shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30"
                onClick={handleCreateClick}
              >
                <Plus size={18} />
                新建作品
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* 免费用户订阅引导 Banner - 更精致的样式 */}
        {user?.plan_type !== 'premium' && (
          <div className="mb-8 p-5 rounded-3xl bg-gradient-to-r from-amber-50 via-purple-50/60 to-blue-50 dark:from-amber-950/25 dark:via-purple-950/20 dark:to-blue-950/20 border border-amber-200/50 dark:border-amber-800/30 flex items-center justify-between gap-5 shadow-lg shadow-amber-500/5 dark:shadow-amber-500/3 relative overflow-hidden">
            {/* 装饰性背景渐变 */}
            <div className="absolute inset-0 bg-gradient-to-r from-amber-100/20 via-transparent to-purple-100/20 dark:from-amber-900/10 dark:to-purple-900/10 opacity-50" />
            <div className="flex items-center gap-4 relative">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/30 dark:shadow-amber-500/20 animate-float">
                <Crown size={24} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                  升级高级版，解锁无限翻译
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  当前为免费版：每日 10 页、最多 10 个作品。高级版 ¥29/月起，畅享全部 AI 能力。
                </p>
              </div>
            </div>
            <button
              onClick={() => router.push('/pc/plans')}
              className="flex-shrink-0 px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white text-sm font-semibold transition-all duration-300 shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/30 hover:translate-y-(-2px) relative overflow-hidden group"
            >
              <span className="relative z-10">立即升级</span>
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 translate-x-(-100%) group-hover:translate-x-(100%) transition-transform duration-700" />
            </button>
          </div>
        )}

        {/* 快速操作卡片 - Bento Grid 风格 - 更精致的视觉效果 */}
        <div className="mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-5">
            {/* 上传漫画 */}
            <div
              role="button"
              tabIndex={0}
              className="glass-card p-6 cursor-pointer group relative overflow-hidden"
              onClick={handleCreateClick}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateClick()}
            >
              {/* 悬停时的渐变背景 */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary-50/50 via-blue-50/30 to-transparent dark:from-primary-950/20 dark:via-blue-950/10 dark:to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500" />
              {/* 装饰性渐变边框 */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary-400/20 via-blue-400/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ padding: '1px' }} />
              <div className="relative flex items-start gap-5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 dark:from-primary-500 dark:to-primary-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary-500/25 group-hover:shadow-xl group-hover:shadow-primary-500/30 group-hover:scale-110 transition-all duration-300">
                  <Upload size={24} className="text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                    上传漫画
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                    支持 JPG/PNG/CBZ/ZIP/PDF 格式
                  </p>
                  <div className="mt-3 flex items-center gap-1 text-xs text-primary-500 dark:text-primary-400 font-medium opacity-0 group-hover:opacity-100 transition-all duration-300 -translate-x-2 group-hover:translate-x-0">
                    <span>开始上传</span>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="transition-transform duration-300 group-hover:translate-x-1">
                      <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* 快速翻译 */}
            <div
              role="button"
              tabIndex={0}
              className="glass-card p-6 cursor-pointer group relative overflow-hidden"
              onClick={handleQuickTranslate}
              onKeyDown={(e) => e.key === 'Enter' && handleQuickTranslate()}
            >
              {/* 悬停时的渐变背景 */}
              <div className="absolute inset-0 bg-gradient-to-br from-accent-50/50 via-orange-50/30 to-transparent dark:from-amber-950/20 dark:via-orange-950/10 dark:to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500" />
              {/* 装饰性渐变边框 */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-accent-400/20 via-orange-400/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ padding: '1px' }} />
              <div className="relative flex items-start gap-5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-400 to-accent-500 dark:from-accent-500 dark:to-accent-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-accent-500/25 group-hover:shadow-xl group-hover:shadow-accent-500/30 group-hover:scale-110 transition-all duration-300">
                  <Languages size={24} className="text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">
                    快速翻译
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                    拍照或选图，一键翻译导出
                  </p>
                  <div className="mt-3 flex items-center gap-1 text-xs text-accent-500 dark:text-accent-400 font-medium opacity-0 group-hover:opacity-100 transition-all duration-300 -translate-x-2 group-hover:translate-x-0">
                    <span>立即翻译</span>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="transition-transform duration-300 group-hover:translate-x-1">
                      <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 加载状态 - 更精致的骨架屏 */}
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* 错误状态 - 更精致的样式 */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-32 text-slate-400 dark:text-slate-500">
            <div className="w-20 h-20 rounded-3xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-6 shadow-lg shadow-red-500/10 dark:shadow-red-500/5">
              <AlertCircle size={36} className="text-red-400" />
            </div>
            <p className="text-xl font-bold text-slate-700 dark:text-slate-300">
              加载失败
            </p>
            <p className="text-sm mt-2 text-slate-400 dark:text-slate-500 max-w-sm text-center leading-relaxed">
              {error instanceof Error ? error.message : String(error || '未知错误')}
            </p>
            {hasAuth && (
              <button className="btn-primary mt-8 px-6" onClick={() => refetch()}>
                <RefreshCw size={16} />
                重试
              </button>
            )}
          </div>
        )}

        {/* 项目列表 */}
        {!loading && !error && (
          <>
            {filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32">
                {/* 更精致的空状态 */}
                <div className="relative mb-8">
                  <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center shadow-lg">
                    <Image size={40} className="text-slate-300 dark:text-slate-600" />
                  </div>
                  {/* 装饰性圆环 */}
                  <div className="absolute inset-0 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 animate-spin-slow" style={{ animationDuration: '20s' }} />
                </div>
                <p className="text-xl font-bold text-slate-600 dark:text-slate-400 mb-2">
                  {searchQuery ? '没有匹配的作品' : '还没有作品'}
                </p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mb-8 text-center max-w-sm leading-relaxed">
                  {searchQuery
                    ? '试试其他关键词'
                    : '上传你的第一个漫画，开始 AI 翻译之旅'}
                </p>
                {!searchQuery && (
                  <button
                    className="btn-primary px-8 py-3 text-base"
                    onClick={handleCreateClick}
                  >
                    <Upload size={18} />
                    上传漫画
                  </button>
                )}
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {filteredProjects.map((project) => (
                  <ProjectCard
                    key={project.project_id}
                    project={project}
                    onDelete={handleDelete}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2 animate-stagger">
                {filteredProjects.map((project) => (
                  <div
                    key={project.project_id}
                    className="glass-card group flex items-center gap-4 p-4 cursor-pointer"
                  >
                    <Link
                      href={`/pc/projects/${project.project_id}`}
                      className="flex items-center gap-4 flex-1 min-w-0"
                    >
                    {resolveProcessedImageUrl(project.cover_url) ? (
                      <img
                        src={resolveProcessedImageUrl(project.cover_url)!}
                        alt={project.name}
                        className="w-12 h-16 rounded-lg object-cover flex-shrink-0 shadow-sm group-hover:shadow-md transition-shadow"
                      />
                    ) : (
                      <div className="w-12 h-16 rounded-lg bg-gradient-to-br from-primary-400 via-violet-400 to-rose-400 flex-shrink-0 shadow-sm group-hover:shadow-md transition-shadow" />
                    )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-slate-900 dark:text-white truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                          {project.name}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {LANG_LABELS[project.source_lang]} · {project.completed_count || 0}/{project.page_count || 0} 页 · {formatTime(project.updated_at)}
                        </p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-2">
                      {project.is_favorite && (
                        <Star size={15} className="text-yellow-400 fill-yellow-400" />
                      )}
                      <Popconfirm
                        title="确定要删除吗？"
                        onConfirm={() => handleDelete(project.project_id)}
                        okText="确定"
                        cancelText="取消"
                      >
                        <button className="btn-ghost p-1.5 text-slate-400 hover:text-red-500 rounded-lg">
                          <Trash2 size={15} />
                        </button>
                      </Popconfirm>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 新建作品 Modal */}
      <CreateProjectModal
        open={createModalOpen}
        onClose={handleCloseCreateModal}
        onCreated={() => refetch()}
      />
    </div>
  );
}
