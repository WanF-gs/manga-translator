'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Spin } from 'antd';
import {
  Upload,
  Camera,
  Image,
  Languages,
  ChevronRight,
  Play,
  Plus,
  AlertCircle,
  RefreshCw,
  Wifi,
} from 'lucide-react';
import clsx from 'clsx';
import { useProjects } from '@/hooks/useApiQueries';
import { useQueryState } from '@/hooks/useQueryState';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { ProgressiveImage } from '@/components/common/ProgressiveImage';
import { resolveProcessedImageUrl } from '@/utils/pageImage';
import { useAuthStore } from '@/stores/authStore';
import type { ProjectData } from '@/types';

const PAGE_COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444'];

const LANG_FLAGS: Record<string, string> = {
  ja: '🇯🇵', zh: '🇨🇳', en: '🇺🇸', ko: '🇰🇷',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString();
}

interface ProjectCardData {
  project_id: string;
  name: string;
  source_lang: string;
  completed_pages: number;
  total_pages: number;
  updated_at: string;
  color: string;
}

export default function MobileHomePage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isHydrated = useAuthStore((s) => s._hydrated);

  const hasAuth = isAuthenticated || !!accessToken;

  // React Query 数据获取
  const { data: rawProjects = [], isLoading: loading, error, refetch } = useProjects({
    page: 1,
    page_size: 10,
    sort_by: 'updated_at',
  });

  // P1 修复: 水合完成后主动触发数据刷新
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (isHydrated && hasAuth && !didInitialFetch.current) {
      didInitialFetch.current = true;
      const t = setTimeout(() => refetch(), 100);
      return () => clearTimeout(t);
    }
  }, [isHydrated, hasAuth, refetch]);

  // P1 安全网: 如果 2 秒后仍在 loading 且已认证，说明 hydration 可能异常，强制重试
  useEffect(() => {
    const t = setTimeout(() => {
      if (loading && hasAuth && !didInitialFetch.current) {
        console.warn('[m/page] 安全网触发: 2秒后仍在loading，强制refetch');
        didInitialFetch.current = true;
        refetch();
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [loading, hasAuth, refetch]);

  const { isSlow } = useNetworkStatus();

  // 转换为卡片数据
  const projects: ProjectCardData[] = (rawProjects as ProjectData[])
    .slice(0, 5)
    .map((p: any, idx: number) => ({
      project_id: p.project_id,
      name: p.name,
      source_lang: p.source_lang || 'ja',
      completed_pages: p.completed_pages || 0,
      total_pages: p.total_pages || p.page_count || 0,
      updated_at: p.updated_at || p.created_at || '',
      color: PAGE_COLORS[idx % PAGE_COLORS.length],
    }));

  return (
    <div className="pb-4">
      {/* ===== 顶部标题栏 ===== */}
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center">
              <Languages size={18} className="text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Manga TL
            </h1>
          </div>
          <Link
            href="/m/me"
            className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center"
          >
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              漫
            </span>
          </Link>
        </div>
      </div>

      {/* ===== 快速操作区 ===== */}
      <div className="px-4 mt-4">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-3">
          快速操作
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Link
            href="/m/quick-translate?mode=camera"
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
              <Camera size={24} className="text-primary-600 dark:text-primary-400" />
            </div>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">拍照翻译</span>
          </Link>
          <Link
            href="/m/quick-translate?mode=gallery"
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 rounded-full bg-accent-50 dark:bg-orange-900/30 flex items-center justify-center">
              <Image size={24} className="text-accent-500" />
            </div>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">选图翻译</span>
          </Link>
          <Link
            href="/m/projects?action=upload"
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 rounded-full bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
              <Upload size={24} className="text-purple-600 dark:text-purple-400" />
            </div>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">上传文件</span>
          </Link>
        </div>
      </div>

      {/* ===== 最近项目 / 游客引导 ===== */}
      <div className="px-4 mt-6">
        {!hasAuth && isHydrated ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-center">
            <Languages size={40} className="text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">登录后查看项目</p>
            <p className="text-xs text-slate-400 mb-4">登录即可同步 PC 端作品，在手机上继续翻译</p>
            <div className="flex gap-3">
              <Link href="/login?redirect=/m" className="btn-primary py-2 px-5 text-sm">
                登录
              </Link>
              <Link href="/register" className="btn-ghost py-2 px-5 text-sm border border-slate-200 dark:border-slate-700">
                注册
              </Link>
            </div>
          </div>
        ) : (
        <>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">最近项目</h2>
          <Link href="/m/projects" className="text-xs text-primary-500 flex items-center gap-0.5">
            查看全部 <ChevronRight size={14} />
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Spin size="default" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <AlertCircle size={24} className="text-red-400" />
            <p className="text-xs text-slate-400">{(error as any)?.message || '加载失败'}</p>
            {isAuthenticated && (
              <button onClick={() => refetch()} className="text-xs text-primary-500 flex items-center gap-1">
                <RefreshCw size={12} /> 重试
              </button>
            )}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-slate-400">
            <p className="text-xs">暂无项目</p>
            <Link href="/m/quick-translate" className="text-xs text-primary-500 mt-1">
              开始翻译第一个漫画
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((project) => {
              const total = project.total_pages || 1;
              const progress = Math.min(1, project.completed_pages / total);
              const isCompleted = project.completed_pages >= total && total > 0;
              return (
                <Link
                  key={project.project_id}
                  href={`/m/reader/${project.project_id}`}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 active:scale-[0.98] transition-transform"
                >
                  <ProgressiveImage
                    src={resolveProcessedImageUrl((project as any).cover_url) || ''}
                    alt={project.name}
                    aspectRatio="14/20"
                    className="w-14 h-20 rounded-lg flex-shrink-0"
                    forceLowQuality={isSlow}
                    lazy={true}
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-slate-900 dark:text-white truncate">{project.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {project.completed_pages}/{total} 页 · {timeAgo(project.updated_at)}
                    </p>
                    <div className="mt-1.5 w-full h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full transition-all', isCompleted ? 'bg-green-500' : 'bg-primary-500')}
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
                    <Play size={14} className="text-primary-600 dark:text-primary-400" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        </>
        )}
      </div>

      {/* ===== 快速翻译浮动按钮 ===== */}
      <div className="fixed bottom-20 right-4 z-20">
        <Link
          href="/m/quick-translate"
          className="w-14 h-14 rounded-full bg-primary-500 shadow-lg shadow-primary-500/30 flex items-center justify-center active:scale-95 transition-transform"
        >
          <Plus size={28} className="text-white" />
        </Link>
      </div>
    </div>
  );
}
