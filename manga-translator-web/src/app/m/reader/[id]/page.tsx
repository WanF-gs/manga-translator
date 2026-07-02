'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { Spin, message, Modal, Radio, Progress, Slider, Tooltip } from 'antd';
import {
  ArrowLeft,
  Globe,
  MessageCircle,
  Sun,
  Moon,
  Download,
  Bookmark,
  BookmarkCheck,
  RefreshCw,
  Volume2,
  VolumeX,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCw,
} from 'lucide-react';
import clsx from 'clsx';
import { projectApi } from '@/services/project';
import { pageApi } from '@/services/page';
import { exportApi } from '@/services/export';
import { readerApi } from '@/services/reader';
import { useAuthStore } from '@/stores/authStore';
import {
  useProjectDetail,
  useChapters,
  useReaderProgress,
  queryKeys,
} from '@/hooks/useApiQueries';
import type { ExportFormat } from '@/services/export';
import type { ProjectData, PageData } from '@/types';
import { PageRenderer } from '@/components/reader';
import type { DisplayMode } from '@/components/reader';
import { ContinueOnPC } from '@/components/common';

/** 为 PDF 按需渲染的 URL 添加合理缩放参数，避免加载超大原图 */
const withZoom = (url: string | undefined) => {
  if (!url) return undefined;
  if (url.startsWith('/api/v1/pages/') && url.includes('/image') && !url.includes('?')) {
    return url + '?zoom=0.5';
  }
  return url;
};

const PLACEHOLDER_IMAGE = (num: number) =>
  `https://picsum.photos/seed/mreader${num}/400/550`;

const BOOKMARK_KEY = 'manga_reader_bookmarks';

interface BookmarkData {
  pageNumber: number;
  timestamp: number;
}

function loadBookmarks(): Record<string, BookmarkData> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '{}'); } catch { return {}; }
}

function saveBookmark(projectId: string, data: BookmarkData) {
  if (typeof window === 'undefined') return;
  const all = loadBookmarks();
  all[projectId] = data;
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(all));
}

function removeBookmark(projectId: string) {
  if (typeof window === 'undefined') return;
  const all = loadBookmarks();
  delete all[projectId];
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(all));
}

const DISPLAY_LANG_MAP: Record<string, string> = {
  'zh-CN': 'zh-CN', ja: 'ja-JP', en: 'en-US', ko: 'ko-KR',
};

const pageColors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444'];

