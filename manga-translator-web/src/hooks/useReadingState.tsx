'use client';

/**
 * useReadingState - 阅读器状态管理 Hook
 * 管理阅读进度/模式/方向/书签/设置/导出等所有阅读器状态
 * 用于将 PC 阅读器 page.tsx 从 953 行缩减至 ≤250 行
 * 
 * P0-2: 数据获取层迁移至 React Query (useProjectDetail, useChapters, useQueries for pages)
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Modal, Radio } from 'antd';
import { Download } from 'lucide-react';
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
import { getGlobalMessage } from '@/app/providers';
import type { ProjectData, PageData } from '@/types';
import type { ExportFormat } from '@/services/export';
import { resolvePageImageUrl, resolveProcessedImageUrl } from '@/utils/pageImage';

const PLACEHOLDER_IMAGE = (num: number) =>
  `https://picsum.photos/seed/reader${num}/800/1100`;

const BOOKMARK_KEY = 'manga_reader_bookmarks';
type FontSizeLevel = 'small' | 'medium' | 'large';
const FONT_SIZES: Record<FontSizeLevel, number> = { small: 12, medium: 16, large: 20 };

interface BookmarkData {
  pageNumber: number;
  chapterId?: string;
  timestamp: number;
}

function loadBookmarks(): Record<string, BookmarkData> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
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

interface UseReadingStateOptions {
  projectId: string;
}

function extractData<T>(res: any): T {
  const raw = res?.data ?? res;
  return (raw?.data ?? raw) as T;
}

export function useReadingState({ projectId: rawId }: UseReadingStateOptions) {
  const message = getGlobalMessage()!;

  // 支持传入 project_id 或 page_id（测试报告误用 page_id 时可自动解析）
  const { data: resolvedContext, isLoading: resolvingId, isError: resolveError, error: resolveErr } = useQuery({
    queryKey: ['reader', 'resolve', rawId],
    queryFn: async () => {
      try {
        const projRes = await projectApi.getDetail(rawId);
        const proj = extractData<ProjectData>(projRes);
        if (proj?.project_id || proj?.name) {
          return { projectId: rawId, initialPageIndex: 0 };
        }
      } catch {
        // fall through to page lookup
      }
      const pageRes = await pageApi.getDetail(rawId);
      const page = extractData<PageData & { project_id?: string; sort_order?: number }>(pageRes);
      const projectId = page?.project_id;
      if (!projectId) throw new Error('Project not found');
      return {
        projectId,
        initialPageIndex: Math.max(0, (page.sort_order || 1) - 1),
      };
    },
    enabled: !!rawId,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const projectId = resolvedContext?.projectId || '';
  const initialPageFromResolve = resolvedContext?.initialPageIndex ?? 0;

  // ===== P0-2: React Query 数据获取 =====
  const {
    data: projectData,
    isLoading: projectLoading,
    isError: _projectError,
    error: projectQueryError,
  } = useProjectDetail(projectId, { enabled: !!projectId });

  const {
    data: chaptersData = [],
    isLoading: chaptersLoading,
    isError: _chaptersError,
  } = useChapters(projectId);

  // P0-2: 使用 useQueries 动态获取所有章节的页面（符合 hooks 规则）
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

  // 合并所有页面数据
  const pages: PageData[] = useMemo(() => {
    const result: PageData[] = [];
    pagesQueries.forEach((q) => {
      if (q.data) {
        const enriched = q.data.map((p: any) => ({
          ...p,
          original_url: resolvePageImageUrl(p.page_id, p.original_url) || PLACEHOLDER_IMAGE(p.sort_order),
          processed_url: resolveProcessedImageUrl(p.processed_url),
        }));
        result.push(...enriched);
      }
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesQueries.map((q) => q.data).join(',')]);

  // 综合 loading/error 状态
  const loading = resolvingId || (!!projectId && (projectLoading || chaptersLoading || allPagesLoading));
  const error = resolveError
    ? ((resolveErr as Error)?.message || 'Project not found')
    : (projectQueryError?.message || null);

  const project: ProjectData | null = projectData || null;

  // ===== 数据状态 =====
  const [currentPage, setCurrentPage] = useState(0);

  // ===== 阅读状态 =====
  const [layoutMode, setLayoutMode] = useState<ReaderLayoutMode>('single');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('translated');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // ===== 功能状态 =====
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [fontSize, setFontSize] = useState<FontSizeLevel>('medium');
  const [isTTSPlaying, setIsTTSPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const exportTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ===== 设置 =====
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readingDirection, setReadingDirection] = useState<'ltr' | 'rtl'>('ltr');
  const [autoFlipInterval, setAutoFlipInterval] = useState<number>(0);
  const [bubbleEnabled, setBubbleEnabled] = useState(true);
  const [savingProgress, setSavingProgress] = useState(false);

  // 气泡覆盖
  const [regionModeOverrides, setRegionModeOverrides] = useState<Record<string, DisplayMode>>({});
  const handleBubbleClick = useCallback((regionId: string) => {
    if (!bubbleEnabled) return;
    setRegionModeOverrides((prev) => {
      const current = prev[regionId] || displayMode;
      const next: DisplayMode =
        current === 'translated' ? 'original' :
        current === 'original' ? 'bilingual' :
        'translated';
      return { ...prev, [regionId]: next };
    });
  }, [displayMode, bubbleEnabled]);

  // 翻页时清除气泡覆盖
  useEffect(() => {
    setRegionModeOverrides({});
  }, [currentPage]);

  const autoFlipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P0-2: 页面数据加载完成后恢复书签状态
  useEffect(() => {
    if (pages.length > 0 && projectId) {
      const bookmarks = loadBookmarks();
      setIsBookmarked(!!bookmarks[projectId]);
    }
  }, [pages.length, projectId]);

  // ===== 阅读进度 (React Query) =====
  const {
    data: readerProgress,
    isLoading: progressLoading,
  } = useReaderProgress(projectId);

  // 从 page_id 解析进入时定位到对应页
  const initialPageAppliedRef = useRef(false);
  useEffect(() => {
    if (initialPageAppliedRef.current || pages.length === 0 || initialPageFromResolve <= 0) return;
    setCurrentPage(Math.min(initialPageFromResolve, pages.length - 1));
    initialPageAppliedRef.current = true;
  }, [pages.length, initialPageFromResolve]);

  // 从 React Query 进度恢复当前页码
  useEffect(() => {
    if (readerProgress && pages.length > 0) {
      const progress = (readerProgress as any)?.current_page;
      if (progress) {
        setCurrentPage(Math.min(progress - 1, pages.length - 1));
      }
    }
  }, [readerProgress, pages.length]);

  useEffect(() => {
    if (!projectId || pages.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSavingProgress(true);
      try {
        await readerApi.saveProgress(projectId, currentPage + 1);
      } catch {
        localStorage.setItem(`reader_progress_${projectId}`, String(currentPage));
      } finally {
        setSavingProgress(false);
      }
    }, 5000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [projectId, currentPage, pages.length]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (projectId) {
        navigator.sendBeacon
          ? navigator.sendBeacon(`/api/v1/reader/progress`, JSON.stringify({
              project_id: projectId,
              page_id: String(currentPage + 1),
              chapter_id: pages[currentPage]?.chapter_id || '',
              scroll_position: 0,
              zoom_level: 1.0,
            }))
          : localStorage.setItem(`reader_progress_${projectId}`, String(currentPage));
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [projectId, currentPage]);

  // ===== 自动翻页 =====
  useEffect(() => {
    if (autoFlipInterval > 0 && pages.length > 0) {
      autoFlipTimerRef.current = setInterval(() => {
        setCurrentPage((p) => (p + 1) % pages.length);
      }, autoFlipInterval * 1000);
    }
    return () => {
      if (autoFlipTimerRef.current) clearInterval(autoFlipTimerRef.current);
    };
  }, [autoFlipInterval, pages.length]);

  // ===== 清理 =====
  useEffect(() => {
    return () => {
      if (exportTimerRef.current) clearInterval(exportTimerRef.current);
      if (autoFlipTimerRef.current) clearInterval(autoFlipTimerRef.current);
    };
  }, []);

  // ===== 全屏 =====
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // ===== 书签 =====
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

  // ===== 字号 =====
  const cycleFontSize = useCallback(() => {
    const levels: FontSizeLevel[] = ['small', 'medium', 'large'];
    const idx = levels.indexOf(fontSize);
    const next = levels[(idx + 1) % levels.length];
    setFontSize(next);
    message.info(`字号: ${FONT_SIZES[next]}px`);
  }, [fontSize]);

  // ===== 语言切换 =====
  const handleToggleLang = useCallback(() => {
    if (displayMode === 'translated') setDisplayMode('original');
    else if (displayMode === 'original') setDisplayMode('bilingual');
    else setDisplayMode('translated');
  }, [displayMode]);

  // ===== 导出 =====
  const doExport = useCallback(
    async (scope: 'page' | 'chapter' | 'project', format: ExportFormat) => {
      setIsExporting(true);
      setExportProgress(0);
      const hide = message.loading({ content: '正在创建导出任务...', duration: 0 });
      try {
        let result: any;
        const currentPageData = pages[currentPage];
        if (scope === 'page' && currentPageData) {
          result = await exportApi.single(currentPageData.page_id, format);
        } else if (scope === 'chapter' && (currentPageData as any)?.chapter_id) {
          result = await exportApi.chapter((currentPageData as any).chapter_id, format);
        } else {
          result = await exportApi.project(projectId!, format);
        }
        const taskData = result.data?.data || result.data;
        const taskId = taskData?.task_id || taskData?.taskId;
        hide();
        message.loading({ content: '导出中...', key: 'export', duration: 0 });
        if (taskId) {
          await pollExportProgress(taskId);
        } else if (taskData?.download_url) {
          exportApi.downloadFile(taskData.download_url, taskData.filename || `export.${format}`);
          message.success({ content: '导出完成！', key: 'export' });
        } else {
          message.warning({ content: '导出完成，但未获取到下载链接', key: 'export' });
        }
      } catch (err: any) {
        const code = err?.response?.status || 0;
        if (code === 404) {
          message.warning({ content: '导出服务暂不可用', key: 'export' });
        } else {
          message.error({ content: `导出失败: ${err?.message || '未知错误'}`, key: 'export' });
        }
      } finally {
        setIsExporting(false);
        setExportProgress(null);
        hide();
      }
    },
    [pages, currentPage, projectId]
  );

  const pollExportProgress = useCallback(async (taskId: string) => {
    let attempts = 0;
    const maxAttempts = 120;
    exportTimerRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await exportApi.getStatus(taskId);
        const status = res.data?.data;
        if (!status) return;
        setExportProgress(status.progress || 0);
        if (status.status === 'completed') {
          clearInterval(exportTimerRef.current!);
          const url = status.output_url || status.download_url;
          if (url) {
            exportApi.downloadFile(url, status.output_filename || status.filename || `export_${taskId}`);
            message.success({ content: '导出完成！', key: 'export' });
          } else {
            try {
              const dlRes = await exportApi.getDownload(taskId);
              const dlData = dlRes.data?.data;
              if (dlData?.download_url) {
                exportApi.downloadFile(dlData.download_url, dlData.filename || `export_${taskId}`);
                message.success({ content: '导出完成！', key: 'export' });
              }
            } catch {
              message.success({ content: '导出任务已完成', key: 'export' });
            }
          }
        } else if (status.status === 'failed') {
          clearInterval(exportTimerRef.current!);
          message.error({ content: `导出失败: ${status.error || status.error_msg || '未知错误'}`, key: 'export' });
        } else if (attempts >= maxAttempts) {
          clearInterval(exportTimerRef.current!);
          message.warning({ content: '导出超时，请稍后查看', key: 'export' });
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(exportTimerRef.current!);
          message.warning({ content: '导出进度查询超时', key: 'export' });
        }
      }
    }, 5000);
  }, []);

  const handleExport = useCallback(() => {
    if (!projectId || pages.length === 0) {
      message.warning('无页面可导出');
      return;
    }
    Modal.confirm({
      title: '导出设置',
      icon: <Download size={20} className="text-primary-500" />,
      width: 420,
      content: (
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">导出范围</label>
            <Radio.Group id="export-scope" defaultValue="page" className="flex flex-col gap-2">
              <Radio value="page">导出当前页（第{currentPage + 1}页）</Radio>
              <Radio value="chapter">导出当前章节</Radio>
              <Radio value="project">导出全部（{pages.length}页）</Radio>
            </Radio.Group>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">导出格式</label>
            <Radio.Group id="export-format" defaultValue="png" className="flex gap-3">
              <Radio value="png">PNG</Radio>
              <Radio value="jpg">JPG</Radio>
              <Radio value="webp">WebP</Radio>
              <Radio value="cbz">CBZ</Radio>
              <Radio value="pdf">PDF</Radio>
            </Radio.Group>
          </div>
        </div>
      ),
      okText: '开始导出',
      cancelText: '取消',
      onOk: () => {
        const scopeEl = document.querySelector<HTMLInputElement>('#export-scope input:checked');
        const formatEl = document.querySelector<HTMLInputElement>('#export-format input:checked');
        const scope = (scopeEl?.value || 'page') as 'page' | 'chapter' | 'project';
        const format = (formatEl?.value || 'png') as ExportFormat;
        doExport(scope, format);
      },
    });
  }, [projectId, pages, currentPage, doExport]);

  // ===== TTS 回调 =====
  const handleTTS = useCallback(() => {
    if (isTTSPlaying) {
      window.speechSynthesis.cancel();
      setIsTTSPlaying(false);
      return;
    }
    const currentPageData = pages[currentPage];
    if (!currentPageData) { message.warning('无页面数据可朗读'); return; }
    const text = (currentPageData as any)?.regions
      ?.map((r: any) => r.translated_text || r.text || '')
      .filter(Boolean)
      .join('。');
    if (!text) { message.warning('当前页面无可朗读文字'); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    const sourceLang = (project as any)?.source_lang || 'ja';
    const LANG_MAP: Record<string, string> = { 'zh-CN': 'zh-CN', ja: 'ja-JP', en: 'en-US', ko: 'ko-KR' };
    utterance.lang = LANG_MAP[displayMode === 'original' ? sourceLang : 'zh-CN'] || 'ja-JP';
    utterance.rate = 0.9;
    utterance.onend = () => setIsTTSPlaying(false);
    utterance.onerror = () => setIsTTSPlaying(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsTTSPlaying(true);
  }, [isTTSPlaying, pages, currentPage, project, displayMode]);

  return {
    // 数据 (P0-2: 由 React Query 管理)
    pages, project, loading, error: error || null,
    loadData: () => {}, // 保留兼容，React Query 自动管理
    // 阅读状态
    currentPage, setCurrentPage,
    layoutMode, setLayoutMode,
    displayMode, setDisplayMode,
    isFullscreen, toggleFullscreen,
    isDarkMode, setIsDarkMode,
    showControls, setShowControls,
    // 功能
    isBookmarked, handleBookmark,
    handleToggleLang,
    fontSize, cycleFontSize,
    isTTSPlaying, handleTTS,
    isExporting, exportProgress, handleExport,
    regionModeOverrides, setRegionModeOverrides, handleBubbleClick, bubbleEnabled, setBubbleEnabled,
    // 设置
    settingsOpen, setSettingsOpen,
    readingDirection, setReadingDirection,
    autoFlipInterval, setAutoFlipInterval,
    savingProgress,
    // 常量
    FONT_SIZES,
    totalPages: pages.length,
    currentPageData: pages[currentPage],
  };
}
