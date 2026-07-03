'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import type { TextRegion } from '@/types';
import { REGION_TYPE_COLORS, REGION_TYPE_LABELS } from '@/types';

interface MobileCanvasProps {
  imageUrl: string;
  fallbackUrl?: string;
  imageWidth: number;
  imageHeight: number;
  regions: TextRegion[];
  selectedRegionId: string | null;
  showRegions?: boolean;
  isProcessing?: boolean;
  onSelectRegion: (regionId: string | null) => void;
}

/** 移动端触控画布：支持单指拖拽平移、双指缩放、点击选区 */
export const MobileCanvas: React.FC<MobileCanvasProps> = ({
  imageUrl,
  fallbackUrl,
  imageWidth,
  imageHeight,
  regions,
  selectedRegionId,
  showRegions = true,
  isProcessing = false,
  onSelectRegion,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeUrl, setActiveUrl] = useState(imageUrl);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  // 视图变换：缩放 + 平移
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // 触控手势状态
  const gestureRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    lastCenter: { x: number; y: number } | null;
    lastDistance: number | null;
    panning: boolean;
  }>({ pointers: new Map(), lastCenter: null, lastDistance: null, panning: false });

  useEffect(() => {
    setActiveUrl(imageUrl);
    setImgLoaded(false);
    setImgError(false);
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [imageUrl]);

  const getPointerPos = useCallback((e: React.PointerEvent | PointerEvent) => {
    const container = containerRef.current;
    if (!container) return { x: e.clientX, y: e.clientY };
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const getPointersInfo = useCallback(() => {
    const pts = Array.from(gestureRef.current.pointers.values());
    if (pts.length === 0) return null;
    if (pts.length === 1) return { center: pts[0], distance: 0 };
    const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const distance = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    return { center, distance };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isProcessing) return;
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const pos = getPointerPos(e);
    gestureRef.current.pointers.set(e.pointerId, pos);

    const info = getPointersInfo();
    if (!info) return;
    gestureRef.current.lastCenter = info.center;
    gestureRef.current.lastDistance = info.distance;
    gestureRef.current.panning = gestureRef.current.pointers.size === 1;
  }, [isProcessing, getPointerPos, getPointersInfo]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (isProcessing) return;
    if (!gestureRef.current.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const pos = getPointerPos(e);
    gestureRef.current.pointers.set(e.pointerId, pos);

    const info = getPointersInfo();
    if (!info) return;

    if (gestureRef.current.pointers.size === 2) {
      // 双指缩放
      const prevCenter = gestureRef.current.lastCenter;
      const prevDistance = gestureRef.current.lastDistance;
      if (prevCenter && prevDistance && prevDistance > 0) {
        const scaleFactor = info.distance / prevDistance;
        setScale((s) => Math.min(5, Math.max(0.5, s * scaleFactor)));
      }
      gestureRef.current.lastCenter = info.center;
      gestureRef.current.lastDistance = info.distance;
      gestureRef.current.panning = false;
    } else if (gestureRef.current.panning && gestureRef.current.lastCenter) {
      // 单指平移
      const dx = info.center.x - gestureRef.current.lastCenter.x;
      const dy = info.center.y - gestureRef.current.lastCenter.y;
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      gestureRef.current.lastCenter = info.center;
    }
  }, [isProcessing, getPointerPos, getPointersInfo]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    gestureRef.current.pointers.delete(e.pointerId);
    if (gestureRef.current.pointers.size === 0) {
      gestureRef.current.lastCenter = null;
      gestureRef.current.lastDistance = null;
      gestureRef.current.panning = false;
    } else {
      const info = getPointersInfo();
      if (info) {
        gestureRef.current.lastCenter = info.center;
        gestureRef.current.lastDistance = info.distance;
      }
    }
  }, [getPointersInfo]);

  const handleTap = useCallback((e: React.PointerEvent) => {
    if (gestureRef.current.pointers.size !== 0) return;
    // 只有未触发平移/缩放的点击才视为 tap
    const moved = Math.abs(e.clientX - e.nativeEvent.clientX) > 4 || Math.abs(e.clientY - e.nativeEvent.clientY) > 4;
    if (moved) return;

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const tapX = e.clientX - rect.left;
    const tapY = e.clientY - rect.top;

    // 将屏幕坐标转换到图像坐标系
    const containerW = rect.width;
    const containerH = rect.height;
    const imgAspect = imageWidth / imageHeight;
    const containerAspect = containerW / containerH;
    let renderedW = containerW;
    let renderedH = containerH;
    let offsetX = 0;
    let offsetY = 0;
    if (imgAspect > containerAspect) {
      renderedH = containerW / imgAspect;
      offsetY = (containerH - renderedH) / 2;
    } else {
      renderedW = containerH * imgAspect;
      offsetX = (containerW - renderedW) / 2;
    }

    const centerX = offsetX + renderedW / 2 + pan.x;
    const centerY = offsetY + renderedH / 2 + pan.y;
    const imgX = ((tapX - centerX) / (renderedW * scale)) * imageWidth + imageWidth / 2;
    const imgY = ((tapY - centerY) / (renderedH * scale)) * imageHeight + imageHeight / 2;

    // 找到包含点击位置的最小区域（按面积排序）
    const hits = regions.filter((r) => {
      const b = r.boundary;
      return (
        imgX >= b.x &&
        imgX <= b.x + b.width &&
        imgY >= b.y &&
        imgY <= b.y + b.height
      );
    });
    if (hits.length > 0) {
      // 优先选中小面积区域（嵌套时避免选中大背景）
      const smallest = hits.sort((a, b) => a.boundary.width * a.boundary.height - b.boundary.width * b.boundary.height)[0];
      onSelectRegion(smallest.region_id);
    } else {
      onSelectRegion(null);
    }
  }, [imageWidth, imageHeight, pan, regions, onSelectRegion, scale]);

  const handleDoubleTap = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-slate-200 dark:bg-slate-950 touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={handleTap as any}
      onDoubleClick={handleDoubleTap}
    >
      <div
        className="absolute inset-0 flex items-center justify-center origin-center"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transition: gestureRef.current.pointers.size === 0 ? 'transform 0.15s ease-out' : 'none',
        }}
      >
        <div
          className="relative"
          style={{
            width: `${(imageWidth / imageHeight) * 100}vh`,
            maxWidth: '100%',
            aspectRatio: `${imageWidth} / ${imageHeight}`,
          }}
        >
          <img
            src={activeUrl}
            alt="漫画页面"
            className={clsx('w-full h-full object-contain block select-none', imgLoaded ? 'opacity-100' : 'opacity-0')}
            draggable={false}
            onLoad={() => setImgLoaded(true)}
            onError={() => {
              if (fallbackUrl && !imgError) {
                setImgError(true);
                setActiveUrl(fallbackUrl);
              } else {
                setImgLoaded(true);
              }
            }}
          />

          {showRegions && imgLoaded && regions.map((region) => {
            const color = REGION_TYPE_COLORS[region.type] || '#3B82F6';
            const isSelected = region.region_id === selectedRegionId;
            const left = `${(region.boundary.x / imageWidth) * 100}%`;
            const top = `${(region.boundary.y / imageHeight) * 100}%`;
            const width = `${(region.boundary.width / imageWidth) * 100}%`;
            const height = `${(region.boundary.height / imageHeight) * 100}%`;
            return (
              <button
                key={region.region_id}
                type="button"
                className={clsx(
                  'absolute border-2 rounded-sm transition-all',
                  region.is_locked ? 'border-dashed opacity-50' : 'border-solid',
                  isSelected ? 'ring-2 ring-offset-1 ring-primary-400 z-10' : 'hover:opacity-80'
                )}
                style={{
                  left,
                  top,
                  width,
                  height,
                  borderColor: color,
                  backgroundColor: isSelected ? `${color}30` : `${color}15`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRegion(region.region_id);
                }}
              >
                <span
                  className="absolute top-0 left-0 px-1 py-0.5 text-[8px] text-white rounded-br"
                  style={{ backgroundColor: color }}
                >
                  {REGION_TYPE_LABELS[region.type]}
                </span>
                {isSelected && region.translated_text && (
                  <span className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[9px] text-white bg-black/60 truncate">
                    {region.translated_text}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!imgLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900">
          <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full" />
        </div>
      )}

      {isProcessing && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-20">
          <div className="bg-white dark:bg-slate-900 rounded-xl px-4 py-3 shadow-lg flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">AI 处理中...</span>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex gap-2 z-10">
        <button
          type="button"
          onClick={() => setScale((s) => Math.min(5, s + 0.25))}
          className="w-9 h-9 rounded-full bg-white/90 dark:bg-slate-800/90 backdrop-blur shadow flex items-center justify-center text-slate-600 dark:text-slate-300"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
          className="w-9 h-9 rounded-full bg-white/90 dark:bg-slate-800/90 backdrop-blur shadow flex items-center justify-center text-slate-600 dark:text-slate-300"
        >
          −
        </button>
      </div>
    </div>
  );
};
