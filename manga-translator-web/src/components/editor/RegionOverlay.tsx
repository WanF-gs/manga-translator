'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Tooltip } from 'antd';
import type { EditorRegion } from './types';
import { REGION_TYPE_CONFIGS } from './types';
import type { RegionType } from '@/types';

interface RegionOverlayProps {
  regions: EditorRegion[];
  selectedRegionId: string | null;
  showOriginal: boolean;
  scalePercent: number;
  /** 基准图像像素宽度 (= img.naturalWidth, 与容器基底一致) */
  imageWidth: number;
  /** 基准图像像素高度 (img.naturalHeight, 与容器基底一致) */
  imageHeight: number;
  /** 坐标缩放因子：后端API坐标空间 → 图片自然像素空间的缩放比 (naturalW / apiW) */
  coordScale?: number;
  onSelect: (regionId: string | null) => void;
  onUpdateRegion?: (regionId: string, data: Partial<EditorRegion>) => void;
}

type DragMode = 'none' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w';

/** 计算多边形顶点的轴对齐包围盒 */
function bboxOfPoints(points: [number, number][]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/**
 * §2.2.8 多边形选区（贴合气泡内轮廓 / 文字紧密包围）
 * 支持：整体拖拽移动、顶点拖拽、中点插入新顶点、双击删除顶点（≥3）
 */
const PolygonRegion = React.memo(function PolygonRegion({
  region,
  isSelected,
  showOriginal,
  scalePercent,
  imageWidth,
  imageHeight,
  coordScale,
  onSelect,
  onUpdateRegion,
}: {
  region: EditorRegion;
  isSelected: boolean;
  showOriginal: boolean;
  scalePercent: number;
  imageWidth: number;
  imageHeight: number;
  coordScale: number;
  onSelect: (id: string | null) => void;
  onUpdateRegion?: (regionId: string, data: Partial<EditorRegion>) => void;
}) {
  const config = REGION_TYPE_CONFIGS[region.type as RegionType] ?? REGION_TYPE_CONFIGS.speech;
  const isLocked = region.is_locked;
  const isLowConfidence = region.confidence != null && region.confidence < 0.6;
  const displayScale = (scalePercent / 100) * coordScale;
  const points = region.points ?? [];

  // 拖拽状态：'poly' 整体移动 / 数字索引=顶点
  const dragRef = useRef<{ mode: 'none' | 'poly' | number; x: number; y: number; snapshot: [number, number][] }>({
    mode: 'none', x: 0, y: 0, snapshot: [],
  });

  const commitPoints = useCallback(
    (next: [number, number][]) => {
      if (!onUpdateRegion) return;
      const bb = bboxOfPoints(next);
      onUpdateRegion(region.region_id, {
        points: next,
        boundary_mode: 'polygon',
        x: bb.x, y: bb.y, w: bb.w, h: bb.h,
      });
    },
    [onUpdateRegion, region.region_id]
  );

  const onVertexDown = useCallback((e: React.PointerEvent, idx: number | 'poly') => {
    if (isLocked) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: idx === 'poly' ? 'poly' : (idx as number),
      x: e.clientX, y: e.clientY,
      snapshot: points.map((p) => [p[0], p[1]] as [number, number]),
    };
  }, [isLocked, points]);

  const onVertexMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.mode === 'none' || !onUpdateRegion) return;
    const dx = (e.clientX - d.x) / displayScale;
    const dy = (e.clientY - d.y) / displayScale;
    let next: [number, number][];
    if (d.mode === 'poly') {
      next = d.snapshot.map(([px, py]) => [
        Math.max(0, Math.min(imageWidth, px + dx)),
        Math.max(0, Math.min(imageHeight, py + dy)),
      ] as [number, number]);
    } else {
      next = d.snapshot.map((p) => [p[0], p[1]] as [number, number]);
      next[d.mode] = [
        Math.max(0, Math.min(imageWidth, d.snapshot[d.mode][0] + dx)),
        Math.max(0, Math.min(imageHeight, d.snapshot[d.mode][1] + dy)),
      ];
    }
    commitPoints(next);
  }, [onUpdateRegion, displayScale, imageWidth, imageHeight, commitPoints]);

  const onVertexUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current.mode !== 'none') {
      e.stopPropagation();
      dragRef.current.mode = 'none';
    }
  }, []);

  /** 在边 (i, i+1) 中点插入新顶点 */
  const insertVertex = useCallback((edgeIdx: number) => {
    if (isLocked || points.length < 3) return;
    const a = points[edgeIdx];
    const b = points[(edgeIdx + 1) % points.length];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const next = [...points];
    next.splice(edgeIdx + 1, 0, mid);
    commitPoints(next);
  }, [isLocked, points, commitPoints]);

  /** 删除顶点（保持 ≥3） */
  const removeVertex = useCallback((idx: number) => {
    if (isLocked || points.length <= 3) return;
    const next = points.filter((_, i) => i !== idx);
    commitPoints(next);
  }, [isLocked, points, commitPoints]);

  if (points.length < 3) return null;

  const svgW = imageWidth * displayScale;
  const svgH = imageHeight * displayScale;
  const ptsAttr = points.map(([px, py]) => `${px * displayScale},${py * displayScale}`).join(' ');
  const strokeColor = isSelected ? '#3B82F6' : isLowConfidence ? '#EF4444' : config.color;
  const bb = bboxOfPoints(points);
  const text = showOriginal ? region.original_text : region.translated_text;

  return (
    <svg
      className="absolute top-0 left-0 overflow-visible"
      width={svgW}
      height={svgH}
      style={{ pointerEvents: 'none' }}
    >
      {/* 多边形主体：半透明填充（默认30%），不遮挡下方画面细节 [§2.2.8] */}
      <polygon
        points={ptsAttr}
        fill={strokeColor}
        fillOpacity={isSelected ? 0.22 : 0.14}
        stroke={strokeColor}
        strokeWidth={Math.max(1.5, 2 / (scalePercent / 100)) * coordScale}
        strokeDasharray={isLocked ? '6 4' : undefined}
        style={{ pointerEvents: 'auto', cursor: isLocked ? 'not-allowed' : 'move' }}
        onClick={(e) => { e.stopPropagation(); onSelect(isSelected ? null : region.region_id); }}
        onPointerDown={(e) => onVertexDown(e, 'poly')}
        onPointerMove={onVertexMove}
        onPointerUp={onVertexUp}
      />

      {/* 类型标签（贴包围盒左上角） */}
      <foreignObject x={bb.x * displayScale} y={bb.y * displayScale - 18} width={90} height={18} style={{ pointerEvents: 'none' }}>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap text-white shadow-sm max-w-[80px] truncate inline-block"
          style={{ backgroundColor: strokeColor, opacity: isSelected ? 1 : 0.85 }}
        >
          {config.label}▱{isLocked && ' 🔒'}
        </span>
      </foreignObject>

      {/* 文字预览（居中于包围盒） */}
      {text && (
        <foreignObject
          x={bb.x * displayScale} y={bb.y * displayScale}
          width={bb.w * displayScale} height={bb.h * displayScale}
          style={{ pointerEvents: 'none' }}
        >
          <div className="w-full h-full flex items-center justify-center p-1 overflow-hidden">
            <span className="text-center leading-tight line-clamp-2 select-none"
              style={{ color: region.style_config?.color ?? '#1e293b', fontSize: `${Math.max(8, (region.style_config?.font_size ?? 14) * (scalePercent / 100))}px` }}>
              {text}
            </span>
          </div>
        </foreignObject>
      )}

      {/* 选中且未锁定：中点“加点”手柄 + 顶点手柄 */}
      {isSelected && !isLocked && (
        <>
          {points.map((a, i) => {
            const b = points[(i + 1) % points.length];
            const mx = ((a[0] + b[0]) / 2) * displayScale;
            const my = ((a[1] + b[1]) / 2) * displayScale;
            return (
              <circle
                key={`mid-${i}`}
                cx={mx} cy={my} r={4}
                fill="#fff" stroke="#3B82F6" strokeWidth={1.5}
                style={{ pointerEvents: 'auto', cursor: 'copy' }}
                onPointerDown={(e) => { e.stopPropagation(); insertVertex(i); }}
              >
                <title>点击插入顶点</title>
              </circle>
            );
          })}
          {points.map(([px, py], i) => (
            <circle
              key={`v-${i}`}
              cx={px * displayScale} cy={py * displayScale} r={5.5}
              fill="#3B82F6" stroke="#fff" strokeWidth={2}
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
              onPointerDown={(e) => onVertexDown(e, i)}
              onPointerMove={onVertexMove}
              onPointerUp={onVertexUp}
              onDoubleClick={(e) => { e.stopPropagation(); removeVertex(i); }}
            >
              <title>拖拽移动顶点 · 双击删除</title>
            </circle>
          ))}
        </>
      )}
    </svg>
  );
});

