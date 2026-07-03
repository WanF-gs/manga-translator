'use client';

import React, { useState, useCallback } from 'react';

import Link from 'next/link';
import { Spin, Modal, Input } from 'antd';

import {
  Plus,
  Search,
  Star,
  Image as ImageIcon,
  AlertCircle,
  RefreshCw,
  Edit3,
  Monitor,
  Upload,
  Trash2,
  X,
} from 'lucide-react';




import clsx from 'clsx';
import { useProjects, useGenericMutation } from '@/hooks/useApiQueries';
import { queryKeys } from '@/hooks/useApiQueries';
import { projectApi } from '@/services/project';
import { pageApi } from '@/services/page';
import type { ProjectData, CreateProjectParams, SourceLang } from '@/types';
import { ContinueOnPC } from '@/components/common/ContinueOnPC';
import { App, Progress, Modal as AntModal } from 'antd';


const LANG_FLAGS: Record<string, string> = {
  ja: '🇯🇵',
  zh: '🇨🇳',
  en: '🇺🇸',
  ko: '🇰🇷',
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
}

const LANG_OPTIONS: { value: SourceLang; label: string }[] = [
  { value: 'ja', label: '🇯🇵 日文' },
  { value: 'zh', label: '🇨🇳 中文' },
  { value: 'en', label: '🇺🇸 英文' },
  { value: 'ko', label: '🇰🇷 韩文' },
];

const TARGET_LANG_OPTIONS = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
];

