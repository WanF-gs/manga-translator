'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Hand, ImageOff } from 'lucide-react';
import clsx from 'clsx';
import { RegionOverlay } from './RegionOverlay';
import type { EditorRegion } from './types';

interface CanvasProps {
  /** 当前页面图片URL */
  imageUrl: string;
  /** 回退URL（processed_url 失败时使用 original_url） */
  fallbackUrl?: string;
  /** 页面原始尺寸 */
  imageWidth: number;
  imageHeight: number;
  /** 文字区域列表 */
  regions: EditorRegion[];
  /** 当前选中的区域ID */
  selectedRegionId: string | null;
  /** 是否显示原文 */
  showOriginal: boolean;
  /** §2.7.1: 显示模式 original | translated | bilingual */
  displayMode?: 'original' | 'translated' | 'bilingual';
  /** §2.2.8: 是否显示检测选区线 */
  showRegions?: boolean;
  /** 缩放百分比 (外部传入，双向绑定) */
  scale: number;
  onScaleChange: (scale: number) => void;
  /** 选中区域回调 */
  onSelectRegion: (regionId: string | null) => void;
  /** 更新区域回调 */
  onUpdateRegion?: (regionId: string, data: Partial<EditorRegion>) => void;
  /** BUG FIX #3: 当前页面ID，用于翻页时重置画布平移状态 */
  pageId?: string | null;
  /** P0: 渲染后视图（译文回填图）— 气泡隐身模式 */
  isRenderedView?: boolean;
}