/** 单个选区矩形（含拖拽移动 + 缩放手柄），使用 React.memo 减少重渲染 */
const RegionRect = React.memo(function RegionRect({
  region,
  isSelected,
  showOriginal,
  scalePercent,
  imageWidth,
  imageHeight,
  coordScale,
  onSelect,
  onUpdateRegion,
}: {
  region: EditorRegion;
  isSelected: boolean;
  showOriginal: boolean;
  scalePercent: number;
  imageWidth: number;
  imageHeight: number;
  coordScale: number;
  onSelect: (id: string | null) => void;
  onUpdateRegion?: (regionId: string, data: Partial<EditorRegion>) => void;
}) {
  const config = REGION_TYPE_CONFIGS[region.type as RegionType] ?? REGION_TYPE_CONFIGS.speech;
  const text = showOriginal ? region.original_text : region.translated_text;
  const fontSize = region.style_config?.font_size ?? 14;
  const fontColor = region.style_config?.color ?? '#1e293b';
  const isLocked = region.is_locked;
  const borderWidth = Math.max(3, 6 / (scalePercent / 100));

  // 低置信度警告
  const isLowConfidence = region.confidence != null && region.confidence < 0.6;

  // 统一坐标系: displayScale 将自然像素坐标转为屏幕渲染像素
  // renderedX = originalX × (renderedWidth / originalWidth) = originalX × displayScale
  // coordScale: 后端API坐标 → 图片自然像素的缩放因子
  const displayScale = (scalePercent / 100) * coordScale;

  // 拖拽/缩放状态
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const dragStart = useRef({ x: 0, y: 0, rx: 0, ry: 0, rw: 0, rh: 0 });
  const rectRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      if (isLocked) return;
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragMode(mode);
      dragStart.current = { x: e.clientX, y: e.clientY, rx: region.x, ry: region.y, rw: region.w, rh: region.h };
    },
    [isLocked, region]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragMode === 'none' || !onUpdateRegion) return;
      // 鼠标位移（屏幕像素）÷ (displayScale) = 原始API坐标位移
      const dx = (e.clientX - dragStart.current.x) / ((scalePercent / 100) * coordScale);
      const dy = (e.clientY - dragStart.current.y) / ((scalePercent / 100) * coordScale);

      const { rx, ry, rw, rh } = dragStart.current;
      let newX = rx, newY = ry, newW = rw, newH = rh;

      switch (dragMode) {
        case 'move':
          newX = Math.max(0, Math.min(imageWidth - rw, rx + dx));
          newY = Math.max(0, Math.min(imageHeight - rh, ry + dy));
          break;
        case 'resize-nw': newX = Math.max(0, rx + dx); newY = Math.max(0, ry + dy); newW = Math.max(2, rw - dx); newH = Math.max(2, rh - dy); break;
        case 'resize-ne': newY = Math.max(0, ry + dy); newW = Math.max(2, rw + dx); newH = Math.max(2, rh - dy); break;
        case 'resize-sw': newX = Math.max(0, rx + dx); newW = Math.max(2, rw - dx); newH = Math.max(2, rh + dy); break;
        case 'resize-se': newW = Math.max(2, rw + dx); newH = Math.max(2, rh + dy); break;
        case 'resize-n': newY = Math.max(0, ry + dy); newH = Math.max(2, rh - dy); break;
        case 'resize-s': newH = Math.max(2, rh + dy); break;
        case 'resize-e': newW = Math.max(2, rw + dx); break;
        case 'resize-w': newX = Math.max(0, rx + dx); newW = Math.max(2, rw - dx); break;
      }

      onUpdateRegion(region.region_id, { x: newX, y: newY, w: newW, h: newH });
    },
    [dragMode, onUpdateRegion, region.region_id, scalePercent, coordScale, imageWidth, imageHeight]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragMode !== 'none') {
        e.stopPropagation();
        setDragMode('none');
      }
    },
    [dragMode]
  );

  const handleSize = 8;

  return (
    <>
      {/* 选区矩形 */}
      <div
        ref={rectRef}
        onClick={(e) => {
          if (dragMode !== 'none') return;
          e.stopPropagation();
          onSelect(isSelected ? null : region.region_id);
        }}
        onPointerDown={(e) => handlePointerDown(e, 'move')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={clsx(
          'absolute rounded-md transition-all duration-150',
          config.bg,
          isSelected
            ? 'ring-2 ring-primary-500 ring-offset-1 z-10 shadow-lg'
            : 'hover:ring-1 hover:ring-primary-300',
          isLowConfidence && isSelected && 'animate-pulse',
          !isLocked && 'cursor-move'
        )}
        style={{
          // UNIFIED: renderedX = originalX × displayScale
          // 容器尺寸 = 图片自然尺寸 × displayScale，region.x 为自然像素坐标
          left: `${region.x * displayScale}px`,
          top: `${region.y * displayScale}px`,
          width: `${region.w * displayScale}px`,
          height: `${region.h * displayScale}px`,
          boxSizing: 'border-box',
          borderWidth,
          borderColor: isSelected
            ? '#3B82F6'
            : isLowConfidence
            ? '#EF4444'
            : config.color,
          borderStyle: isLocked ? 'dashed' : 'solid',
          touchAction: 'none',
        }}
      >
        {/* 类型标签 */}
        <Tooltip title={`${config.label}${isLocked ? '（已锁定）' : ''}${isLowConfidence ? ' · 低置信度' : ''}`}>
          <span
            className="absolute -top-5 left-0 text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap text-white shadow-sm pointer-events-none max-w-[72px] truncate"
            style={{
              backgroundColor: isSelected ? '#3B82F6' : isLowConfidence ? '#EF4444' : config.color,
              opacity: isSelected ? 1 : 0.85,
            }}
          >
            {config.label}
            {isLocked && ' 🔒'}
            {isLowConfidence && isSelected && ' ⚠'}
          </span>
        </Tooltip>

        {/* 文字预览 */}
        <div
          className="absolute inset-0 flex items-center justify-center p-1 overflow-hidden pointer-events-none"
          style={{
            color: fontColor,
            fontSize: `${Math.max(8, fontSize * (scalePercent / 100))}px`,
          }}
        >
          <span
            className="text-center leading-tight line-clamp-2 select-none"
            style={{
              textShadow: region.style_config?.stroke_width
                ? `0 0 ${region.style_config.stroke_width}px ${region.style_config.stroke_color || '#fff'}`
                : undefined,
            }}
          >
            {text || '...'}
          </span>
        </div>

        {/* 锁定指示器 */}
        {isLocked && (
          <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-amber-400 border border-white dark:border-slate-800 pointer-events-none" />
        )}
      </div>

      {/* 缩放手柄（选中且未锁定时显示） */}
      {isSelected && !isLocked && (
        <>
          {/* 四角 */}
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
            const cornerStyle: React.CSSProperties = {
              position: 'absolute',
              width: handleSize,
              height: handleSize,
              borderRadius: '50%',
              backgroundColor: '#3B82F6',
              border: '2px solid white',
              zIndex: 20,
              cursor: `${corner}-resize`,
              touchAction: 'none',
            };
            // 统一坐标系: 手柄使用 left+top 计算 (仅 displayScale)
            if (corner === 'nw') {
              cornerStyle.left = `${region.x * displayScale - handleSize / 2}px`;
              cornerStyle.top = `${region.y * displayScale - handleSize / 2}px`;
            } else if (corner === 'ne') {
              cornerStyle.left = `${(region.x + region.w) * displayScale - handleSize / 2}px`;
              cornerStyle.top = `${region.y * displayScale - handleSize / 2}px`;
            } else if (corner === 'sw') {
              cornerStyle.left = `${region.x * displayScale - handleSize / 2}px`;
              cornerStyle.top = `${(region.y + region.h) * displayScale - handleSize / 2}px`;
            } else if (corner === 'se') {
              cornerStyle.left = `${(region.x + region.w) * displayScale - handleSize / 2}px`;
              cornerStyle.top = `${(region.y + region.h) * displayScale - handleSize / 2}px`;
            }

            return (
              <div
                key={corner}
                style={cornerStyle}
                onPointerDown={(e) => handlePointerDown(e, `resize-${corner}` as DragMode)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
            );
          })}

          {/* 四边中点 */}
          {(['n', 's', 'e', 'w'] as const).map((edge) => {
            const edgeStyle: React.CSSProperties = {
              position: 'absolute',
              width: handleSize,
              height: handleSize,
              borderRadius: '50%',
              backgroundColor: '#3B82F6',
              border: '2px solid white',
              zIndex: 20,
              cursor: `${edge}-resize`,
              touchAction: 'none',
            };
            // 统一坐标系: 所有边手柄使用 left+top 计算 (仅 displayScale)
            if (edge === 'n') {
              edgeStyle.left = `${(region.x + region.w / 2) * displayScale - handleSize / 2}px`;
              edgeStyle.top = `${region.y * displayScale - handleSize / 2}px`;
            } else if (edge === 's') {
              edgeStyle.left = `${(region.x + region.w / 2) * displayScale - handleSize / 2}px`;
              edgeStyle.top = `${(region.y + region.h) * displayScale - handleSize / 2}px`;
            } else if (edge === 'e') {
              edgeStyle.left = `${(region.x + region.w) * displayScale - handleSize / 2}px`;
              edgeStyle.top = `${(region.y + region.h / 2) * displayScale - handleSize / 2}px`;
            } else if (edge === 'w') {
              edgeStyle.left = `${region.x * displayScale - handleSize / 2}px`;
              edgeStyle.top = `${(region.y + region.h / 2) * displayScale - handleSize / 2}px`;
            }

            return (
              <div
                key={edge}
                style={edgeStyle}
                onPointerDown={(e) => handlePointerDown(e, `resize-${edge}` as DragMode)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
            );
          })}
        </>
      )}
    </>
  );
});

