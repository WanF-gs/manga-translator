'use client';

/**
 * FuriganaRenderer — §2.7.3 振假名/罗马音标注叠加渲染
 * 将日文汉字上方显示假名读音（HTML <ruby> 标签），支持切换显示/隐藏。
 */
import React, { memo, useMemo } from 'react';
import { Button, Tooltip, Switch } from 'antd';
import { Eye, EyeOff, Volume2 } from 'lucide-react';
import type { FuriganaToken, AnnotateResult } from '@/services/reader';

export interface FuriganaRendererProps {
  /** 已标注的振假名结果（来自 readerApi.annotate()） */
  annotation: AnnotateResult | null;
  /** 是否显示振假名 */
  showFurigana: boolean;
  /** 切换振假名显隐 */
  onToggleFurigana: (show: boolean) => void;
  /** 是否显示罗马音 */
  showRomaji?: boolean;
  /** 加载中 */
  loading?: boolean;
  /** 原文（fallback 当未标注时） */
  originalText?: string;
  /** 点击某个 token 时的回调 */
  onTokenClick?: (token: FuriganaToken) => void;
}

const FuriganaRenderer: React.FC<FuriganaRendererProps> = memo(({
  annotation,
  showFurigana,
  onToggleFurigana,
  showRomaji = false,
  loading = false,
  originalText = '',
  onTokenClick,
}) => {
  const tokens = useMemo(() => {
    if (!annotation?.tokens || !showFurigana) return null;
    return annotation.tokens;
  }, [annotation, showFurigana]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 animate-pulse">
        <span className="inline-block w-3 h-3 rounded-full bg-slate-300" />
        <span>标注中...</span>
      </div>
    );
  }

  if (!annotation && !originalText) {
    return null;
  }

  return (
    <div className="furigana-overlay relative">
      {/* Controls */}
      <div className="flex items-center gap-2 mb-2">
        <Tooltip title={showFurigana ? '隐藏假名' : '显示假名'}>
          <Switch
            size="small"
            checked={showFurigana}
            onChange={onToggleFurigana}
            checkedChildren={<Eye size={10} />}
            unCheckedChildren={<EyeOff size={10} />}
          />
        </Tooltip>
      </div>

      {/* Furigana text rendering with <ruby> tags */}
      <div className={`
        text-base leading-relaxed p-3 rounded-lg
        bg-white/90 dark:bg-slate-800/90
        border border-slate-200 dark:border-slate-700
        ${showFurigana ? 'font-serif' : 'font-sans'}
      `}>
        {tokens && showFurigana ? (
          <span className="furigana-text" lang="ja">
            {tokens.map((token, i) => {
              const hasReading = token.reading && token.reading !== token.surface;
              return (
                <span key={i} className="inline-flex flex-col items-center mx-0.5">
                  {hasReading ? (
                    <ruby>
                      {token.surface}
                      <rp>(</rp>
                      <rt className="text-[0.65em] text-slate-500 dark:text-slate-400 leading-none">
                        {token.reading}
                      </rt>
                      <rp>)</rp>
                    </ruby>
                  ) : (
                    <span
                      className="cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      onClick={() => onTokenClick?.(token)}
                      title={token.romaji ? `罗马音: ${token.romaji}` : undefined}
                    >
                      {token.surface}
                    </span>
                  )}
                  {showRomaji && token.romaji && (
                    <span className="text-[0.55em] text-slate-400 leading-tight -mt-0.5">
                      {token.romaji}
                    </span>
                  )}
                </span>
              );
            })}
          </span>
        ) : (
          <span>
            {annotation?.text || originalText}
          </span>
        )}
      </div>

      {/* Romaji full reading */}
      {showFurigana && annotation?.romaji && (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500 italic">
          <Volume2 size={10} className="inline mr-1" />
          {annotation.romaji}
        </p>
      )}
    </div>
  );
});

FuriganaRenderer.displayName = 'FuriganaRenderer';

export default FuriganaRenderer;
