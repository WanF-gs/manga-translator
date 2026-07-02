'use client';

import React, { useState } from 'react';
import clsx from 'clsx';

interface ReaderBubbleRegion {
  region_id: string;
  boundary: {
    x: number;    // 百分比 0-100
    y: number;    // 百分比 0-100
    width: number;  // 百分比
    height: number; // 百分比
  };
  original_text?: string;
  translated_text?: string;
  type?: string;
}

export type DisplayMode = 'translated' | 'original' | 'bilingual';

interface PageRendererProps {
  /** 页面图片 URL */
  pageUrl: string;
  /** 备选 URL（如原文/译文切换用） */
  altPageUrl?: string;
  /** 页面 alt 文本 */
  alt: string;
  /** 显示模式 */
  displayMode: DisplayMode;
  /** 页码（用于占位显示） */
  pageNumber?: number;
  /** 宽高比，默认 3/4 */
  aspectRatio?: string;
  /** 自定义 className */
  className?: string;
  /** 页面加载中占位色 */
  placeholderColor?: string;
  /** 鼠标悬停是否显示 overlay 文字 */
  overlayLabel?: string;
  /** 文字区域列表（用于气泡点击切换） */
  regions?: ReaderBubbleRegion[];
  /** 单个气泡的显示模式覆盖（region_id -> mode） */
  regionModeOverrides?: Record<string, DisplayMode>;
  /** 气泡点击回调 */
  onBubbleClick?: (regionId: string) => void;
  /** §2.7.4 单词点击查词回调（传入单词与点击坐标） */
  onWordLookup?: (word: string, anchor: { x: number; y: number }) => void;
}

/** 将一段文本切成可点击的"词"单元。
 *  CJK 逐字、拉丁按空格分词——在没有分词器时对漫画短句足够实用。 */
function tokenizeForLookup(text: string): string[] {
  const tokens: string[] = [];
  const re = /[A-Za-zÀ-ÿ0-9]+|[぀-ヿ一-鿿가-힯]|[^\s]/g;
  const matches = text.match(re);
  if (matches) tokens.push(...matches);
  return tokens;
}

/** 单页面渲染器：支持图片加载/失败/加载中状态 + 可点击气泡覆盖层 */
export const PageRenderer: React.FC<PageRendererProps> = ({
  pageUrl,
  altPageUrl,
  alt,
  displayMode,
  pageNumber,
  aspectRatio = '3/4',
  className,
  placeholderColor = '#3B82F6',
  overlayLabel,
  regions,
  regionModeOverrides = {},
  onBubbleClick,
  onWordLookup,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const currentUrl =
    displayMode === 'original' ? pageUrl : altPageUrl || pageUrl;

  // 获取单个气泡的显示文本
  const getBubbleText = (region: ReaderBubbleRegion): string | null => {
    const mode = regionModeOverrides[region.region_id] || displayMode;
    if (mode === 'original') return region.original_text || null;
    if (mode === 'translated') return region.translated_text || null;
    if (mode === 'bilingual') {
      const o = region.original_text || '';
      const t = region.translated_text || '';
      if (o && t) return `${o} / ${t}`;
      return o || t || null;
    }
    return null;
  };

  const hasBubbles = regions && regions.length > 0 && onBubbleClick;

  return (
    <div
      className={clsx('relative rounded-lg overflow-hidden bg-slate-800 shadow-2xl group', className)}
      style={{ aspectRatio }}
    >
      {/* 图片加载前/失败时的占位 */}
      {(!loaded || error) && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: `${placeholderColor}20` }}
        >
          {error ? (
            <div className="flex flex-col items-center gap-2 text-white/40">
              <span className="text-4xl">🖼</span>
              <span className="text-xs">图片加载失败</span>
              {pageNumber && <span className="text-2xl font-bold text-white/20">{pageNumber}</span>}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              {pageNumber && <span className="text-5xl font-bold text-white/10">{pageNumber}</span>}
            </div>
          )}
        </div>
      )}

      {/* 图片 */}
      {!error && (
        <img
          src={currentUrl}
          alt={alt}
          className={clsx(
            'w-full h-full object-contain transition-opacity duration-300',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          loading="lazy"
        />
      )}

      {/* 气泡覆盖层：可点击的文字区域 */}
      {hasBubbles && loaded && (
        <div className="absolute inset-0">
          {regions!.map((region) => {
            const bubbleMode = regionModeOverrides[region.region_id] || displayMode;
            const bubbleText = getBubbleText(region);
            const isBilingual = bubbleMode === 'bilingual';
            const isOverridden = !!regionModeOverrides[region.region_id];
            const showText = bubbleMode !== displayMode || bubbleText;

            return (
              <div
                key={region.region_id}
                className={clsx(
                  'absolute transition-all duration-200 cursor-pointer',
                  isOverridden
                    ? 'ring-1 ring-primary-400/50 bg-primary-400/5'
                    : 'hover:ring-1 hover:ring-primary-400/30 hover:bg-primary-400/5',
                  showText && 'bg-white/10 dark:bg-white/5'
                )}
                style={{
                  left: `${region.boundary.x}%`,
                  top: `${region.boundary.y}%`,
                  width: `${region.boundary.width}%`,
                  height: `${region.boundary.height}%`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onBubbleClick!(region.region_id);
                }}
                title={
                  region.original_text
                    ? `原文: ${region.original_text}\n译文: ${region.translated_text || '无'}`
                    : undefined
                }
              >
                {/* 气泡文字预览（仅当有覆盖时显示） */}
                {isOverridden && bubbleText && (
                  <div
                    className={clsx(
                      'absolute inset-0 flex items-center justify-center p-1',
                      onWordLookup && bubbleMode === 'original' ? '' : 'pointer-events-none',
                      isBilingual ? 'text-[9px]' : 'text-[11px]'
                    )}
                  >
                    <span
                      className={clsx(
                        'text-center leading-tight line-clamp-3 font-medium px-1',
                        isBilingual
                          ? 'text-amber-400/90 bg-black/40 rounded'
                          : 'text-primary-300/90 bg-black/30 rounded'
                      )}
                      style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
                    >
                      {/* §2.7.4: 原文模式下逐词可点击查词 */}
                      {onWordLookup && bubbleMode === 'original' && region.original_text
                        ? tokenizeForLookup(region.original_text).map((tok, ti) => (
                            <span
                              key={ti}
                              className="cursor-pointer hover:bg-primary-400/40 hover:text-white rounded-sm transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (/\s/.test(tok)) return;
                                onWordLookup(tok, { x: e.clientX, y: e.clientY });
                              }}
                            >
                              {tok}
                            </span>
                          ))
                        : bubbleText}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 悬停 overlay */}
      {overlayLabel && loaded && (
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-center pb-3 pointer-events-none">
          <span className="text-white text-sm font-medium">{overlayLabel}</span>
        </div>
      )}
    </div>
  );
};
