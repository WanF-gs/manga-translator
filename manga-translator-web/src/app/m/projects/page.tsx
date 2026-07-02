'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Spin, message, Modal, Input } from 'antd';
import {
  Plus,
  Search,
  Star,
  Clock,
  CheckCircle2,
  Image,
  Play,
  AlertCircle,
  RefreshCw,
  Edit3,
  Monitor,
} from 'lucide-react';
import clsx from 'clsx';
import { useProjects, useGenericMutation } from '@/hooks/useApiQueries';
import { queryKeys } from '@/hooks/useApiQueries';
import { projectApi } from '@/services/project';
import type { ProjectData } from '@/types';
import { ContinueOnPC } from '@/components/common/ContinueOnPC';

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

export default function MobileProjectsPage() {
  // P0: 迁移到 React Query
  const { data: projects = [], isLoading: loading, isError, error: queryError, refetch } = useProjects();
  const [searchQuery, setSearchQuery] = useState('');
  // 轻量编辑弹窗
  const [editProject, setEditProject] = useState<ProjectData | null>(null);
  const [editName, setEditName] = useState('');
  // 删除确认
  const [deleteProject, setDeleteProject] = useState<ProjectData | null>(null);

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
          message.success('已更新');
          setEditProject(null);
        },
        onError: (err: any) => {
          message.error(err?.message || '更新失败');
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
        message.success('已移至回收站');
        setDeleteProject(null);
      },
      onError: (err: any) => {
        message.error(err?.message || '删除失败');
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
            <Image size={64} className="mb-4 opacity-50" />
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
                    href={`/pc/projects/${project.project_id}`}
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
                    href={`/pc/projects/${project.project_id}`}
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
                    <button
                      onClick={() => handleOpenEdit(project)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                      title="重命名"
                    >
                      <Edit3 size={14} />
                    </button>
                    <ContinueOnPC
                      triggerText=""
                      targetUrl={`/pc/projects/${project.project_id}`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
          <p className="text-xs text-slate-400 mt-2">
            如需进行文字编辑、样式调整等操作，请在电脑端打开编辑器
          </p>
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