export default function MobileProjectsPage() {
  const { message: antMessage } = App.useApp();
  // P0: 迁移到 React Query
  const { data: projects = [], isLoading: loading, isError, error: queryError, refetch } = useProjects();
  const [searchQuery, setSearchQuery] = useState('');
  // 轻量编辑弹窗
  const [editProject, setEditProject] = useState<ProjectData | null>(null);
  const [editName, setEditName] = useState('');
  // 删除确认
  const [deleteProject, setDeleteProject] = useState<ProjectData | null>(null);

  // 新建作品 / 上传
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [sourceLang, setSourceLang] = useState<SourceLang>('ja');
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);


  // P0: 使用 React Query mutation 管理重命名（带缓存失效）
  const renameMutation = useGenericMutation<unknown, { projectId: string; name: string }>({
    mutationFn: ({ projectId, name }) => projectApi.update(projectId, { name } as any),
    invalidateKeys: [queryKeys.projects.list()],
  });

  // P0: 使用 React Query mutation 管理删除（带缓存失效）
  const deleteMutation = useGenericMutation<unknown, string>({
    mutationFn: (projectId) => projectApi.delete(projectId),
    invalidateKeys: [queryKeys.projects.list()],
  });

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ===== 新建作品 + 上传 =====
  const handleCreateProject = useCallback(async () => {
    if (!createName.trim()) {
      antMessage.warning('请输入作品名称');
      return;
    }
    setCreating(true);
    setUploadProgress(0);
    try {
      const projectRes = await projectApi.create({
        name: createName.trim(),
        source_lang: sourceLang,
        default_target_lang: targetLang,
      } as CreateProjectParams);
      const projectId = (projectRes.data as any).data?.project_id || (projectRes.data as any).project_id;
      if (!projectId) throw new Error('创建作品失败');

      let firstPageId: string | undefined;

      if (files.length > 0) {
        const chapterRes = await projectApi.createChapter(projectId, { name: '第1话' });
        const chapterId = (chapterRes.data as any).data?.chapter_id || (chapterRes.data as any).chapter_id;
        if (!chapterId) throw new Error('创建章节失败');

        const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif'];
        const archiveFiles = files.filter((f) => {
          const ext = '.' + f.name.split('.').pop()?.toLowerCase();
          return ['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.pdf'].includes(ext);
        });
        const imageFiles = files.filter((f) => {
          const ext = '.' + f.name.split('.').pop()?.toLowerCase();
          return IMAGE_EXTS.includes(ext);
        });

        if (imageFiles.length > 0) {
          const formData = new FormData();
          imageFiles.forEach((f) => formData.append('files', f));
          const uploadRes = await pageApi.upload(chapterId, formData, (pct) => setUploadProgress(pct));
          const pages = (uploadRes.data as any).data?.pages || [];
          firstPageId = pages[0]?.page_id;
        }

        for (const archive of archiveFiles) {
          const formData = new FormData();
          formData.append('file', archive);
          const archiveRes = await pageApi.uploadArchive(chapterId, formData, (pct) => setUploadProgress(pct));
          if (!firstPageId) {
            const pages = (archiveRes.data as any).data?.pages || [];
            firstPageId = pages[0]?.page_id;
          }
        }
      }

      antMessage.success('创建成功');
      setCreateOpen(false);
      setCreateName('');
      setFiles([]);
      refetch();
      const query = firstPageId ? `?page=${firstPageId}` : '';
      window.location.href = `/m/projects/${projectId}/edit${query}`;
    } catch (err: any) {
      antMessage.error(err?.message || '创建失败');
    } finally {
      setCreating(false);
      setUploadProgress(0);
    }
  }, [createName, sourceLang, targetLang, files, antMessage, refetch]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files).slice(0, 50);
      setFiles((prev) => [...prev, ...selected].slice(0, 50));
      e.target.value = '';
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // ===== 轻量编辑：重命名 =====

  const handleOpenEdit = (project: ProjectData) => {
    setEditProject(project);
    setEditName(project.name);
  };

  const handleSaveEdit = async () => {
    if (!editProject || !editName.trim()) return;
    renameMutation.mutate(
      { projectId: editProject.project_id, name: editName.trim() },
      {
        onSuccess: () => {
          antMessage.success('已更新');
          setEditProject(null);
        },
        onError: (err: any) => {
          antMessage.error(err?.message || '更新失败');
        },

      }
    );
  };

  // ===== 轻量编辑：删除 =====
  const handleOpenDelete = (project: ProjectData) => {
    setDeleteProject(project);
  };

  const handleConfirmDelete = () => {
    if (!deleteProject) return;
    deleteMutation.mutate(deleteProject.project_id, {
      onSuccess: () => {
        antMessage.success('已移至回收站');
        setDeleteProject(null);
      },
      onError: (err: any) => {
        antMessage.error(err?.message || '删除失败');
      },
    });

  };

  return (
    <div className="pb-4 min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* 顶部 */}
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <h1 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
          我的作品
        </h1>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="搜索作品..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* 内容 */}
      <div className="px-4 mt-4">
        {loading && (
          <div className="flex justify-center py-20">
            <Spin size="large" />
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center py-20 gap-4">
            <AlertCircle size={48} className="text-red-400" />
            <p className="text-slate-500">{queryError?.message || '加载失败'}</p>
            <button onClick={() => refetch()} className="btn-primary text-sm">
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        )}

        {!loading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center py-20 text-slate-400">
            <ImageIcon size={64} className="mb-4 opacity-50" />

            <p className="text-lg font-medium">
              {searchQuery ? '没有匹配的作品' : '还没有作品'}
            </p>
            <p className="text-sm mt-1">
              {searchQuery ? '试试其他关键词' : '去首页上传你的第一个漫画'}
            </p>
          </div>
        )}

        {!loading && !isError && (
          <div className="space-y-3">
            {filtered.map((project) => {
              const progress = project.page_count
                ? (project.completed_count || 0) / project.page_count
                : 0;
              return (
                <div
                  key={project.project_id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700"
                >
                  {/* 封面 */}
                  <Link
                    href={`/m/projects/${project.project_id}/edit`}
                    className="w-14 h-20 rounded-lg bg-gradient-to-br from-primary-400 to-purple-400 flex-shrink-0 flex items-center justify-center relative overflow-hidden active:scale-[0.98] transition-transform"
                  >
                    <span className="text-2xl">
                      {LANG_FLAGS[project.source_lang] || '📖'}
                    </span>
                    <svg className="absolute inset-0 w-full h-full -rotate-90">
                      <circle
                        cx="28" cy="40" r="22"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        className={progress >= 1 ? 'text-green-400' : 'text-primary-400'}
                        strokeDasharray={`${progress * 138} 138`}
                        strokeLinecap="round"
                        opacity={0.6}
                      />
                    </svg>
                  </Link>

                  {/* 信息 */}
                  <Link
                    href={`/m/projects/${project.project_id}/edit`}
                    className="flex-1 min-w-0"
                  >

                    <div className="flex items-center gap-1">
                      <h3 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {project.name}
                      </h3>
                      {project.is_favorite && (
                        <Star size={12} className="text-yellow-400 fill-yellow-400 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {project.completed_count || 0}/{project.page_count || 0} 页 · {formatTime(project.updated_at)}
                    </p>
                    <div className="mt-1.5 w-full h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={clsx(
                          'h-full rounded-full transition-all',
                          progress >= 1 ? 'bg-green-500' : 'bg-primary-500'
                        )}
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                  </Link>

                  {/* 操作按钮 */}
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <Link
                      href={`/m/projects/${project.project_id}/edit`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                      title="编辑"
                    >
                      <Edit3 size={14} />
                    </Link>
                    <button
                      onClick={() => handleOpenEdit(project)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                      title="重命名"
                    >
                      <Monitor size={14} />
                    </button>
                    <button
                      onClick={() => handleOpenDelete(project)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>

                  </div>


                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 新建作品浮动按钮 */}
      <button
        onClick={() => setCreateOpen(true)}
        className="fixed bottom-20 right-4 z-20 w-14 h-14 rounded-full bg-primary-500 shadow-lg shadow-primary-500/30 flex items-center justify-center active:scale-95 transition-transform"
      >
        <Plus size={28} className="text-white" />
      </button>

      {/* ===== 新建作品弹窗 ===== */}
      <AntModal
        title="新建作品"
        open={createOpen}
        onOk={handleCreateProject}
        onCancel={() => {
          if (!creating) {
            setCreateOpen(false);
            setFiles([]);
            setCreateName('');
          }
        }}
        confirmLoading={creating}
        okText={files.length > 0 ? '创建并上传' : '创建空项目'}
        cancelText={creating ? '取消' : '关闭'}
        centered
        width={360}
      >
        <div className="py-2 space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">作品名称</label>
            <Input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="例如：海贼王 第1088话"
              maxLength={100}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">源语言</label>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value as SourceLang)}
              className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
            >
              {LANG_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">目标语言</label>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
            >
              {TARGET_LANG_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              上传漫画 <span className="text-slate-300 font-normal">（可选）</span>
            </label>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-6 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg flex flex-col items-center gap-1 text-slate-400 hover:border-primary-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Upload size={24} />
              <span className="text-xs">点击选择图片/压缩包/PDF</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.cbz,.zip,.rar,.7z,.pdf"
              className="hidden"
              onChange={handleFileSelect}
            />
            {files.length > 0 && (
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-800 rounded text-xs">
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-slate-400">{formatSize(f.size)}</span>
                    <button
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="p-0.5 text-slate-400 hover:text-red-500"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {creating && uploadProgress > 0 && (
              <div className="mt-2">
                <Progress percent={uploadProgress} status="active" size="small" />
                <p className="text-xs text-slate-400 mt-1">正在上传 {uploadProgress}%</p>
              </div>
            )}
          </div>
        </div>
      </AntModal>

      {/* ===== 重命名弹窗 ===== */}
      <Modal
        title="重命名作品"
        open={!!editProject}
        onOk={handleSaveEdit}
        onCancel={() => setEditProject(null)}
        confirmLoading={renameMutation.isPending}
        okText="保存"
        cancelText="取消"
        centered
      >
        <div className="py-2">
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="输入新名称"
            maxLength={100}
            autoFocus
          />
          {editProject && (
            <div className="mt-3">
              <ContinueOnPC
                targetUrl={`/pc/projects/${editProject.project_id}`}
              />
            </div>
          )}
        </div>
      </Modal>


      {/* ===== 删除确认弹窗 ===== */}
      <Modal
        title="删除作品"
        open={!!deleteProject}
        onOk={handleConfirmDelete}
        onCancel={() => setDeleteProject(null)}
        confirmLoading={deleteMutation.isPending}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        centered
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          确定要删除作品「{deleteProject?.name}」吗？
        </p>
        <p className="text-xs text-slate-400 mt-1">
          删除后可在30天内从回收站恢复
        </p>
      </Modal>
    </div>
  );
}
