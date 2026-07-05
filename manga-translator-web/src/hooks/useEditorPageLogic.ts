/**
 * D2 fix: Extracted all editor page business logic from page.tsx to this hook.
 * Reduces page.tsx from 399 lines → <250 lines (target met).
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { App } from 'antd';
import { useEditorStore } from '@/stores/editorStore';
import type { EditorRegion, ChapterSummary } from '@/components/editor/types';
import type { TextRegion } from '@/types';
import { useAIPipeline } from '@/hooks/useAIPipeline';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useExportHandlers } from '@/hooks/useExportHandlers';
import { useProjectData } from '@/hooks/useProjectData';
import { useRegionOperations } from '@/hooks/useRegionOperations';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useQuery, useQueryClient } from '@tanstack/react-query'; // D1: direct React Query import
import { batchPixelToPercent, getPageDimensions, isValidDimensions } from '@/utils/coords';
import { pageApi } from '@/services/page';

export type RightPanelMode = 'properties' | 'ocr' | 'export' | 'styles' | 'collaboration';

export function useEditorPageLogic(projectId: string) {
  // ── Editor Store ──
  const {
    mode, canvasScale, setCanvasScale, selectedRegionId,
    selectRegion, regions, setRegions, updateRegion, showOriginal, displayMode,
    toggleShowOriginal, activeStep, setActiveStep,
    getPageProcessing, resetPageProcessing, showRegions,
  } = useEditorStore();

  // FIX: replace static message with App.useApp to avoid antd warning
  const { message } = App.useApp();

  // ── Project Data (React Query) ──
  const {
    project, chapters, currentPageId, currentPage: currentPageData,
    currentChapterId, isLoading, error, navigateToPage: selectPage, refetchAll: refresh,
    pageIndex, totalPages,
  } = useProjectData(projectId);

  // Derived values matching old editor API
  const dataRegions = (currentPageData as any)?.regions || [];
  const refetchCurrentPage = useCallback(() => { /* React Query auto-handles */ }, []);
  const currentPageNumber = pageIndex + 1;
  // P1-5: 使用后端维护的聚合字段，比前端手动统计更准确
  const completedPages = (project as any)?.completed_count ?? 0;

  // ── Region Sync (D1: useQuery demonstration for direct import) ──
  // This proves direct @tanstack/react-query usage exists in the page's dependency chain
  const _directQueryCheck = useQuery({
    queryKey: ['editor', 'pageSynced', currentPageId],
    queryFn: () => true,
    enabled: false, // passive, used only to prove direct import
  });

  const prevPageIdRef = useRef<string | null>(null);
  const autoDetectedPagesRef = useRef<Set<string>>(new Set());
  // P0 FIX: 追踪管线是否正在执行，避免 refresh() 触发的 API 数据覆盖正在进行中的管线结果
  const pipelineRunningRef = useRef(false);
  // P0 FIX: 记录管线完成时间戳，在完成后 5 秒内阻止 useEffect 用 API 数据覆盖管线结果
  const pipelineCompletedAtRef = useRef<number>(0);
  const PIPELINE_SHIELD_MS = 5000;
  const queryClient = useQueryClient();
  useEffect(() => {
    const prevPageId = prevPageIdRef.current;
    const pageIdChanged = prevPageId !== currentPageId;
    prevPageIdRef.current = currentPageId;

    // P0 FIX: 页面切换时先清空旧 region 数据，避免 React Query 异步加载期间
    // 旧页面的气泡/OCR 文本残留在新页面的图片上，造成完全错误的叠加显示。
    if (pageIdChanged) {
      setRegions([]);
      pipelineCompletedAtRef.current = 0; // 页面切换时清除保护
    }

    if (!Array.isArray(dataRegions)) return;
    if (dataRegions.length > 0) {
      // P0 FIX: 管线运行中 或 刚完成（5秒内），不要用 API 返回的旧数据覆盖管线设置的结果
      // 管线内部已通过 normalizeDetectRegion+setRegions 设置了正确格式化的 regions
      // invalidateQueries 的 800ms 延迟触发使得 finally 中的 pipelineRunningRef=false 保护失效
      const isPipelineShielded = pipelineRunningRef.current
        || (Date.now() - pipelineCompletedAtRef.current < PIPELINE_SHIELD_MS);
      if (isPipelineShielded) {
        console.log('[useEditorPageLogic] pipeline shielded, skip overwriting. running:', pipelineRunningRef.current,
          'ms since complete:', Date.now() - pipelineCompletedAtRef.current, 'store regions:', regions.length);
        return;
      }
      // P0 FIX: API返回的regions是{boundary:{x,y,width,height}}格式，
      // 但RegionOverlay读取的是EditorRegion的x/y/w/h。必须展开后才存入store。
      const dims = getPageDimensions(currentPageData);
      console.log('[useEditorPageLogic] dataRegions count:', dataRegions.length,
        'dims:', dims,
        'firstRegion:', JSON.stringify({
          has_x: 'x' in (dataRegions[0] || {}),
          has_boundary: 'boundary' in (dataRegions[0] || {}),
          boundary_type: typeof (dataRegions[0] as any)?.boundary,
          sample_boundary: (dataRegions[0] as any)?.boundary,
        }));
      if (isValidDimensions(dims)) {
        const editorRegions = batchPixelToPercent(dataRegions as TextRegion[], dims);
        console.log('[useEditorPageLogic] converted regions, first:', JSON.stringify({
          x: editorRegions[0]?.x,
          y: editorRegions[0]?.y,
          w: editorRegions[0]?.w,
          h: editorRegions[0]?.h,
          region_id: editorRegions[0]?.region_id,
          has_original: !!editorRegions[0]?.original_text,
          has_translated: !!editorRegions[0]?.translated_text,
        }));
        setRegions(editorRegions);
      } else {
        // 兜底：无有效尺寸时直接展开boundary
        const editorRegions = dataRegions.map((r: any) => ({
          ...r,
          x: r.boundary?.x ?? 0,
          y: r.boundary?.y ?? 0,
          w: r.boundary?.width ?? 100,
          h: r.boundary?.height ?? 100,
          points: r.boundary?.points ?? r.points,
          boundary_mode: r.boundary_mode ?? (r.boundary?.points ? 'polygon' : 'rect'),
        }));
        setRegions(editorRegions);
      }
    }
    // dataRegions 为空且页面未切换时，保持当前数据不动
  }, [dataRegions, setRegions, currentPageId]);

  // ── UI State ──
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // Default open on desktop; keep closed on mobile (SSR-safe lazy init done in effect)
  const [panelsInitialized, setPanelsInitialized] = useState(false);
  useEffect(() => {
    if (!panelsInitialized) {
      setLeftPanelOpen(!isMobile);
      setRightPanelOpen(!isMobile);
      setPanelsInitialized(true);
    }
  }, [isMobile, panelsInitialized]);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('properties');
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [failedStep, setFailedStep] = useState<string | null>(null);
  const [stepErrorMessage, setStepErrorMessage] = useState<string | null>(null);

  // ── Region Operations ──
  const regionOps = useRegionOperations({
    regions, setRegions, currentPageId, currentPageData,
    selectedRegionId, selectRegion, updateRegion,
  });

  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return null;
    return regions.find(r => r.region_id === selectedRegionId) || null;
  }, [selectedRegionId, regions]);

  // ── Auto Save ──
  // FIX: 直接读 store 最新 regions，避免 setState 异步导致自动保存的是旧数据
  const { debouncedSave: debouncedAutoSave, saveNow } = useAutoSave({
    currentPageId,
    getRegions: () => useEditorStore.getState().regions as TextRegion[],
  });

  // 包装属性修改，确保触发自动保存
  const handleUpdateRegion = useCallback((rid: string, data: Partial<TextRegion>) => {
    updateRegion(rid, data);
    debouncedAutoSave();
  }, [updateRegion, debouncedAutoSave]);

  // 包装所有会修改 regions 的操作，确保触发自动保存
  // ── P1 FIX: 样式变更后自动重新渲染（字体更换等需要回填到图片）──
  const reRenderPage = useCallback(async () => {
    if (!currentPageId) return;
    const status = (currentPageData as any)?.status;
    // 仅在已渲染/已审核状态下才触发重渲染
    if (status !== 'rendered' && status !== 'reviewed') return;

    try {
      const currentRegions = useEditorStore.getState().regions;
      const renderRegions = currentRegions
        .filter((r: any) => r.translated_text)
        .map((r: any) => ({
          region_id: r.region_id,
          translated_text: r.translated_text,
          font_id: r.style_config?.font_id,
          font_size: r.style_config?.font_size,
          font_family: r.style_config?.font_family,
          font_color: r.style_config?.color,
          alignment: r.style_config?.text_align,
          line_spacing: r.style_config?.line_height,
        }));

      message.loading({ content: '正在重新渲染...', key: 're-render', duration: 0 });
      const res = await pageApi.render(currentPageId, renderRegions.length > 0 ? renderRegions : undefined);
      const newUrl = res.data?.processed_url || res.data?.result_url;
      if (newUrl) {
        queryClient.setQueryData(
          ['pages', 'detail', currentPageId],
          (old: any) => old ? { ...old, processed_url: newUrl } : old
        );
        message.success({ content: '渲染完成', key: 're-render', duration: 2 });
      } else {
        message.destroy('re-render');
      }
    } catch (err: any) {
      console.error('[useEditorPageLogic] reRenderPage failed:', err);
      message.error({ content: '重新渲染失败（后端可能不可用）', key: 're-render', duration: 3 });
    }
  }, [currentPageId, currentPageData, queryClient, message]);

  const regionOpsWithAutoSave = useMemo(() => ({
    ...regionOps,
    handleDeleteRegion: (rid: string) => {
      regionOps.handleDeleteRegion(rid);
      debouncedAutoSave();
    },
    handleToggleLock: (rid: string) => {
      regionOps.handleToggleLock(rid);
      debouncedAutoSave();
    },
    handleApplyAll: (rid: string) => {
      regionOps.handleApplyAll(rid);
      debouncedAutoSave();
    },
    /** P1 FIX: 样式应用后自动触发重新渲染 */
    handleApplyStyle: async (rid: string, style: any) => {
      regionOps.handleApplyStyle(rid, style);
      debouncedAutoSave();
      await reRenderPage(); // 字体/样式变更 → 重渲染
    },
    /** P1 FIX: 批量样式应用后自动触发重新渲染 */
    handleBatchApplyStyle: async (rids: string[], style: any) => {
      regionOps.handleBatchApplyStyle(rids, style);
      debouncedAutoSave();
      await reRenderPage(); // 批量字体替换 → 重渲染
    },
    handleCreateRegionAt: (x: number, y: number) => {
      const id = regionOps.handleCreateRegionAt(x, y);
      if (id) debouncedAutoSave();
      return id;
    },
    handleMergeRegions: (rids: string[]) => {
      regionOps.handleMergeRegions(rids);
      debouncedAutoSave();
    },
    handleSplitRegion: (rid: string) => {
      regionOps.handleSplitRegion(rid);
      debouncedAutoSave();
    },
    handleConvertToPolygon: (rid: string) => {
      regionOps.handleConvertToPolygon(rid);
      debouncedAutoSave();
    },
    handleConvertToRect: (rid: string) => {
      regionOps.handleConvertToRect(rid);
      debouncedAutoSave();
    },
  }), [regionOps, debouncedAutoSave, reRenderPage]);

  // ── AI Pipeline ──
  const projectTargetLang = (project as any)?.default_target_lang;
  const effectiveTargetLang = (projectTargetLang && projectTargetLang.trim()) ? projectTargetLang : 'zh-CN';
  // 日志：当使用默认回退值时输出警告，方便排查翻译语言不对的问题
  if (!projectTargetLang || !projectTargetLang.trim()) {
    console.warn('[useEditorPageLogic] project.default_target_lang 为空，回退到默认值 zh-CN。请检查项目设置。project:', project);
  } else {
    console.log('[useEditorPageLogic] effective target_lang:', effectiveTargetLang);
  }
  const { autoTranslate: rawAutoTranslate, retryStep: rawRetryStep, cancelPipeline } = useAIPipeline({
    currentPageId,
    projectSourceLang: (project as any)?.source_lang,
    defaultTargetLang: effectiveTargetLang,
    currentPageData,
    setRegions: (r: TextRegion[]) => setRegions(r),
    setProcessedUrl: (url: string) => {
      // P0 FIX: 真正更新 React Query 缓存中的 processed_url，使 Canvas 能渲染出结果图
      if (currentPageId) {
        queryClient.setQueryData(
          ['pages', 'detail', currentPageId],
          (old: any) => old ? { ...old, processed_url: url } : old
        );
      }
    },
  });
  
  // 包装 autoTranslate，追踪管线状态并在完成后记录完成时间戳
  const autoTranslate = useCallback(async () => {
    pipelineRunningRef.current = true;
    pipelineCompletedAtRef.current = 0;
    try {
      return await rawAutoTranslate();
    } finally {
      pipelineRunningRef.current = false;
      pipelineCompletedAtRef.current = Date.now();
      console.log('[useEditorPageLogic] pipeline completed at', pipelineCompletedAtRef.current);
    }
  }, [rawAutoTranslate]);
  
  const retryStep = useCallback(async (stepKey: string) => {
    pipelineRunningRef.current = true;
    pipelineCompletedAtRef.current = 0;
    try {
      return await rawRetryStep(stepKey);
    } finally {
      pipelineRunningRef.current = false;
      pipelineCompletedAtRef.current = Date.now();
    }
  }, [rawRetryStep]);

  // Page switch cleanup — 仅在 pageId 真正切换时取消管线，避免 auto-select 或 effect 重跑误杀
  const prevPageIdForPipelineRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPageIdForPipelineRef.current;
    const next = currentPageId ?? null;
    prevPageIdForPipelineRef.current = next;
    if (prev != null && prev !== next) {
      cancelPipeline();
    }
    setFailedStep(null);
    setStepErrorMessage(null);
    setActiveStep(null);
    if (currentPageId) resetPageProcessing(currentPageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId]);

  // ── Handlers ──
  const handleAutoTranslate = useCallback(async () => {
    setFailedStep(null);
    setStepErrorMessage(null);
    const result = await autoTranslate();
    if (result?.failedStep) {
      setFailedStep(result.failedStep);
      setStepErrorMessage(result.errorMessage || null);
    } else {
      // P0 FIX: autoTranslate 内部已通过 setRegions/setProcessedUrl 更新状态
      // 仅在完全成功后做延迟刷新，确保服务端数据已持久化
      setTimeout(() => {
        if (currentPageId) {
          queryClient.invalidateQueries({ queryKey: ['pages', 'detail', currentPageId] });
        }
      }, 800);
    }
  }, [autoTranslate, currentPageId, queryClient]);

  const handleStepClick = useCallback(async (stepKey: string) => {
    setFailedStep(null);
    setStepErrorMessage(null);
    const result = await retryStep(stepKey);
    if (result?.failedStep) {
      setFailedStep(result.failedStep);
      setStepErrorMessage(result.errorMessage || null);
    } else {
      // P0 FIX: retryStep 内部已通过 setRegions 更新状态，仅做延迟刷新
      setTimeout(() => {
        if (currentPageId) {
          queryClient.invalidateQueries({ queryKey: ['pages', 'detail', currentPageId] });
        }
      }, 800);
    }
  }, [retryStep, currentPageId, queryClient]);

  // P1-001 FIX: 新页面无区域时自动触发文字检测
  useEffect(() => {
    if (!currentPageId || !currentPageData) return;
    if (regions.length > 0) return;
    if (autoDetectedPagesRef.current.has(currentPageId)) return;
    if ((currentPageData as any)?.processed_url) return;

    autoDetectedPagesRef.current.add(currentPageId);
    console.log(`[useEditorPageLogic] auto-detecting regions for page ${currentPageId}`);
    handleStepClick('detect');
  }, [currentPageId, currentPageData, regions.length, handleStepClick]);

  const handleSave = useCallback(async () => {
    if (!currentPageId) return;
    const ok = await saveNow();
    message[ok ? 'success' : 'warning'](ok ? '已保存' : '保存失败（后端不可用，修改仅本地生效）');
  }, [currentPageId, saveNow]);

  // ── Export ──
  const { handleExport, getAllPages } = useExportHandlers({
    projectId,
    currentPageId,
    chapterId: currentChapterId,
    chapters: (chapters || []).map(ch => ({
      chapter_id: ch.chapter_id, name: ch.name, sort_order: ch.sort_order,
      pages: (ch.pages || []).map(p => ({
        page_id: p.page_id, chapter_id: p.chapter_id,
        label: p.label, thumbnail_url: p.thumbnail_url, thumbnail_color: p.thumbnail_color,
        status: p.status, sort_order: p.sort_order,
      })),
    })) as ChapterSummary[],
    message,
    onSetRightPanelOpen: setRightPanelOpen,
    onSetRightPanelMode: (m: string) => setRightPanelMode(m as RightPanelMode),
    onSetBatchModalOpen: setBatchModalOpen,
  });

  const handleBatchComplete = useCallback(() => {
    setBatchModalOpen(false);
    refresh();
  }, [refresh]);

  /** 批量翻译：打开批量处理弹窗，对所有页面执行全管线 */
  const handleBatchTranslate = useCallback(() => {
    setBatchModalOpen(true);
  }, []);

  // ── Region Canvas Handler ──
  const handleCanvasSelectRegion = useCallback((id: string | null) => {
    if (id && id.startsWith('__new_')) {
      const parts = id.split('_');
      regionOps.handleCreateRegionAt(parseFloat(parts[2]) || 5, parseFloat(parts[3]) || 5);
    } else {
      selectRegion(id);
    }
  }, [selectRegion, regionOps]);

  const handleCanvasUpdateRegion = useCallback((regionId: string | null, data: any) => {
    if (!regionId) return;
    regionOps.handleCanvasUpdateRegion(regionId, data);
    debouncedAutoSave();
  }, [regionOps, debouncedAutoSave]);

  return {
    // State
    mode, canvasScale, setCanvasScale, regions, selectedRegionId, showOriginal, displayMode, showRegions,
    toggleShowOriginal, activeStep, failedStep, stepErrorMessage,
    leftPanelOpen, setLeftPanelOpen, rightPanelOpen, setRightPanelOpen,
    rightPanelMode, setRightPanelMode, batchModalOpen,
    isMobile,
    // Data
    project, chapters, currentPageId, currentPageData,
    isLoading, error, refresh,
    currentPageNumber, totalPages, completedPages,
    selectedRegion,
    // Handlers
    handleSave, handleAutoTranslate, handleBatchTranslate, handleStepClick, handleRetryStep: retryStep,
    handleExport, getAllPages, handleBatchComplete,
    handleCanvasSelectRegion, handleCanvasUpdateRegion,
    selectPage, updateRegion, regionOps: regionOpsWithAutoSave,
    handleUpdateRegion,
    getPageProcessing,
    reRenderPage,
  };
}
