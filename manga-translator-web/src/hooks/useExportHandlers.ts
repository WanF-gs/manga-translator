/**
 * 导出相关操作 Hook
 * 管理导出流程、批量处理触发
 */
import { useCallback, useRef } from 'react';
import type { MessageInstance } from 'antd/es/message/interface';
import { exportApi, type ExportFormat } from '@/services/export';
import { pageApi } from '@/services/page';
import type { ChapterSummary } from '@/components/editor/types';
import type { BilingualMode } from '@/types';

interface BatchPageInfo {
  page_id: string;
  label: string;
  status: string;
  thumbnail_color: string;
  sort_order?: number;
}

interface UseExportHandlersOptions {
  projectId: string;
  currentPageId?: string | null;
  chapterId?: string | null;
  chapters: ChapterSummary[];
  message: MessageInstance;
  onSetRightPanelOpen: (open: boolean) => void;
  onSetRightPanelMode: (mode: 'properties' | 'ocr' | 'export' | 'styles') => void;
  onSetBatchModalOpen: (open: boolean) => void;
}

export function useExportHandlers({
  projectId,
  currentPageId,
  chapterId,
  chapters,
  message,
  onSetRightPanelOpen,
  onSetRightPanelMode,
  onSetBatchModalOpen,
}: UseExportHandlersOptions) {
  const isExportingRef = useRef(false);
  const MESSAGE_KEY = 'toolbar-export';

  /** 直接导出一页（顶部工具栏一键导出） */
  const doSingleExport = useCallback(async (bilingual = false) => {
    if (!currentPageId) {
      message.warning({ content: '请先选择要导出的页面', key: MESSAGE_KEY });
      return;
    }
    if (isExportingRef.current) return;
    isExportingRef.current = true;

    message.loading({ content: '正在重新渲染译文...', key: MESSAGE_KEY, duration: 0 });
    try {
      await pageApi.render(currentPageId);
    } catch (err: any) {
      message.warning({ content: `渲染失败，将使用已有渲染结果导出：${err?.message || '未知错误'}`, key: MESSAGE_KEY });
    }

    try {
      message.loading({ content: '正在导出...', key: MESSAGE_KEY, duration: 0 });
      const result = await exportApi.single(currentPageId, 'png', 90, bilingual);
      const taskData = result.data?.data || result.data;
      const url = taskData?.download_url;
      if (url) {
        exportApi.downloadFile(url, taskData.filename || taskData.output_filename || 'export.png');
        message.success({ content: '导出完成！', key: MESSAGE_KEY });
      } else {
        message.warning({ content: '导出完成，但未获取到下载链接', key: MESSAGE_KEY });
      }
    } catch (err: any) {
      message.error({ content: `导出失败: ${err?.message || '未知错误'}`, key: MESSAGE_KEY });
    } finally {
      isExportingRef.current = false;
    }
  }, [currentPageId, message]);

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
      // 单页/双语导出：直接执行，不再只切换面板
      doSingleExport(type === 'bilingual');
    },
    [chapters, onSetBatchModalOpen, doSingleExport]
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
