/**
 * 选区自动保存 Hook
 * 300ms 防抖自动保存 regions 到后端
 */
import { useCallback, useEffect, useRef } from 'react';
import { pageApi } from '@/services/page';
import type { TextRegion } from '@/types';

interface UseAutoSaveOptions {
  currentPageId: string | null;
  /** 获取最新的 regions（通过ref避免闭包陷阱） */
  getRegions: () => TextRegion[];
}

/** 清理前端临时状态字段，避免发到后端导致 ORM 报错（如 glyph_status/glyph_missing_count） */
function cleanRegionPayload(region: TextRegion): TextRegion {
  const { glyph_status, glyph_missing_count, ...rest } = region as any;
  return rest as TextRegion;
}

export function useAutoSave({ currentPageId, getRegions }: UseAutoSaveOptions) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getCleanRegions = useCallback(
    () => getRegions().map(cleanRegionPayload),
    [getRegions]
  );

  /** 触发防抖自动保存 */
  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!currentPageId) return;
      try {
        await pageApi.updateRegions(currentPageId, getCleanRegions());
      } catch {
        // 静默失败：自动保存不需要弹窗
      }
    }, 300);
  }, [currentPageId, getCleanRegions]);

  /** 手动即时保存 */
  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!currentPageId) return;
    try {
      await pageApi.updateRegions(currentPageId, getCleanRegions());
      return true;
    } catch {
      return false;
    }
  }, [currentPageId, getCleanRegions]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { debouncedSave, saveNow };
}
