/**
 * 统一坐标系工具
 *
 * 核心设计原则（v2 像素坐标系架构）：
 * 1. 后端存储的坐标始终是原始图像像素坐标 (boundary: {x, y, width, height})
 * 2. 前端 EditorRegion 直接透传像素坐标，不转百分比
 * 3. 渲染时由 RegionOverlay 按 scale 计算实际像素位置：renderedX = boundary.x * scale/100
 * 4. transform-origin 统一为 0 0（左上角），确保图片与文本框缩放同步
 */

import type { TextRegion } from '@/types';
import type { EditorRegion } from '@/components/editor/types';
import { DEFAULT_STYLE } from '@/components/editor/types';

export interface PageDimensions {
  width: number;
  height: number;
}

/**
 * 验证页面尺寸是否有效（非零、非负、非缺失）
 */
export function isValidDimensions(dims: PageDimensions | null | undefined): dims is PageDimensions {
  return !!dims && dims.width > 0 && dims.height > 0;
}

/**
 * 将后端像素坐标的 TextRegion 转换为前端像素坐标的 EditorRegion（直接透传，不转百分比）
 * @param region 后端原始区域数据（boundary 为像素坐标）
 * @param dims   页面真实尺寸 {width, height}（仅用于校验）
 * @returns       带像素坐标的 EditorRegion
 * @throws        如果 dims 无效，抛出错误（禁止使用默认值）
 */
export function pixelToPercentRegion(region: TextRegion, dims: PageDimensions | null | undefined): EditorRegion {
  if (!isValidDimensions(dims)) {
    throw new Error(
      `[coords] pixelToPercentRegion: 无效的页面尺寸，` +
      '无法进行坐标转换。请确保 currentPageData 已加载且 width/height 有效。'
    );
  }

  // v2: 直接透传像素坐标，不除以页面尺寸转为百分比
  const bx = region.boundary?.x ?? 0;
  const by = region.boundary?.y ?? 0;
  const bw = region.boundary?.width ?? 100;
  const bh = region.boundary?.height ?? 100;

  // §2.2.8: 多边形/贝塞尔顶点透传（像素坐标）。后端检测存 boundary.polygon，编辑器存 boundary.points
  const rawPts = (region.boundary as any)?.points ?? (region.boundary as any)?.polygon;
  const points = Array.isArray(rawPts) && rawPts.length >= 3
    ? (rawPts as [number, number][])
    : undefined;

  // P0 FIX: 绝对不要重新生成 region_id！否则 detect→OCR→translate 的 ID 匹配全部失效
  const existingId = region.region_id;
  const safeRegionId = (existingId && existingId !== 'None' && String(existingId).length >= 10)
    ? String(existingId)
    : (region as any).id ?? (region as any)._id ?? null;
  
  if (!safeRegionId) {
    console.warn('[coords] pixelToPercentRegion: region has no valid region_id, generating fallback', region);
  }

  return {
    ...region,
    x: bx,
    y: by,
    w: bw,
    h: bh,
    points,
    boundary_mode: (region as any).boundary_mode
      ?? (points ? 'polygon' : 'rect'),
    region_id: safeRegionId || `region-${crypto.randomUUID()}`,
    style_config: region.style_config || { ...DEFAULT_STYLE },
  };
}

/**
 * 将前端像素坐标的 EditorRegion 转回后端像素坐标的 TextRegion（v2: x/y/w/h 已是像素值，直接透传）
 * @param region 前端 EditorRegion（x/y/w/h 为原始像素坐标）
 * @param dims   页面真实尺寸 {width, height}
 * @returns       带像素 boundary 的 TextRegion
 */
export function percentToPixelRegion(
  region: Partial<EditorRegion> & { region_id: string },
  dims: PageDimensions
): Partial<TextRegion> {
  if (!isValidDimensions(dims)) {
    throw new Error('[coords] percentToPixelRegion: 无效的页面尺寸');
  }

  const result: Partial<TextRegion> = { ...region } as any;

  // v2: x/y/w/h 已经是像素值，直接转为 boundary，不需要除以 100 再乘页面尺寸
  if (region.x != null || region.y != null || region.w != null || region.h != null || region.points != null) {
    const points = (region as any).points as [number, number][] | undefined;
    result.boundary = {
      x: region.x ?? (region as any).boundary?.x ?? 0,
      y: region.y ?? (region as any).boundary?.y ?? 0,
      width: region.w ?? (region as any).boundary?.width ?? 100,
      height: region.h ?? (region as any).boundary?.height ?? 100,
      // §2.2.8: 多边形/贝塞尔顶点随 boundary 持久化
      ...(Array.isArray(points) && points.length >= 3 ? { points } : {}),
    };
  }

  // §2.2.8: 同步包围模式
  if (region.boundary_mode != null) {
    result.boundary_mode = region.boundary_mode;
  }

  // 清理前端专用字段（后端不需要）
  delete (result as any).x;
  delete (result as any).y;
  delete (result as any).w;
  delete (result as any).h;
  delete (result as any).points;

  return result;
}

/**
 * 将后端 detect API 返回的 bbox 数组转为 boundary 对象并转换为 EditorRegion
 * @param rawRegion 后端 detect API 原始返回（含 bbox: [x,y,w,h] 或 boundary）
 * @param dims      页面真实尺寸
 */
export function normalizeDetectRegion(
  rawRegion: any,
  dims: PageDimensions
): EditorRegion {
  // 统一 boundary
  let boundary: { x: number; y: number; width: number; height: number };
  const bbox = rawRegion.bbox;
  if (!rawRegion.boundary && bbox && Array.isArray(bbox) && bbox.length >= 4) {
    boundary = { x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3] };
  } else if (rawRegion.boundary) {
    boundary = rawRegion.boundary;
  } else {
    // 无坐标数据 — 返回一个安全默认区域（页面中心 10%）
    boundary = { x: dims.width * 0.45, y: dims.height * 0.45, width: dims.width * 0.1, height: dims.height * 0.1 };
  }

  const region: TextRegion = {
    ...rawRegion,
    boundary,
    page_id: rawRegion.page_id || '',
    type: rawRegion.type || 'speech',
    is_locked: rawRegion.is_locked ?? false,
    sort_order: rawRegion.sort_order ?? 0,
    original_text: rawRegion.original_text || '',
    translated_text: rawRegion.translated_text || '',
    confidence: rawRegion.confidence ?? null,
    style_config: rawRegion.style_config || { ...DEFAULT_STYLE },
    created_at: rawRegion.created_at || new Date().toISOString(),
    updated_at: rawRegion.updated_at || new Date().toISOString(),
  };

  return pixelToPercentRegion(region, dims);
}

/**
 * 批量转换 — 后端像素坐标 → 前端像素坐标（v2: 直接透传，不转百分比）
 */
export function batchPixelToPercent(
  regions: TextRegion[],
  dims: PageDimensions
): EditorRegion[] {
  if (!isValidDimensions(dims)) {
    console.error('[coords] batchPixelToPercent: 无效的页面尺寸，拒绝转换');
    return [];
  }
  return regions.map((r) => pixelToPercentRegion(r, dims));
}

/**
 * 从页面数据中提取页面尺寸
 */
export function getPageDimensions(pageData: any): PageDimensions | null {
  if (!pageData) return null;
  const w = pageData.width;
  const h = pageData.height;
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
    return { width: w, height: h };
  }
  return null;
}
