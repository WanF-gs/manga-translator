'use client';

import React, { useState, useMemo } from 'react';
import clsx from 'clsx';
import { PanelLeft, ChevronDown, ChevronRight, CheckCircle2, Loader2, AlertCircle, Clock, Filter, ImageIcon } from 'lucide-react';
import type { ChapterSummary, PageThumbnail } from './types';
import { PAGE_STATUS_CONFIGS } from './types';
import type { PageStatus } from '@/types';

interface SidebarProps {
  chapters: ChapterSummary[];
  currentPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onTogglePanel: () => void;
}

/** 单页缩略图 */
function ThumbnailItem({
  page,
  isActive,
  onSelect,
  showStatusBar = true,
}: {
  page: PageThumbnail;
  isActive: boolean;
  onSelect: () => void;
  showStatusBar?: boolean;
}) {
  const statusConfig = PAGE_STATUS_CONFIGS[page.status];
  const statusColors: Record<PageStatus, { dot: string; badge: string }> = {
    pending: { dot: 'bg-slate-400', badge: 'bg-slate-400 text-white' },
    translating: { dot: 'bg-blue-500', badge: 'bg-blue-500 text-white' },
    reviewed: { dot: 'bg-amber-500', badge: 'bg-amber-500 text-white' },
    completed: { dot: 'bg-green-500', badge: 'bg-green-500 text-white' },
  };
  const sc = statusColors[page.status] || statusColors.pending;

  // 构造缩略图 URL（通过后端按需渲染，zoom=0.3 低分辨率，适合侧边栏缩略图）
  const thumbSrc = `/api/v1/pages/${page.page_id}/image?zoom=0.3`;
  const [thumbLoaded, setThumbLoaded] = React.useState(false);
  const [thumbError, setThumbError] = React.useState(false);

  // 页面切换时重置状态
  React.useEffect(() => {
    setThumbLoaded(false);
    setThumbError(false);
  }, [page.page_id]);

  return (
    <button
      onClick={onSelect}
      className={clsx(
        'w-full text-left p-2 rounded-lg transition-all duration-200 group relative',
        isActive
          ? 'ring-2 ring-primary-500 bg-primary-50/50 dark:bg-primary-900/20 scale-[1.02]'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800'
      )}
    >
      {/* 缩略图 */}
      <div
        className="w-full aspect-[3/4] rounded-md mb-1.5 flex items-center justify-center relative overflow-hidden"
        style={{ backgroundColor: page.thumbnail_color + '20' }}
      >
        {/* 真实缩略图（懒加载，失败时回退到占位符） */}
        {!thumbError && (
          <img
            src={thumbSrc}
            alt={`第${page.sort_order}页`}
            loading="lazy"
            className={clsx(
              'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
              thumbLoaded ? 'opacity-100' : 'opacity-0'
            )}
            onLoad={() => setThumbLoaded(true)}
            onError={() => setThumbError(true)}
          />
        )}

        {/* 占位（图片未加载或失败时显示） */}
        {(!thumbLoaded || thumbError) && (
          <>
            {thumbError ? (
              <ImageIcon className="opacity-20" size={20} style={{ color: page.thumbnail_color }} />
            ) : (
              <span
                className="text-2xl font-bold opacity-30 select-none"
                style={{ color: page.thumbnail_color }}
              >
                {page.sort_order}
              </span>
            )}
          </>
        )}

        {/* 状态角标 */}
        <span className={clsx(
          'absolute top-0 right-0 w-5 h-5 rounded-bl-md flex items-center justify-center z-10',
          sc.badge
        )}>
          <span className="text-[8px] font-bold">
            {page.status === 'completed' && '✓'}
            {page.status === 'translating' && '↻'}
            {page.status === 'reviewed' && '!'}
            {page.status === 'pending' && '·'}
          </span>
        </span>

        {/* 状态圆点（左下角） */}
        <div className={clsx('absolute bottom-1.5 left-1.5 w-1.5 h-1.5 rounded-full z-10', sc.dot)} />
      </div>

      {/* 标签 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
          {page.label}
        </span>
        {isActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
        )}
      </div>

      {/* 底部状态条 */}
      {showStatusBar && (
        <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full overflow-hidden">
          <div
            className={clsx('h-full transition-all', sc.dot)}
            style={{ width: page.status === 'completed' ? '100%' : page.status === 'translating' ? '60%' : page.status === 'reviewed' ? '30%' : '10%' }}
          />
        </div>
      )}
    </button>
  );
}

/** 折叠的章节 */
function ChapterGroup({
  chapter,
  currentPageId,
  onSelectPage,
}: {
  chapter: ChapterSummary;
  currentPageId: string | null;
  onSelectPage: (pageId: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const completedCount = (chapter.pages || []).filter(p => p.status === 'completed').length;

  return (
    <div className="mb-1">
      {/* 章节标题 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="flex-1 text-left truncate">{chapter.name}</span>
        <span className="text-slate-400 font-normal">
          {completedCount}/{(chapter.pages || []).length}
        </span>
      </button>

      {expanded && (
        <div className="px-2 space-y-0.5">
          {(chapter.pages || []).map((page) => (
            <ThumbnailItem
              key={page.page_id}
              page={page}
              isActive={page.page_id === currentPageId}
              onSelect={() => onSelectPage(page.page_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 左侧边栏：章节列表 + 页面缩略图列表 */
export const Sidebar: React.FC<SidebarProps> = ({
  chapters,
  currentPageId,
  onSelectPage,
  onTogglePanel,
}) => {
  const [statusFilter, setStatusFilter] = useState<PageStatus | 'all'>('all');

  const filteredChapters = useMemo(() => {
    if (statusFilter === 'all') return chapters;
    return chapters.map((ch) => ({
      ...ch,
      pages: (ch.pages || []).filter((p) => p.status === statusFilter),
    })).filter((ch) => ch.pages.length > 0);
  }, [chapters, statusFilter]);

  const STATUS_FILTER_OPTIONS: { value: PageStatus | 'all'; label: string; color: string }[] = [
    { value: 'all', label: '全部', color: '#6B7280' },
    { value: 'pending', label: '待处理', color: '#94A3B8' },
    { value: 'translating', label: '翻译中', color: '#3B82F6' },
    { value: 'reviewed', label: '待审核', color: '#F59E0B' },
    { value: 'completed', label: '已完成', color: '#10B981' },
  ];

  return (
    <aside className="w-48 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col flex-shrink-0">
      {/* 头部 */}
      <div className="p-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-500">页面列表</span>
          <button
            onClick={onTogglePanel}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="收起面板"
          >
            <PanelLeft size={14} className="text-slate-400" />
          </button>
        </div>
        {/* 状态筛选 */}
        <div className="flex items-center gap-1 flex-wrap">
          <Filter size={10} className="text-slate-400 flex-shrink-0" />
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={clsx(
                'text-[10px] px-1.5 py-0.5 rounded-full transition-colors',
                statusFilter === opt.value
                  ? 'text-white font-medium'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              )}
              style={{
                backgroundColor: statusFilter === opt.value ? opt.color : 'transparent',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 页面列表 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredChapters.map((chapter) => (
          <ChapterGroup
            key={chapter.chapter_id}
            chapter={chapter}
            currentPageId={currentPageId}
            onSelectPage={onSelectPage}
          />
        ))}
      </div>
    </aside>
  );
};
