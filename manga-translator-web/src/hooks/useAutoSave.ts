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

export function useAutoSave({ currentPageId, getRegions }: UseAutoSaveOptions) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 触发防抖自动保存 */
  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!currentPageId) return;
      try {
        await pageApi.updateRegions(currentPageId, getRegions());
      } catch {
        // 静默失败：自动保存不需要弹窗
      }
    }, 300);
  }, [currentPageId, getRegions]);

  /** 手动即时保存 */
  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!currentPageId) return;
    try {
      await pageApi.updateRegions(currentPageId, getRegions());
      return true;
    } catch {
      return false;
    }
  }, [currentPageId, getRegions]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { debouncedSave, saveNow };
}
