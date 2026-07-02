'use client';

/**
 * useRegionOperations - 选区操作 Hook
 * 封装选区删除/锁定/样式应用/批量操作，供 PC 编辑器页面使用
 *
 * v2 像素坐标系: EditorRegion.x/y/w/h 已是原始像素坐标，无需百分比转换
 */
import { useCallback } from 'react';
import { message } from 'antd';
import type { TextRegion, PageData } from '@/types';
import type { EditorRegion, StyleConfig } from '@/components/editor/types';
import { DEFAULT_STYLE } from '@/components/editor/types';
import { percentToPixelRegion, getPageDimensions, isValidDimensions } from '@/utils/coords';

/** 计算点集的凸包（Andrew monotone chain），返回逆时针顶点序列 */
function convexHull(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length <= 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** 顶点集的轴对齐包围盒 */
function bboxOf(points: [number, number][]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

interface UseRegionOperationsOptions {
  regions: TextRegion[];
  setRegions: (regions: TextRegion[]) => void;
  currentPageId: string | null;
  currentPageData: PageData | null;
  selectedRegionId: string | null;
  selectRegion: (id: string | null) => void;
  updateRegion: (regionId: string, data: Partial<TextRegion>) => void;
}

export function useRegionOperations({
  regions,
  setRegions,
  currentPageId,
  currentPageData,
  selectedRegionId,
  selectRegion,
  updateRegion,
}: UseRegionOperationsOptions) {

  /** 删除选区 */
  const handleDeleteRegion = useCallback(
    (regionId: string) => {
      setRegions(regions.filter((r) => r.region_id !== regionId) as TextRegion[]);
      if (selectedRegionId === regionId) {
        selectRegion(null);
      }
      message.success('已删除选区');
    },
    [regions, setRegions, selectedRegionId, selectRegion]
  );

  /** 切换锁定 */
  const handleToggleLock = useCallback(
    (regionId: string) => {
      const region = regions.find((r) => r.region_id === regionId);
      if (region) {
        updateRegion(regionId, { is_locked: !region.is_locked });
      }
    },
    [regions, updateRegion]
  );

  /** 应用样式到所有选区 */
  const handleApplyAll = useCallback(
    (regionId: string) => {
      const source = regions.find((r) => r.region_id === regionId);
      if (!source?.style_config) return;
      const updated = regions.map((r) => ({
        ...r,
        style_config: { ...source.style_config } as TextRegion['style_config'],
      }));
      setRegions(updated as TextRegion[]);
      message.success('样式已应用到所有选区');
    },
    [regions, setRegions]
  );

  /** 单选区应用样式 */
  const handleApplyStyle = useCallback(
    (regionId: string, style: StyleConfig) => {
      updateRegion(regionId, { style_config: style } as Partial<TextRegion>);
    },
    [updateRegion]
  );

  /** 批量应用样式 */
  const handleBatchApplyStyle = useCallback(
    (regionIds: string[], style: StyleConfig) => {
      const updated = regions.map((r) =>
        regionIds.includes(r.region_id)
          ? { ...r, style_config: { ...style } as TextRegion['style_config'] }
          : r
      );
      setRegions(updated as TextRegion[]);
    },
    [regions, setRegions]
  );

  /** 在画布坐标处创建新选区（v2: x,y 为原始像素坐标） */
  const handleCreateRegionAt = useCallback(
    (x: number, y: number) => {
      if (!currentPageId) return null;
      const dims = getPageDimensions(currentPageData);
      if (!isValidDimensions(dims)) {
        message.warning('页面数据未加载，无法创建选区');
        return null;
      }

      const { width: bw, height: bh } = dims;
      const newRegion: TextRegion = {
        region_id: `new_${Date.now()}`,
        page_id: currentPageId,
        type: 'speech' as const,
        boundary: {
          // v2: x, y 已是像素坐标，直接使用；默认宽高取页面尺寸的 10%
          x,
          y,
          width: bw * 0.1,
          height: bh * 0.1,
        },
        original_text: '',
        translated_text: '',
        confidence: 1,
        is_locked: false,
        style_config: { ...DEFAULT_STYLE },
        sort_order: regions.length + 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setRegions([...(regions as TextRegion[]), newRegion] as TextRegion[]);
      selectRegion(newRegion.region_id);
      return newRegion.region_id;
    },
    [currentPageId, currentPageData, regions, setRegions, selectRegion]
  );

  /**
   * 处理画布区域移动/缩放更新
   * v2: EditorRegion.x/y/w/h 已是像素坐标，percentToPixelRegion 直接透传
   */
  const handleCanvasUpdateRegion = useCallback(
    (regionId: string, data: Partial<EditorRegion>) => {
      const region = regions.find((r) => r.region_id === regionId);
      if (!region) return;

      const dims = getPageDimensions(currentPageData);
      if (!isValidDimensions(dims)) {
        console.warn('[useRegionOperations] 页面尺寸无效，无法更新选区坐标');
        return;
      }

      // BUG FIX P1: 使用统一工具进行百分比→像素转换
      try {
        const updatedData = percentToPixelRegion(
          { ...data, region_id: regionId },
          dims
        );
        // 保留原始 region 的非坐标字段；§2.2.8: 同步多边形顶点与包围模式
        const merged: Partial<TextRegion> = {
          ...region,
          boundary: updatedData.boundary || region.boundary,
        };
        if (updatedData.boundary_mode != null) {
          merged.boundary_mode = updatedData.boundary_mode;
        }
        updateRegion(regionId, merged);
      } catch (err: any) {
        console.error('[useRegionOperations] 坐标转换失败:', err.message);
      }
    },
    [regions, currentPageData, updateRegion]
  );

  /**
   * §2.2.4 选区合并：将多个选区合并为一个（取并集包围盒 / 多边形凸包）
   * 保留第一个选区的文本与样式，删除其余选区。
   */
  const handleMergeRegions = useCallback(
    (regionIds: string[]) => {
      if (regionIds.length < 2) {
        message.warning('请至少选择 2 个选区进行合并');
        return;
      }
      const targets = regions.filter((r) => regionIds.includes(r.region_id));
      if (targets.length < 2) return;

      // 收集所有顶点（多边形用 points，矩形用四角），计算凸包作为合并轮廓
      const pts: [number, number][] = [];
      for (const r of targets) {
        const b = r.boundary;
        const p = b?.points;
        if (Array.isArray(p) && p.length >= 3) {
          pts.push(...(p as [number, number][]));
        } else {
          const x = b?.x ?? 0, y = b?.y ?? 0, w = b?.width ?? 0, h = b?.height ?? 0;
          pts.push([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
        }
      }
      const hull = convexHull(pts);
      const bb = bboxOf(hull);
      const primary = targets[0];
      const mergedText = targets.map((r) => r.original_text).filter(Boolean).join(' ');
      const mergedTrans = targets.map((r) => r.translated_text).filter(Boolean).join(' ');

      const next = regions
        .filter((r) => !regionIds.includes(r.region_id) || r.region_id === primary.region_id)
        .map((r) =>
          r.region_id === primary.region_id
            ? {
                ...r,
                boundary: { x: bb.x, y: bb.y, width: bb.w, height: bb.h, points: hull },
                boundary_mode: 'polygon' as const,
                original_text: mergedText || r.original_text,
                translated_text: mergedTrans || r.translated_text,
              }
            : r
        );
      setRegions(next as TextRegion[]);
      selectRegion(primary.region_id);
      message.success(`已合并 ${targets.length} 个选区`);
    },
    [regions, setRegions, selectRegion]
  );

  /**
   * §2.2.4 选区拆分：沿垂直中线把一个矩形/多边形选区拆成左右两个。
   */
  const handleSplitRegion = useCallback(
    (regionId: string) => {
      const region = regions.find((r) => r.region_id === regionId);
      if (!region) return;
      const b = region.boundary;
      const x = b?.x ?? 0, y = b?.y ?? 0, w = b?.width ?? 0, h = b?.height ?? 0;
      if (w < 4) {
        message.warning('选区太窄，无法拆分');
        return;
      }
      const midX = x + w / 2;
      const left: TextRegion = {
        ...region,
        region_id: `new_${Date.now()}_L`,
        boundary: { x, y, width: w / 2, height: h },
        boundary_mode: 'rect',
        translated_text: '',
        sort_order: region.sort_order,
      } as TextRegion;
      const right: TextRegion = {
        ...region,
        region_id: `new_${Date.now()}_R`,
        boundary: { x: midX, y, width: w / 2, height: h },
        boundary_mode: 'rect',
        translated_text: '',
        sort_order: region.sort_order + 1,
      } as TextRegion;
      // 清理多边形顶点（拆分后回退矩形）
      delete (left.boundary as any).points;
      delete (right.boundary as any).points;

      const next = regions.flatMap((r) => (r.region_id === regionId ? [left, right] : [r]));
      setRegions(next as TextRegion[]);
      selectRegion(left.region_id);
      message.success('已拆分为 2 个选区');
    },
    [regions, setRegions, selectRegion]
  );

  /**
   * §2.2.8 矩形 → 多边形：用矩形四角初始化顶点，便于贴合气泡内轮廓精修。
   */
  const handleConvertToPolygon = useCallback(
    (regionId: string) => {
      const region = regions.find((r) => r.region_id === regionId);
      if (!region) return;
      const b = region.boundary;
      const existing = b?.points;
      if (Array.isArray(existing) && existing.length >= 3) return; // 已是多边形
      const x = b?.x ?? 0, y = b?.y ?? 0, w = b?.width ?? 0, h = b?.height ?? 0;
      // 生成八边形（四角+四边中点），给用户更多可贴合内轮廓的节点
      const points: [number, number][] = [
        [x, y], [x + w / 2, y], [x + w, y],
        [x + w, y + h / 2], [x + w, y + h],
        [x + w / 2, y + h], [x, y + h], [x, y + h / 2],
      ];
      updateRegion(regionId, {
        boundary: { x, y, width: w, height: h, points },
        boundary_mode: 'polygon',
      } as Partial<TextRegion>);
      message.success('已转为多边形，可拖拽顶点贴合气泡内轮廓');
    },
    [regions, updateRegion]
  );

  /** §2.2.8 多边形 → 矩形：用包围盒回退，清除顶点。 */
  const handleConvertToRect = useCallback(
    (regionId: string) => {
      const region = regions.find((r) => r.region_id === regionId);
      if (!region) return;
      const b = region.boundary;
      const newBoundary: any = { x: b?.x ?? 0, y: b?.y ?? 0, width: b?.width ?? 0, height: b?.height ?? 0 };
      updateRegion(regionId, {
        boundary: newBoundary,
        boundary_mode: 'rect',
      } as Partial<TextRegion>);
      message.success('已转为矩形选区');
    },
    [regions, updateRegion]
  );

  return {
    handleDeleteRegion,
    handleToggleLock,
    handleApplyAll,
    handleApplyStyle,
    handleBatchApplyStyle,
    handleCreateRegionAt,
    handleCanvasUpdateRegion,
    handleMergeRegions,
    handleSplitRegion,
    handleConvertToPolygon,
    handleConvertToRect,
  };
}