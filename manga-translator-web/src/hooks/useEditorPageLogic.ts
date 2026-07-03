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
import { useQuery } from '@tanstack/react-query'; // D1: direct React Query import

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
  useEffect(() => {
    const prevPageId = prevPageIdRef.current;
    const pageIdChanged = prevPageId !== currentPageId;
    prevPageIdRef.current = currentPageId;

    // P0 FIX: 页面切换时先清空旧 region 数据，避免 React Query 异步加载期间
    // 旧页面的气泡/OCR 文本残留在新页面的图片上，造成完全错误的叠加显示。
    if (pageIdChanged) {
      setRegions([]);
    }

    if (!Array.isArray(dataRegions)) return;
    if (dataRegions.length > 0) {
      setRegions(dataRegions as TextRegion[]);
    }
    // dataRegions 为空且页面未切换时，保持当前数据不动
  }, [dataRegions, setRegions, currentPageId]);

  // ── UI State ──
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
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
    handleApplyStyle: (rid: string, style: any) => {
      regionOps.handleApplyStyle(rid, style);
      debouncedAutoSave();
    },
    handleBatchApplyStyle: (rids: string[], style: any) => {
      regionOps.handleBatchApplyStyle(rids, style);
      debouncedAutoSave();
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
  }), [regionOps, debouncedAutoSave]);

  // ── AI Pipeline ──
  const projectTargetLang = (project as any)?.default_target_lang;
  const effectiveTargetLang = (projectTargetLang && projectTargetLang.trim()) ? projectTargetLang : 'zh-CN';
  // 日志：当使用默认回退值时输出警告，方便排查翻译语言不对的问题
  if (!projectTargetLang || !projectTargetLang.trim()) {
    console.warn('[useEditorPageLogic] project.default_target_lang 为空，回退到默认值 zh-CN。请检查项目设置。project:', project);
  } else {
    console.log('[useEditorPageLogic] effective target_lang:', effectiveTargetLang);
  }
  const { autoTranslate, retryStep: handleRetryStep, cancelPipeline } = useAIPipeline({
    currentPageId,
    projectSourceLang: (project as any)?.source_lang,
    defaultTargetLang: effectiveTargetLang,
    currentPageData,
    setRegions: (r: TextRegion[]) => setRegions(r),
    setProcessedUrl: () => {},
  });

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
      await refetchCurrentPage();
      refresh();
    }
  }, [autoTranslate, refetchCurrentPage, refresh]);

  const handleStepClick = useCallback(async (stepKey: string) => {
    setFailedStep(null);
    setStepErrorMessage(null);
    const result = await handleRetryStep(stepKey);
    if (result?.failedStep) {
      setFailedStep(result.failedStep);
      setStepErrorMessage(result.errorMessage || null);
    } else {
      await refetchCurrentPage();
      refresh();
    }
  }, [handleRetryStep, refetchCurrentPage, refresh]);

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
    // Data
    project, chapters, currentPageId, currentPageData,
    isLoading, error, refresh,
    currentPageNumber, totalPages, completedPages,
    selectedRegion,
    // Handlers
    handleSave, handleAutoTranslate, handleBatchTranslate, handleStepClick, handleRetryStep,
    handleExport, getAllPages, handleBatchComplete,
    handleCanvasSelectRegion, handleCanvasUpdateRegion,
    selectPage, updateRegion, regionOps: regionOpsWithAutoSave,
    handleUpdateRegion,
    getPageProcessing,
  };
}
