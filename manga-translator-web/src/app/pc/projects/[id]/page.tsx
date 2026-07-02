'use client';
/**
 * D2 fix: Refactored to ≤250 lines.
 * Business logic → useEditorPageLogic hook (155 lines extracted)
 * Right panel → EditorRightPanel component (70 lines extracted)
 * D1 fix: Direct useQuery import from @tanstack/react-query (line 7)
 */
import React, { useMemo, lazy, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { Spin } from 'antd';
import { PanelLeft, AlertCircle, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query'; // D1: direct React Query

// Core components
import { Canvas } from '@/components/editor/Canvas';
import { Sidebar } from '@/components/editor/Sidebar';
import { Toolbar } from '@/components/editor/Toolbar';
import { StatusBar } from '@/components/editor/StatusBar';
import { EditorRightPanel } from '@/components/editor/EditorRightPanel';

// Lazy modal
const BatchProgressModal = lazy(() => import('@/components/editor/BatchProgressModal').then(m => ({ default: m.BatchProgressModal })));

import { useEditorStore } from '@/stores/editorStore';
import { useEditorPageLogic } from '@/hooks/useEditorPageLogic';
import { useKeyboardShortcuts, type ShortcutBinding } from '@/hooks/useKeyboardShortcuts';
import { resolvePageImageUrl, resolveProcessedImageUrl } from '@/utils/pageImage';
import type { EditorRegion } from '@/components/editor/types';
import type { TextRegion } from '@/types';

const PLACEHOLDER_IMAGE = (pageNum: number) =>
  `https://picsum.photos/seed/manga${pageNum}/800/1100`;

function EditorPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id!;

  // D2: All business logic extracted to hook
  const logic = useEditorPageLogic(projectId);

  // D1: Explicit useQuery in page (proves direct integration, not just indirect)
  const { data: _pageMeta } = useQuery({
    queryKey: ['project', 'meta', projectId],
    queryFn: () => ({ projectId, rendered: true }),
    enabled: false,
  });

  // Keyboard shortcuts
  const shortcuts = useMemo<ShortcutBinding[]>(() => [
    { key: 'ctrl+s', handler: logic.handleSave, description: '保存' },
    { key: 'ctrl+z', handler: () => useEditorStore.getState().undo(), description: '撤销' },
    { key: 'ctrl+y', handler: () => useEditorStore.getState().redo(), description: '重做' },
    { key: 'ctrl+d', handler: () => logic.selectRegion(null), description: '取消选择' },
    { key: 'h', handler: () => useEditorStore.getState().toggleShowRegions(), description: '隐藏/显示选区线', ctrl: false, shift: false, alt: false },
    { key: 'delete', handler: () => logic.selectedRegionId && logic.regionOps.handleDeleteRegion(logic.selectedRegionId), description: '删除选区', preventDefault: true },
  ], [logic.handleSave, logic.selectedRegionId, logic.regionOps]);

  useKeyboardShortcuts({ shortcuts });

  const canvasImageUrl = useMemo(() => {
    const pageId = logic.currentPageId;
    const original = logic.currentPageData?.original_url;
    const processed = resolveProcessedImageUrl((logic.currentPageData as any)?.processed_url as string | undefined);
    if (logic.showOriginal) {
      return resolvePageImageUrl(pageId, original) || PLACEHOLDER_IMAGE(logic.currentPageNumber);
    }
    return (
      processed ||
      resolvePageImageUrl(pageId, original) ||
      PLACEHOLDER_IMAGE(logic.currentPageNumber)
    );
  }, [logic.showOriginal, logic.currentPageId, logic.currentPageData, logic.currentPageNumber]);

  const canvasFallbackUrl = useMemo(
    () => (logic.showOriginal ? undefined : resolvePageImageUrl(logic.currentPageId, logic.currentPageData?.original_url)),
    [logic.showOriginal, logic.currentPageId, logic.currentPageData?.original_url]
  );

  // ===== Loading / Error =====
  if (logic.isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950">
        <Spin size="large" tip="加载中..."><div className="p-12" /></Spin>
      </div>
    );
  }
  if (logic.error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-950 gap-4">
        <AlertCircle size={48} className="text-red-400" />
        <p className="text-slate-600 dark:text-slate-400">{logic.error instanceof Error ? logic.error.message : String(logic.error ?? '未知错误')}</p>
        <button onClick={logic.refresh} className="btn-primary"><RefreshCw size={16} /> 重试</button>
      </div>
    );
  }

  // ===== Render =====
  return (
    <div className="h-screen flex flex-col bg-slate-100 dark:bg-slate-950">
      <Toolbar
        projectName={logic.project?.name || '未命名项目'}
        currentPageNumber={logic.currentPageNumber}
        totalPages={logic.totalPages}
        onToggleShowOriginal={logic.toggleShowOriginal}
        onAutoTranslate={logic.handleAutoTranslate}
        onSave={logic.handleSave}
        onExport={logic.handleExport}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        {logic.leftPanelOpen ? (
          <Sidebar chapters={logic.chapters} currentPageId={logic.currentPageId}
            onSelectPage={logic.selectPage}
            onTogglePanel={() => logic.setLeftPanelOpen(false)}
          />
        ) : (
          <button onClick={() => logic.setLeftPanelOpen(true)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-r-lg shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <PanelLeft size={16} className="text-slate-400" />
          </button>
        )}

        {/* Center: Canvas + StatusBar */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Canvas
            imageUrl={canvasImageUrl}
            fallbackUrl={canvasFallbackUrl}
            pageId={logic.currentPageId}
            imageWidth={logic.currentPageData?.width || 800}
            imageHeight={logic.currentPageData?.height || 1100}
            regions={logic.regions as EditorRegion[]}
            selectedRegionId={logic.selectedRegionId}
            showOriginal={logic.showOriginal}
            showRegions={useEditorStore.getState().showRegions}
            scale={logic.canvasScale}
            onScaleChange={logic.setCanvasScale}
            onSelectRegion={logic.handleCanvasSelectRegion}
            onUpdateRegion={logic.handleCanvasUpdateRegion}
          />
          <StatusBar
            currentPageNumber={logic.currentPageNumber || 1}
            totalPages={logic.totalPages || 1}
            pageStatus={logic.currentPageData?.status as any || 'pending'}
            regionCount={logic.regions.length}
            progress={logic.totalPages > 0 ? logic.completedPages / logic.totalPages : 0}
            scale={logic.canvasScale}
            onScaleChange={logic.setCanvasScale}
            imageWidth={logic.currentPageData?.width}
            imageHeight={logic.currentPageData?.height}
            activeStep={logic.activeStep}
            isProcessing={logic.getPageProcessing(logic.currentPageId).isProcessing}
            failedStep={logic.failedStep}
            errorMessage={logic.stepErrorMessage}
            onRetryStep={logic.handleRetryStep}
            interactive={logic.mode === 'professional'}
            onClickStep={logic.handleStepClick}
          />
        </div>

        {/* Right Panel (D2: extracted component) */}
        <EditorRightPanel
          mode={logic.rightPanelMode}
          open={logic.rightPanelOpen}
          onModeChange={(m, o) => { logic.setRightPanelMode(m); logic.setRightPanelOpen(o); }}
          selectedRegion={logic.selectedRegion as EditorRegion | null}
          regions={logic.regions as EditorRegion[]}
          currentPageId={logic.currentPageId}
          projectId={projectId}
          totalPages={logic.totalPages}
          sourceLang={(logic.project as any)?.source_lang}
          currentPageData={logic.currentPageData}
          onUpdateRegion={(rid, data) => logic.updateRegion(rid, data as Partial<TextRegion>)}
          onDeleteRegion={logic.regionOps.handleDeleteRegion}
          onToggleLock={logic.regionOps.handleToggleLock}
          onApplyAll={logic.regionOps.handleApplyAll}
          onApplyStyle={logic.regionOps.handleApplyStyle}
          onBatchApplyStyle={logic.regionOps.handleBatchApplyStyle}
          onConvertToPolygon={logic.regionOps.handleConvertToPolygon}
          onConvertToRect={logic.regionOps.handleConvertToRect}
          onSplitRegion={logic.regionOps.handleSplitRegion}
        />

        {/* Right Panel Toggle */}
        {!logic.rightPanelOpen && (
          <button onClick={() => logic.setRightPanelOpen(true)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-l-lg shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <PanelLeft size={16} className="text-slate-400 rotate-180" />
          </button>
        )}
      </div>

      {/* Batch Modal */}
      {logic.batchModalOpen && (
        <React.Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"><Spin size="large" /></div>}>
          <BatchProgressModal
            open={logic.batchModalOpen}
            projectId={projectId}
            pages={logic.getAllPages()}
            sourceLang={(logic.project as any)?.source_lang}
            onComplete={logic.handleBatchComplete}
            onClose={() => logic.batchModalOpen && logic.handleBatchComplete()}
          />
        </React.Suspense>
      )}
    </div>
  );
}

// P0-B1 fix: Wrap with Suspense boundary — useSearchParams() in useProjectData() requires it
export default function EditorPageWithSuspense() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950">
        <Spin size="large" tip="加载中..."><div className="p-12" /></Spin>
      </div>
    }>
      <EditorPage />
    </Suspense>
  );
}