/** 中间画布：渲染当前页面图片 + 选区覆盖层 */
export const Canvas: React.FC<CanvasProps> = ({
  imageUrl,
  fallbackUrl,
  imageWidth,
  imageHeight,
  regions,
  selectedRegionId,
  showOriginal,
  showRegions = true,
  displayMode = 'translated',
  scale,
  onScaleChange,
  onSelectRegion,
  onUpdateRegion,
  pageId,
  isRenderedView = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 图片加载状态
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [activeUrl, setActiveUrl] = useState(imageUrl);
  const fallbackTried = useRef(false);

  // BUG FIX P0v4: 追踪图片自然尺寸（原始像素），用于坐标系校准
  // API报告的imageWidth/imageHeight可能是2×自然尺寸，
  // 而OCR的boundary坐标基于自然尺寸，需要按比例缩放
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  // 当 imageUrl 或 fallbackUrl 变化时重置加载状态
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
    setActiveUrl(imageUrl);
    fallbackTried.current = false;
    setNaturalSize(null);
  }, [imageUrl, fallbackUrl]);

  // BUG FIX #3: 翻页时重置画布平移，防止旧页面的偏移污染新页面
  useEffect(() => {
    if (pageId) {
      setPan({ x: 0, y: 0 });
      setIsPanning(false);
      setPanModeActive(false);
    }
  }, [pageId]);

  // 调试：只监控 regions 数量变化
  const prevCountRef = useRef(regions.length);
  useEffect(() => {
    if (regions.length !== prevCountRef.current) {
      prevCountRef.current = regions.length;
      if (regions.length > 0) {
        console.log('[Canvas] received', regions.length, 'regions, first:', regions[0]);
      } else {
        console.log('[Canvas] regions empty');
      }
    }
  }, [regions]);

  // 平移状态
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  // 手型工具激活状态（点击 Hand 按钮切换）
  const [panModeActive, setPanModeActive] = useState(false);

  // 缩放限制 + 节流：使用 RAF 批处理连续缩放操作
  const rafRef = useRef<number | null>(null);
  const pendingScaleRef = useRef<number | null>(null);
  const clampScale = (s: number) => Math.min(400, Math.max(10, s));

  // 带 RAF 节流的缩放变更
  const requestScaleChange = useCallback(
    (newScale: number) => {
      pendingScaleRef.current = clampScale(newScale);
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (pendingScaleRef.current !== null) {
            onScaleChange(pendingScaleRef.current);
            pendingScaleRef.current = null;
          }
        });
      }
    },
    [onScaleChange]
  );

  // Ctrl+滚轮缩放 —— 必须用原生 non-passive 监听器，否则浏览器忽略 preventDefault
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -10 : 10;
        requestScaleChange(scale + delta);
      }
    },
    [scale, requestScaleChange]
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    // 显式声明 passive: false 才能在 wheel 处理函数中阻止默认滚动/缩放
    node.addEventListener('wheel', handleWheel as any, { passive: false });
    return () => {
      node.removeEventListener('wheel', handleWheel as any);
    };
  }, [handleWheel]);

  // 拖拽平移：手型模式左键 / 空格+左键 / 中键
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && (spaceDown || panModeActive))) {
        e.preventDefault();
        setIsPanning(true);
        panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      }
    },
    [spaceDown, pan, panModeActive]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.x),
        y: panStart.current.panY + (e.clientY - panStart.current.y),
      });
    },
    [isPanning]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // 键盘事件：空格按住进入平移模式，Escape 退出手型模式
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && !e.repeat && e.target === document.body) {
        e.preventDefault();
        setSpaceDown(true);
      }
      if (e.key === 'Escape') {
        setPanModeActive(false);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setSpaceDown(false);
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      // 清理未完成的 RAF
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // 双击重置
  const handleDoubleClick = useCallback(() => {
    onScaleChange(100);
    setPan({ x: 0, y: 0 });
  }, [onScaleChange]);

  // 计算适配容器的初始缩放
  const fitScale = useMemo(() => {
    if (!containerRef.current) return 100;
    const containerW = containerRef.current.clientWidth - 64;
    const containerH = containerRef.current.clientHeight - 64;
    const scaleW = (containerW / imageWidth) * 100;
    const scaleH = (containerH / imageHeight) * 100;
    return Math.floor(Math.min(scaleW, scaleH, 100));
  }, [imageWidth, imageHeight]);

  const displayScale = scale / 100;
  
  // UNIFIED COORDINATE SYSTEM: 以图片自然尺寸（img.naturalWidth/Height）为唯一基准
  // 若未加载则回退到API报告尺寸（此时coordScaleRatio=1，不影响正确性）
  const baseW = naturalSize?.w || imageWidth;
  const baseH = naturalSize?.h || imageHeight;
  
  // P0 FIX: coordScale 将后端像素坐标（基于 imageWidth/imageHeight 空间）映射到显示图像空间
  // naturalSize 反映实际加载的图片尺寸（可能与 imageWidth 不同，如渲染图缩放后）
  const coordScale = naturalSize ? naturalSize.w / imageWidth : 1;
  
  // 使用 Math.round 确保像素级精确对齐，避免浮点数导致的子像素偏移
  const scaledW = Math.round(baseW * displayScale);
  const scaledH = Math.round(baseH * displayScale);
  
  // P0 DEBUG: 记录渲染参数，用于排查坐标偏移问题
  useEffect(() => {
    if (imgLoaded && regions.length > 0) {
      console.log('[Canvas] render params:', {
        baseW, baseH, coordScale, scalePercent: scale,
        naturalSize, apiSize: { w: imageWidth, h: imageHeight },
        firstRegion: regions[0] ? { x: regions[0].x, y: regions[0].y, w: regions[0].w, h: regions[0].h } : null,
        renderedPos: regions[0] ? {
          left: Math.round(regions[0].x * displayScale * coordScale),
          top: Math.round(regions[0].y * displayScale * coordScale),
        } : null,
      });
    }
  }, [imgLoaded, regions.length, baseW, baseH, coordScale, scale, imageWidth, imageHeight]);

  return (
    <div className="flex-1 flex flex-col bg-slate-200 dark:bg-slate-950 relative min-h-0">
      {/* 顶部浮动工具栏 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-lg shadow-lg border border-slate-200 dark:border-slate-800 p-1">
        <button
          onClick={() => requestScaleChange(scale - 25)}
          className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
          title="缩小 (Ctrl+滚轮)"
        >
          <ZoomOut size={16} />
        </button>
        <span className="text-xs font-mono text-slate-600 dark:text-slate-400 w-12 text-center tabular-nums select-none">
          {scale}%
        </span>
        <button
          onClick={() => requestScaleChange(scale + 25)}
          className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
          title="放大 (Ctrl+滚轮)"
        >
          <ZoomIn size={16} />
        </button>
        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />
        <button
          onClick={() => {
            requestScaleChange(100);
            setPan({ x: 0, y: 0 });
          }}
          className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
          title="重置视图 (双击)"
        >
          <RotateCcw size={16} />
        </button>
        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />
        <button
          onClick={() => setPanModeActive((prev) => !prev)}
          className={clsx(
            'p-1.5 rounded-md transition-colors',
            panModeActive || spaceDown
              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
              : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
          )}
          title={panModeActive ? '拖拽模式已激活（点击取消）' : '点击激活拖拽平移，或按住空格拖拽'}
        >
          <Hand size={16} />
        </button>
      </div>

      {/* 画布容器 */}
      <div
        ref={containerRef}
        className={clsx(
          'flex-1 overflow-hidden flex items-center justify-center p-8',
          isPanning && 'cursor-grabbing',
          !isPanning && (panModeActive || spaceDown) && 'cursor-grab'
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* 图片 + 选区叠加容器：使用 GPU 合成层，但避免 willChange 导致纹理内存溢出
            BUG FIX P0v2: 添加 flexShrink:0 防止 flex 父容器 overflow:hidden 导致子元素被压缩；
            同时 minWidth/minHeight 确保容器尺寸不会被 CSS reset 规则（如 max-width:100%）覆盖
            BUG FIX P0v3: transformOrigin: '0 0' 统一锚点为左上角，与文本框像素定位一致 */}
        <div
          className="relative shadow-2xl bg-white dark:bg-slate-800 rounded-lg overflow-hidden"
          style={{
            width: `${scaledW}px`,
            height: `${scaledH}px`,
            minWidth: `${scaledW}px`,
            minHeight: `${scaledH}px`,
            flexShrink: 0,
            transformOrigin: '0 0',
            /* BUG FIX P0: 使用 translate3d(0,0,0) 建立独立合成层（隐式 GPU 层），
               比 willChange: transform 轻量，不会在大图+高缩放时造成 GPU 纹理内存溢出
               从而消除花屏、斜向撕裂、色块断层、灰屏等问题。
               同时使用 backfaceVisibility:hidden 防止 GPU 纹理翻转伪影。
               contain: strict 提供 paint containment，防止渲染溢出与撕裂。 */
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
            backfaceVisibility: 'hidden' as any,
            contain: 'strict' as any,
          }}
        >
          {/* 真实图片：使用精确像素尺寸；imageRendering: auto + optimize-contrast 确保缩放时线条锐利
              BUG FIX P0v2: 覆盖 Tailwind CSS reset 的 max-width:100% 规则，
              该规则会覆盖内联 width 样式导致图片被压缩到父容器宽度 */}
          {!imgError && (
            <img
              ref={imgRef}
              src={activeUrl}
              alt="漫画页面"
              width={scaledW}
              height={scaledH}
              className={clsx(
                'block select-none',
                imgLoaded ? 'opacity-100' : 'opacity-0'
              )}
              style={{
                width: scaledW,
                height: scaledH,
                maxWidth: 'none',
                maxHeight: 'none',
                /* P0 FIX: 整数缩放时用 crisp-edges 保持漫画线条锐利，
                   非整数缩放时用 auto (高画质重采样) 避免锯齿 */
                imageRendering: Number.isInteger(displayScale) && displayScale > 0.5 ? 'crisp-edges' as any : 'auto',
                WebkitFontSmoothing: 'antialiased' as any,
                /* 移除 transition 避免加载态闪烁与GPU层组合时的伪影 */
                transition: imgLoaded ? 'none' : 'opacity 0.15s ease',
              }}
              draggable={false}
              onLoad={() => {
                setImgLoaded(true);
                // BUG FIX P0v4: 记录图片自然尺寸用于坐标系校准
                if (imgRef.current) {
                  const nw = imgRef.current.naturalWidth;
                  const nh = imgRef.current.naturalHeight;
                  if (nw > 0 && nh > 0) {
                    setNaturalSize({ w: nw, h: nh });
                    console.log('[Canvas] img natural:', nw, 'x', nh, 'api:', imageWidth, 'x', imageHeight, 'ratio:', (imageWidth/nw).toFixed(3));
                  }
                }
              }}
              onError={() => {
                if (!fallbackTried.current && fallbackUrl && activeUrl !== fallbackUrl) {
                  fallbackTried.current = true;
                  setActiveUrl(fallbackUrl);
                  setImgLoaded(false);
                } else {
                  setImgError(true);
                }
              }}
            />
          )}

          {/* 渐变占位（仅图片未加载/加载失败时显示） */}
          {(!imgLoaded || imgError) && (
            <div className="absolute inset-0 bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900">
              {imgError ? (
                /* 加载失败提示 */
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
                  <ImageOff size={32} strokeWidth={1.5} />
                  <span className="text-sm">图片加载失败</span>
                </div>
              ) : (
                <>
                  {/* 加载中骨架屏 */}
                  <div className="absolute inset-0 opacity-15 pointer-events-none">
                    <div className="absolute top-[10%] left-[10%] right-[10%] h-[18%] bg-slate-400 rounded" />
                    <div className="absolute top-[38%] left-[10%] w-[38%] h-[28%] bg-slate-400 rounded" />
                    <div className="absolute top-[38%] right-[10%] w-[38%] h-[28%] bg-slate-400 rounded" />
                    <div className="absolute top-[75%] left-[10%] right-[10%] h-[16%] bg-slate-400 rounded" />
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400 dark:text-slate-600 text-sm select-none">
                    加载中...
                  </div>
                </>
              )}
            </div>
          )}

          {/* §2.2.8: 选区覆盖层 — 可通过快捷键H隐藏，但双语模式下始终显示 */}
          {(showRegions !== false || displayMode === 'bilingual') && (
            <RegionOverlay
              regions={regions}
              selectedRegionId={selectedRegionId}
              showOriginal={showOriginal}
              displayMode={displayMode}
              scalePercent={scale}
              imageWidth={baseW}
              imageHeight={baseH}
              coordScale={coordScale}
              onSelect={onSelectRegion}
              onUpdateRegion={onUpdateRegion}
              isRenderedView={isRenderedView}
            />
          )}
        </div>
      </div>
    </div>
  );
};