/** 判断是否为横屏 */
function useOrientation(): 'portrait' | 'landscape' {
  const [orient, setOrient] = useState<'portrait' | 'landscape'>(
    typeof window !== 'undefined' && window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
  );
  useEffect(() => {
    const handler = () => {
      setOrient(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    };
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, []);
  return orient;
}

export default function MobileReaderPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const orientation = useOrientation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // ===== P0-3: React Query 数据获取 =====
  const {
    data: projectData,
    isLoading: projectLoading,
  } = useProjectDetail(projectId);

  const {
    data: chaptersData = [],
    isLoading: chaptersLoading,
  } = useChapters(projectId);

  // 使用 useQueries 动态获取所有章节的页面
  const pagesQueries = useQueries({
    queries: chaptersData.map((ch) => ({
      queryKey: queryKeys.pages.list(ch.chapter_id),
      queryFn: async () => {
        const res = await pageApi.getList(ch.chapter_id);
        const raw = res.data?.data ?? res.data;
        return (Array.isArray(raw) ? raw : raw?.items || []) as PageData[];
      },
      enabled: !!chaptersData.length,
      staleTime: 30 * 1000,
    })),
  });
  const allPagesLoading = pagesQueries.some((q) => q.isLoading);

  const pages: PageData[] = useMemo(() => {
    const result: PageData[] = [];
    pagesQueries.forEach((q) => {
      if (q.data) {
        const enriched = q.data.map((p: any) => ({
          ...p,
          original_url: p.original_url || PLACEHOLDER_IMAGE(p.sort_order),
        }));
        result.push(...enriched);
      }
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesQueries.map((q) => q.data).join(',')]);

  const project: ProjectData | null = projectData || null;
  const loading = projectLoading || chaptersLoading || allPagesLoading;

  const [displayMode, setDisplayMode] = useState<DisplayMode>('translated');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  // 阅读器特有状态
  const [currentPage, setCurrentPage] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [fontScale, setFontScale] = useState(1.0);
  const [showControls, setShowControls] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P0-3: React Query 阅读进度
  const { data: readerProgress } = useReaderProgress(projectId);
  useEffect(() => {
    if (readerProgress && pages.length > 0) {
      const progress = (readerProgress as any)?.current_page;
      if (progress) {
        setCurrentPage(Math.min(progress - 1, pages.length - 1));
      }
    }
  }, [readerProgress, pages.length]);

  // 页面加载完成后恢复书签状态
  useEffect(() => {
    if (pages.length > 0 && projectId) {
      const bookmarks = loadBookmarks();
      setIsBookmarked(!!bookmarks[projectId]);
    }
  }, [pages.length, projectId]);

  // 自动保存进度
  useEffect(() => {
    if (!projectId || pages.length === 0) return;
    const timer = setInterval(async () => {
      try {
        await readerApi.saveProgress(projectId, currentPage + 1);
      } catch {
        localStorage.setItem(`reader_progress_${projectId}`, String(currentPage));
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [projectId, currentPage, pages.length]);

  // 离开时保存
  useEffect(() => {
    const handler = () => {
      if (projectId) {
        localStorage.setItem(`reader_progress_${projectId}`, String(currentPage));
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [projectId, currentPage]);

  // 控件自动隐藏
  useEffect(() => {
    if (showControls) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 5000);
    }
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [showControls]);

  // 循环显示模式
  const cycleDisplayMode = useCallback(() => {
    if (displayMode === 'translated') setDisplayMode('original');
    else if (displayMode === 'original') setDisplayMode('bilingual');
    else setDisplayMode('translated');
  }, [displayMode]);

  // 书签
  const handleBookmark = useCallback(() => {
    if (!projectId) return;
    if (isBookmarked) {
      removeBookmark(projectId);
      setIsBookmarked(false);
      message.success('已取消书签');
    } else {
      saveBookmark(projectId, { pageNumber: currentPage + 1, timestamp: Date.now() });
      setIsBookmarked(true);
      message.success(`已添加书签（第${currentPage + 1}页）`);
    }
  }, [projectId, isBookmarked, currentPage]);

  // 字号缩放
  const adjustFontScale = useCallback((delta: number) => {
    setFontScale((prev) => Math.min(2.0, Math.max(0.8, +(prev + delta).toFixed(1))));
  }, []);

  // 导出
  const handleExport = useCallback(() => {
    if (!projectId || pages.length === 0) return;

    Modal.confirm({
      title: '导出设置',
      width: 320,
      content: (
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">导出格式</label>
            <Radio.Group id="m-export-format-v2" defaultValue="cbz" className="flex flex-wrap gap-2">
              <Radio value="png">PNG</Radio>
              <Radio value="jpg">JPG</Radio>
              <Radio value="cbz">CBZ</Radio>
              <Radio value="pdf">PDF</Radio>
            </Radio.Group>
          </div>
        </div>
      ),
      okText: '导出全部',
      cancelText: '取消',
      onOk: async () => {
        const formatEl = document.querySelector<HTMLInputElement>('#m-export-format-v2 input:checked');
        const format = (formatEl?.value || 'cbz') as ExportFormat;

        setIsExporting(true);
        setExportProgress(0);
        message.loading({ content: '正在导出...', key: 'm-export', duration: 0 });

        try {
          const res = await exportApi.project(projectId, format);
          const taskData = res.data?.data;
          const taskId = taskData?.task_id;

          if (taskId) {
            let attempts = 0;
            const timer = setInterval(async () => {
              attempts++;
              try {
                const statusRes = await exportApi.getStatus(taskId);
                const s = statusRes.data?.data;
                setExportProgress(s?.progress || 0);
                if (s?.status === 'completed') {
                  clearInterval(timer);
                  if (s.output_url) {
                    exportApi.downloadFile(s.output_url, s.output_filename || `export_${taskId}`);
                  }
                  message.success({ content: '导出完成！', key: 'm-export' });
                  setIsExporting(false);
                  setExportProgress(null);
                } else if (s?.status === 'failed' || attempts > 120) {
                  clearInterval(timer);
                  message[s?.status === 'failed' ? 'error' : 'warning']({
                    content: s?.status === 'failed' ? '导出失败' : '导出超时',
                    key: 'm-export',
                  });
                  setIsExporting(false);
                  setExportProgress(null);
                }
              } catch {
                if (attempts > 120) {
                  clearInterval(timer);
                  setIsExporting(false);
                  setExportProgress(null);
                }
              }
            }, 5000);
          }
        } catch (err: any) {
          message.warning({
            content: err?.response?.status === 404 ? '导出服务暂不可用' : `导出失败: ${err?.message}`,
            key: 'm-export',
          });
          setIsExporting(false);
          setExportProgress(null);
        }
      },
    });
  }, [projectId, pages]);

  // TTS
  const [isTTSPlaying, setIsTTSPlaying] = useState(false);
  const [ttsSpeed, setTtsSpeed] = useState(1);

  const stopTTS = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsTTSPlaying(false);
  }, []);

  const startTTS = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsTTSPlaying(true);

    const allTexts: { text: string; lang: string }[] = [];
    const sourceLang = (project as any)?.source_lang || 'ja';

    pages.forEach((page) => {
      const regions = (page as any)?.regions || [];
      regions.forEach((r: any) => {
        const text = r.translated_text || r.original_text || '';
        if (text) {
          allTexts.push({ text, lang: DISPLAY_LANG_MAP[sourceLang] || 'ja-JP' });
        }
      });
    });

    if (allTexts.length === 0) {
      message.warning('无文字可朗读');
      setIsTTSPlaying(false);
      return;
    }

    let idx = 0;
    const speakNext = () => {
      if (idx >= allTexts.length) { setIsTTSPlaying(false); return; }
      const item = allTexts[idx];
      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = item.lang;
      u.rate = ttsSpeed;
      u.onend = () => { idx++; speakNext(); };
      u.onerror = () => { idx++; speakNext(); };
      window.speechSynthesis.speak(u);
    };
    speakNext();
  }, [pages, project, ttsSpeed]);

  const toggleTTS = useCallback(() => {
    if (isTTSPlaying) stopTTS();
    else startTTS();
  }, [isTTSPlaying, stopTTS, startTTS]);

  useEffect(() => () => { window.speechSynthesis.cancel(); }, []);

  // 滑动翻页（横屏模式）
  const touchStartRef = useRef({ x: 0, y: 0 });
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) setCurrentPage((p) => Math.min(pages.length - 1, p + 1));
      else setCurrentPage((p) => Math.max(0, p - 1));
    }
  }, [pages.length]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Spin size="large" />
      </div>
    );
  }

  const isLandscape = orientation === 'landscape';

  return (
    <div
      className={clsx(
        'min-h-screen flex flex-col',
        isDarkMode ? 'bg-slate-950 text-white' : 'bg-white text-slate-900'
      )}
      style={{ filter: `brightness(${brightness}%)` }}
      onClick={() => setShowControls((p) => !p)}
    >
      {/* 顶部控制栏 */}
      <div
        className={clsx(
          'fixed top-0 left-0 right-0 z-20 transition-transform duration-300',
          showControls ? 'translate-y-0' : '-translate-y-full'
        )}
      >
        <div className="bg-black/60 backdrop-blur-md px-3 py-2 flex items-center justify-between">
          <Link href="/m" className="p-1 text-white/80">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xs font-medium text-white truncate max-w-[180px]">
            {project?.name || '漫画阅读'}
          </h1>
          <div className="flex items-center gap-0.5">
            <Tooltip title={isBookmarked ? '取消书签' : '添加书签'}>
              <button onClick={handleBookmark} className="p-1.5">
                {isBookmarked ? (
                  <BookmarkCheck size={16} className="text-yellow-400" />
                ) : (
                  <Bookmark size={16} className="text-white/80" />
                )}
              </button>
            </Tooltip>
            <button onClick={cycleDisplayMode} className="p-1.5 text-white/80">
              <Globe size={16} />
            </button>
            <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-1.5 text-white/80">
              {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
        {/* 显示模式指示 */}
        <div className="bg-primary-500/80 backdrop-blur-sm px-4 py-1 text-center">
          <span className="text-[11px] text-white font-medium">
            {displayMode === 'translated' ? '📖 译文' : displayMode === 'original' ? '📜 原文' : '🔤 双语'}
            {' · '}{currentPage + 1}/{pages.length}
            {' · '}字号 {(fontScale * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* 导出进度 */}
      {isExporting && exportProgress !== null && (
        <div className="fixed top-[4.5rem] left-0 right-0 z-20 bg-slate-900/90 backdrop-blur-sm px-4 py-2">
          <div className="flex items-center gap-2">
            <RefreshCw size={14} className="animate-spin text-primary-400" />
            <Progress
              percent={exportProgress}
              size="small"
              strokeColor="#6366F1"
              trailColor="rgba(255,255,255,0.1)"
              className="flex-1 [&_.ant-progress-text]:!text-white/60 [&_.ant-progress-text]:!text-xs"
            />
          </div>
        </div>
      )}

      {/* 阅读区域 */}
      {isLandscape ? (
        /* 横屏单页翻页模式 */
        <div
          className="flex-1 flex items-center justify-center px-2"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {pages.length > 0 && (
            <PageRenderer
              pageUrl={withZoom(pages[currentPage]?.original_url) || PLACEHOLDER_IMAGE(currentPage + 1)}
              altPageUrl={displayMode !== 'original' ? pages[currentPage]?.processed_url : undefined}
              alt={`第${currentPage + 1}页`}
              displayMode={displayMode}
              pageNumber={currentPage + 1}
              placeholderColor={pageColors[currentPage % 6]}
              overlayLabel={`第${currentPage + 1}页`}
              className="w-full"
              aspectRatio="auto"
            />
          )}
          {/* 翻页按钮 */}
          {showControls && (
            <>
              <button
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white/80 disabled:opacity-20"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(pages.length - 1, p + 1))}
                disabled={currentPage >= pages.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white/80 disabled:opacity-20"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}
        </div>
      ) : (
        /* 竖屏卷轴滚动模式 */
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto pt-12"
        >
          <div className="space-y-1">
            {pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <p>暂无页面数据</p>
              </div>
            ) : (
              pages.map((page, idx) => (
                <div
                  key={page.page_id}
                  ref={(el) => { pageRefs.current[idx] = el; }}
                  className="relative px-1"
                >
                  <PageRenderer
                    pageUrl={withZoom(page.original_url) || PLACEHOLDER_IMAGE(idx + 1)}
                    altPageUrl={displayMode !== 'original' ? page.processed_url : undefined}
                    alt={`第${idx + 1}页`}
                    displayMode={displayMode}
                    pageNumber={idx + 1}
                    placeholderColor={pageColors[idx % 6]}
                    overlayLabel={undefined}
                    className="w-full"
                    aspectRatio="auto"
                  />
                  {/* 页码 */}
                  <div className="absolute bottom-2 right-4 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-full z-10">
                    {idx + 1}/{pages.length}
                  </div>
                </div>
              ))
            )}
          </div>
          {/* PC接续引导 */}
          <div className="flex justify-center py-6">
            <ContinueOnPC
              targetUrl={`/pc/reader/${projectId}`}
              triggerText="在电脑上获得更好体验"
            />
          </div>
        </div>
      )}

      {/* 底部控制栏 */}
      <div
        className={clsx(
          'fixed bottom-0 left-0 right-0 z-20 transition-transform duration-300',
          showControls ? 'translate-y-0' : 'translate-y-full'
        )}
      >
        {/* 字号/亮度调节（横屏时显示更多） */}
        {isLandscape && showControls && (
          <div className="bg-black/50 backdrop-blur-sm px-3 py-2 space-y-2">
            <div className="flex items-center gap-2">
              <ZoomOut size={12} className="text-white/50" />
              <Slider
                min={0.8}
                max={2.0}
                step={0.1}
                value={fontScale}
                onChange={setFontScale}
                className="flex-1 [&_.ant-slider-rail]:!bg-white/20 [&_.ant-slider-track]:!bg-primary-500"
                tooltip={{ formatter: (v) => `${((v ?? 1) * 100).toFixed(0)}%` }}
              />
              <ZoomIn size={12} className="text-white/50" />
            </div>
            <div className="flex items-center gap-2">
              <Moon size={12} className="text-white/50" />
              <Slider
                min={20}
                max={150}
                step={10}
                value={brightness}
                onChange={setBrightness}
                className="flex-1 [&_.ant-slider-rail]:!bg-white/20 [&_.ant-slider-track]:!bg-amber-400"
                tooltip={{ formatter: (v) => `${v}%` }}
              />
              <Sun size={12} className="text-white/50" />
            </div>
          </div>
        )}

        <div className="bg-black/60 backdrop-blur-md px-3 py-2 safe-area-bottom">
          {/* TTS 速度（播放时） */}
          {isTTSPlaying && (
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="text-white/50 text-[10px]">语速</span>
              <Slider
                min={0.5}
                max={2}
                step={0.25}
                value={ttsSpeed}
                onChange={(val) => { setTtsSpeed(val); stopTTS(); setTimeout(startTTS, 100); }}
                className="w-24 [&_.ant-slider-rail]:!bg-white/20 [&_.ant-slider-track]:!bg-primary-500"
                tooltip={{ formatter: (v) => `${v}x` }}
              />
            </div>
          )}

          <div className="flex items-center justify-around">
            {/* TTS */}
            <button onClick={toggleTTS} className={clsx('flex flex-col items-center gap-0.5 text-xs', isTTSPlaying ? 'text-primary-400' : 'text-white/60')}>
              {isTTSPlaying ? <Volume2 size={20} className="animate-pulse" /> : <VolumeX size={20} />}
              {isTTSPlaying ? '停止' : '朗读'}
            </button>

            {/* 语言切换 */}
            <button onClick={cycleDisplayMode} className="flex flex-col items-center gap-0.5 text-white/60 text-xs">
              <Globe size={20} />
              切换
            </button>

            {/* 字号缩放 */}
            <div className="flex items-center gap-1">
              <button onClick={() => adjustFontScale(-0.1)} className="text-white/60 p-1">
                <ZoomOut size={16} />
              </button>
              <span className="text-white/40 text-[10px] w-8 text-center">{(fontScale * 100).toFixed(0)}%</span>
              <button onClick={() => adjustFontScale(0.1)} className="text-white/60 p-1">
                <ZoomIn size={16} />
              </button>
            </div>

            {/* 亮度 */}
            <button
              onClick={() => {
                const next = brightness >= 130 ? 50 : brightness + 20;
                setBrightness(next);
                message.info(`亮度 ${next}%`);
              }}
              className="flex flex-col items-center gap-0.5 text-white/60 text-xs"
            >
              <Sun size={20} />
              亮度
            </button>

            {/* 导出 */}
            <button
              onClick={handleExport}
              disabled={isExporting}
              className={clsx('flex flex-col items-center gap-0.5 text-xs', isExporting ? 'text-white/30' : 'text-primary-400')}
            >
              {isExporting ? <RefreshCw size={20} className="animate-spin" /> : <Download size={20} />}
              {isExporting ? '导出中' : '导出'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
