'use client';
/**
 * D2 fix: Extracted right panel rendering from page.tsx.
 * Contains all 4 tab panels: properties, OCR, styles, export.
 */
import React, { Suspense, lazy, useCallback } from 'react';
import { Spin } from 'antd';
import clsx from 'clsx';
import type { RightPanelMode } from '@/hooks/useEditorPageLogic';
import type { EditorRegion } from '@/components/editor/types';
import type { TextRegion } from '@/types';

const PropertyPanel = lazy(() => import('@/components/editor/PropertyPanel').then(m => ({ default: m.PropertyPanel })));
const ExportPanel = lazy(() => import('@/components/editor/ExportPanel').then(m => ({ default: m.ExportPanel })));
const StylePanel = lazy(() => import('@/components/editor/StylePanel').then(m => ({ default: m.StylePanel })));
const OcrReviewPanel = lazy(() => import('@/components/editor/OcrReviewPanel'));
const CollaborationPanel = lazy(() => import('@/components/editor/CollaborationPanel').then(m => ({ default: m.CollaborationPanel })));

interface EditorRightPanelProps {
  mode: RightPanelMode;
  open: boolean;
  onModeChange: (mode: RightPanelMode, open: boolean) => void;
  selectedRegion: EditorRegion | null;
  regions: EditorRegion[];
  currentPageId: string | null;
  projectId: string | undefined;
  totalPages: number;
  sourceLang: string | undefined;
  currentPageData: any;
  onUpdateRegion: (rid: string, data: Partial<TextRegion>) => void;
  /** 样式变更后触发重新渲染（仅当页面已渲染时） */
  onReRender?: () => Promise<void>;
  onDeleteRegion: (id: string) => void;
  onToggleLock: (id: string) => void;
  onApplyAll: (opts: any) => void;
  onApplyStyle: (rid: string, style: any) => void;
  onBatchApplyStyle: (opts: any) => void;
  /** §2.2.8/§2.2.4 选区形状操作 */
  onConvertToPolygon?: (id: string) => void;
  onConvertToRect?: (id: string) => void;
  onSplitRegion?: (id: string) => void;
}

const TABS: readonly RightPanelMode[] = ['properties', 'ocr', 'styles', 'export', 'collaboration'] as const;
const TAB_LABELS: Record<RightPanelMode, string> = {
  properties: '属性', ocr: 'OCR校对', styles: '样式', export: '导出', collaboration: '协作',
};

export const EditorRightPanel: React.FC<EditorRightPanelProps> = ({
  mode, open, onModeChange,
  selectedRegion, regions, currentPageId, projectId, totalPages,
  sourceLang, currentPageData,
  onUpdateRegion, onReRender, onDeleteRegion, onToggleLock, onApplyAll,
  onApplyStyle, onBatchApplyStyle,
  onConvertToPolygon, onConvertToRect, onSplitRegion,
}) => {
  // P1 FIX: PropertyPanel 的 onUpdate 包装——样式变更自动触发重渲染
  const handlePropertyUpdate = useCallback((rid: string, data: any) => {
    onUpdateRegion(rid, data as Partial<TextRegion>);
    // 仅当变更是 style_config 且页面已渲染时才触发重渲染
    if (data?.style_config && onReRender) {
      onReRender();
    }
  }, [onUpdateRegion, onReRender]);

  return (
    <div className="w-72 flex-shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
      {/* Tab Bar */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        {TABS.map(tab => (
          <button key={tab}
            onClick={() => onModeChange(tab, !(mode === tab && open))}
            className={clsx('flex-1 py-2 text-xs font-medium transition-colors border-b-2',
              mode === tab && open
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300')}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Panels — 可滚动区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      <FallbackSuspense show={open && mode === 'properties'}>
        <PropertyPanel
          region={selectedRegion}
          onUpdate={handlePropertyUpdate}
          onDelete={onDeleteRegion}
          onToggleLock={onToggleLock}
          onApplyAll={onApplyAll}
          onConvertToPolygon={onConvertToPolygon}
          onConvertToRect={onConvertToRect}
          onSplitRegion={onSplitRegion}
          onApplyPreset={(rid, style) => onApplyStyle(rid, style)}
          onClose={() => onModeChange(mode, false)}
        />
      </FallbackSuspense>

      <FallbackSuspense show={open && mode === 'ocr'}>
        <OcrReviewPanel
          regions={regions}
          pageId={currentPageId || ''}
          sourceLang={sourceLang}
          onUpdateRegion={(rid, data) => onUpdateRegion(rid, data as Partial<TextRegion>)}
          onClose={() => onModeChange(mode, false)}
        />
      </FallbackSuspense>

      <FallbackSuspense show={open && mode === 'styles'}>
        <StylePanel
          selectedRegion={selectedRegion}
          allRegions={regions}
          onApplyToRegion={onApplyStyle}
          onBatchApply={onBatchApplyStyle}
          onClose={() => onModeChange(mode, false)}
        />
      </FallbackSuspense>

      <FallbackSuspense show={open && mode === 'export'}>
        <ExportPanel
          currentPageId={currentPageId}
          chapterId={currentPageData?.chapter_id}
          projectId={projectId}
          allPageCount={totalPages}
          onClose={() => onModeChange(mode, false)}
        />
      </FallbackSuspense>

      <FallbackSuspense show={open && mode === 'collaboration'}>
        <CollaborationPanel projectId={projectId || ''} pageId={currentPageId || undefined} />
      </FallbackSuspense>
      </div>{/* /scrollable panels */}
    </div>
  );
};

/** Conditional suspense wrapper */
const FallbackSuspense: React.FC<{ show: boolean; children: React.ReactNode }> = ({ show, children }) => {
  if (!show) return null;
  return (
    <Suspense fallback={<div className="p-4 text-center text-slate-400"><Spin size="small" /></div>}>
      {children}
    </Suspense>
  );
};
