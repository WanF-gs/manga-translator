/**
 * 导出相关操作 Hook
 * 管理导出流程、批量处理触发
 */
import { useCallback } from 'react';
import type { ChapterSummary } from '@/components/editor/types';

interface BatchPageInfo {
  page_id: string;
  label: string;
  status: string;
  thumbnail_color: string;
  sort_order?: number;
}

interface UseExportHandlersOptions {
  chapters: ChapterSummary[];
  onSetRightPanelOpen: (open: boolean) => void;
  onSetRightPanelMode: (mode: 'properties' | 'ocr' | 'export' | 'styles') => void;
  onSetBatchModalOpen: (open: boolean) => void;
}

export function useExportHandlers({
  chapters,
  onSetRightPanelOpen,
  onSetRightPanelMode,
  onSetBatchModalOpen,
}: UseExportHandlersOptions) {
  /** 处理导出操作 */
  const handleExport = useCallback(
    (type: 'current' | 'all' | 'bilingual') => {
      if (type === 'all') {
        const allPages: BatchPageInfo[] = [];
        chapters.forEach((ch) => {
          (ch.pages || []).forEach((p) => {
            allPages.push({
              page_id: p.page_id,
              label: p.label,
              status: p.status,
              thumbnail_color: p.thumbnail_color,
              sort_order: p.sort_order,
            });
          });
        });
        onSetBatchModalOpen(true);
        return;
      }
      // 单页/双语导出：切换到导出面板
      onSetRightPanelOpen(true);
      onSetRightPanelMode('export');
    },
    [chapters, onSetBatchModalOpen, onSetRightPanelOpen, onSetRightPanelMode]
  );

  /** 获取所有页面信息（用于 BatchProgressModal） */
  const getAllPages = useCallback((): BatchPageInfo[] => {
    return chapters.flatMap((ch) =>
      (ch.pages || []).map((p) => ({
        page_id: p.page_id,
        label: p.label,
        status: p.status,
        thumbnail_color: p.thumbnail_color,
        sort_order: p.sort_order,
      }))
    );
  }, [chapters]);

  return { handleExport, getAllPages };
}
