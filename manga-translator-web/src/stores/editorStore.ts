/**
 * 编辑器状态管理
 * 管理画布、选区、操作历史等编辑工作台核心状态
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TextRegion, RegionBoundary, StyleConfig } from '@/types';

interface OperationRecord {
  type: string;
  pageId: string;
  beforeState: unknown;
  afterState: unknown;
  timestamp: string;
}

interface EditorState {
  // 编辑上下文
  currentProjectId: string | null;
  currentPageId: string | null;

  // 画布状态
  canvasScale: number;
  canvasPosition: { x: number; y: number };

  // 选区状态
  selectedRegionId: string | null;
  regions: TextRegion[];

  // 编辑模式
  mode: 'simple' | 'professional';
  activeStep: 'detect' | 'ocr' | 'translate' | 'inpaint' | 'render' | null;

  // 显示模式: original=原文 | translated=译文 | bilingual=双语叠加
  displayMode: 'original' | 'translated' | 'bilingual';
  showOriginal: boolean; // 兼容属性: displayMode === 'original'
  showRegions: boolean;  // §2.2.8: 一键隐藏/显示所有检测选区线

  // 操作历史
  history: OperationRecord[];
  historyIndex: number;

  // P0 FIX: 处理状态按 pageId 隔离，杜绝单页操作污染全局
  // 结构: { [pageId]: { isProcessing, processingStep, processingError, activeStep } }
  pageProcessingStates: Record<string, { isProcessing: boolean; processingStep: string | null; processingError: string | null; activeStep: string | null }>;

  // 计算属性
  canUndo: boolean;
  canRedo: boolean;

  // Actions
  setProject: (projectId: string) => void;
  setPage: (pageId: string) => void;
  setCanvasScale: (scale: number) => void;
  setCanvasPosition: (position: { x: number; y: number }) => void;
  selectRegion: (regionId: string | null) => void;
  setRegions: (regions: TextRegion[] | ((prev: TextRegion[]) => TextRegion[])) => void;
  updateRegion: (regionId: string, data: Partial<TextRegion>) => void;
  updateRegionBoundary: (regionId: string, boundary: RegionBoundary) => void;
  updateRegionStyle: (regionId: string, style: Partial<StyleConfig>) => void;
  setMode: (mode: 'simple' | 'professional') => void;
  setActiveStep: (step: EditorState['activeStep']) => void;
  toggleShowOriginal: () => void;
  setDisplayMode: (mode: 'original' | 'translated' | 'bilingual') => void;
  toggleShowRegions: () => void;
  pushHistory: (record: Omit<OperationRecord, 'timestamp'>) => void;
  undo: () => void;
  redo: () => void;
  /** P0 FIX: pageId-aware 处理状态设置，传入当前 pageId 以按页隔离 */
  setProcessing: (pageId: string, isProcessing: boolean, step?: string | null, error?: string | null) => void;
  /** P0 FIX: 获取当前 page 的处理状态（派生方法，便于组件读取） */
  getPageProcessing: (pageId: string | null) => { isProcessing: boolean; processingStep: string | null; processingError: string | null; activeStep: string | null };
  /** P0 FIX: 重置指定页面的处理状态（页面切换时调用） */
  resetPageProcessing: (pageId: string) => void;
  reset: () => void;
}