/** 选区覆盖层：在图片上绘制所有文字区域选区 */
export const RegionOverlay: React.FC<RegionOverlayProps> = ({
  regions,
  selectedRegionId,
  showOriginal,
  scalePercent,
  imageWidth,
  imageHeight,
  coordScale = 1,
  onSelect,
  onUpdateRegion,
}) => {
  // 调试：只在区域数量变化时输出日志（避免缩放时频繁输出）
  const overlayRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(regions.length);
  useEffect(() => {
    if (typeof window !== 'undefined' && prevCountRef.current !== regions.length) {
      prevCountRef.current = regions.length;
      console.log('[RegionOverlay] rendering', regions.length, 'regions, baseW:', imageWidth, 'baseH:', imageHeight);
    }
  }, [regions, imageWidth, imageHeight]);

  const displayScale = (scalePercent / 100) * coordScale;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-50"
      onClick={() => onSelect(null)}
      onDoubleClick={(e) => {
        // 双击空白区域添加新区
        if (!onUpdateRegion) return;
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        // 统一坐标系: 点击位置 ÷ displayScale = 原始图像像素坐标
        const x = (e.clientX - rect.left) / displayScale;
        const y = (e.clientY - rect.top) / displayScale;
        // 通过父组件添加新区
        onSelect(`__new_${Date.now()}_${x.toFixed(1)}_${y.toFixed(1)}`);
      }}
    >
      {regions.map((region, idx) => {
        // 确保 key 唯一：region_id 可能是 null/undefined/字符串"None"（Python序列化问题）
        const rawId = region.region_id;
        const safeKey = (rawId && rawId !== 'None') ? rawId : `region-${idx}`;
        const isSelected = rawId != null && rawId !== 'None' && rawId === selectedRegionId;
        // §2.2.8: 多边形/贝塞尔模式且有 ≥3 个顶点时走多边形渲染，否则降级矩形
        const isPoly = (region.boundary_mode === 'polygon' || region.boundary_mode === 'bezier')
          && Array.isArray(region.points) && region.points.length >= 3;
        if (isPoly) {
          return (
            <PolygonRegion
              key={safeKey}
              region={region}
              isSelected={isSelected}
              showOriginal={showOriginal}
              scalePercent={scalePercent}
              imageWidth={imageWidth}
              imageHeight={imageHeight}
              coordScale={coordScale}
              onSelect={onSelect}
              onUpdateRegion={onUpdateRegion}
            />
          );
        }
        return (
          <RegionRect
            key={safeKey}
            region={region}
            isSelected={isSelected}
            showOriginal={showOriginal}
            scalePercent={scalePercent}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            coordScale={coordScale}
            onSelect={onSelect}
            onUpdateRegion={onUpdateRegion}
          />
        );
      })}
    </div>
  );
};