const MAX_HISTORY = 20;

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
  currentProjectId: null,
  currentPageId: null,

  canvasScale: 100,
  canvasPosition: { x: 0, y: 0 },

  selectedRegionId: null,
  regions: [],

  mode: 'professional',
  activeStep: null,

  displayMode: 'translated',
  showOriginal: false,
  showRegions: true,  // §2.2.8: 默认显示检测选区线

  history: [],
  historyIndex: -1,

  // P0 FIX: 处理状态按 pageId 隔离，初始为空 map
  pageProcessingStates: {},

  // 计算属性由 useEditorStore 的 selector 在组件层计算
  canUndo: false,
  canRedo: false,

  setProject: (projectId) => set({ currentProjectId: projectId }),

  setPage: (pageId) => set({ currentPageId: pageId, selectedRegionId: null }),

  setCanvasScale: (scale) => set({ canvasScale: scale }),

  setCanvasPosition: (position) => set({ canvasPosition: position }),

  selectRegion: (regionId) => set({ selectedRegionId: regionId }),

  setRegions: (regionsOrUpdater) =>
    set((state) => ({
      regions:
        typeof regionsOrUpdater === 'function'
          ? (regionsOrUpdater as (prev: TextRegion[]) => TextRegion[])(state.regions)
          : regionsOrUpdater,
    })),

  updateRegion: (regionId, data) =>
    set((state) => ({
      regions: state.regions.map((r) =>
        r.region_id === regionId ? { ...r, ...data } : r
      ),
    })),

  updateRegionBoundary: (regionId, boundary) =>
    set((state) => ({
      regions: state.regions.map((r) =>
        r.region_id === regionId ? { ...r, boundary } : r
      ),
    })),

  updateRegionStyle: (regionId, style) =>
    set((state) => ({
      regions: state.regions.map((r) =>
        r.region_id === regionId
          ? { ...r, style_config: { ...r.style_config, ...style } as StyleConfig }
          : r
      ),
    })),

  setMode: (mode) => set({ mode }),

  setActiveStep: (step) => set({ activeStep: step }),

  /** §2.7.1 / 附录A: Ctrl+B 循环切换 原文 → 译文 → 双语，双语模式下强制显示选区线 */
  toggleShowOriginal: () => set((state) => {
    const next = state.displayMode === 'translated' ? 'original'
      : state.displayMode === 'original' ? 'bilingual'
      : 'translated';
    // 切换到双语模式时强制显示选区线，否则看不到叠加的原文文字
    return { displayMode: next, showOriginal: next === 'original', showRegions: next === 'bilingual' ? true : state.showRegions };
  }),
  setDisplayMode: (mode: 'original' | 'translated' | 'bilingual') =>
    set({ displayMode: mode, showOriginal: mode === 'original', showRegions: mode === 'bilingual' ? true : undefined }),
  toggleShowRegions: () => set((state) => ({ showRegions: !state.showRegions })),

  pushHistory: (record) =>
    set((state) => {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push({ ...record, timestamp: new Date().toISOString() });
      // 限制历史记录数量
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }
      return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    }),

  undo: () =>
    set((state) => {
      if (state.historyIndex < 0) return state;
      const record = state.history[state.historyIndex];
      // 应用beforeState
      if (record.type === 'region_update' && record.beforeState) {
        return {
          historyIndex: state.historyIndex - 1,
          regions: record.beforeState as TextRegion[],
        };
      }
      return { historyIndex: state.historyIndex - 1 };
    }),

  redo: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state;
      const record = state.history[state.historyIndex + 1];
      if (record.type === 'region_update' && record.afterState) {
        return {
          historyIndex: state.historyIndex + 1,
          regions: record.afterState as TextRegion[],
        };
      }
      return { historyIndex: state.historyIndex + 1 };
    }),

  /** P0 FIX: pageId-aware 处理状态设置，同时更新全局 activeStep 保持兼容 */
  setProcessing: (pageId, isProcessing, step = null, error = null) =>
    set((state) => {
      const prev = state.pageProcessingStates[pageId] || { isProcessing: false, processingStep: null, processingError: null, activeStep: null };
      return {
        // P0 FIX v2: 同时更新全局 activeStep（保留向后兼容）和 per-page activeStep
        activeStep: step,
        pageProcessingStates: {
          ...state.pageProcessingStates,
          [pageId]: {
            isProcessing,
            processingStep: step,
            processingError: error,
            // 处理中保持当前step，处理完成保留最后的activeStep
            activeStep: isProcessing ? step : (prev.activeStep || null),
          },
        },
      };
    }),

  /** P0 FIX: 获取指定 page 的独立处理状态，回退到默认值 */
  getPageProcessing: (pageId) => {
    const state = get();
    if (!pageId) return { isProcessing: false, processingStep: null, processingError: null, activeStep: null };
    return state.pageProcessingStates[pageId] || { isProcessing: false, processingStep: null, processingError: null, activeStep: null };
  },

  /** P0 FIX v2: 重置指定页面的处理状态，页面切换时调用 */
  resetPageProcessing: (pageId) =>
    set((state) => ({
      pageProcessingStates: {
        ...state.pageProcessingStates,
        [pageId]: { isProcessing: false, processingStep: null, processingError: null, activeStep: null },
      },
    })),

  reset: () =>
    set({
      currentProjectId: null,
      currentPageId: null,
      canvasScale: 100,
      canvasPosition: { x: 0, y: 0 },
      selectedRegionId: null,
      regions: [],
      mode: 'professional',
      activeStep: null,
      displayMode: 'translated',
      showOriginal: false,
      showRegions: true,
      history: [],
      historyIndex: -1,
      pageProcessingStates: {},
    }),
    }),
    {
      name: 'manga-editor-ui',
      partialize: (state) => ({ mode: state.mode }),
    }
  )
);
