/**
 * 渐进式图片加载组件
 * 先显示低清缩略图，滚动到可视区域后再加载高清原图
 * 用于移动端流量优化
 */
'use client';

import React, { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';

interface ProgressiveImageProps {
  /** 高清原图 URL */
  src: string;
  /** 低清缩略图 URL（可选） */
  thumbnail?: string;
  /** alt 文本 */
  alt?: string;
  /** 低清图质量参数 */
  lowQuality?: string;
  /** 宽高比 */
  aspectRatio?: string;
  /** 自定义类名 */
  className?: string;
  /** 容器样式 */
  style?: React.CSSProperties;
  /** 是否使用懒加载（IntersectionObserver） */
  lazy?: boolean;
  /** 根 Margin */
  rootMargin?: string;
  /** 是否强制低清（弱网模式） */
  forceLowQuality?: boolean;
}

export const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  thumbnail,
  alt = '',
  lowQuality = '?quality=low',
  aspectRatio = '3/4',
  className,
  style,
  lazy = true,
  rootMargin = '200px',
  forceLowQuality = false,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(!lazy);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // 懒加载 IntersectionObserver
  useEffect(() => {
    if (!lazy || inView || !imgRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [lazy, inView, rootMargin]);

  // 弱网时使用低清
  const displaySrc = forceLowQuality && thumbnail
    ? thumbnail
    : inView
    ? src
    : thumbnail || `${src}${lowQuality}`;

  return (
    <div
      ref={imgRef}
      className={clsx('relative overflow-hidden bg-slate-100 dark:bg-slate-800', className)}
      style={{ aspectRatio, ...style }}
    >
      {/* 低清预览（模糊占位） */}
      {(!loaded && !error) && (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 animate-pulse" />
      )}

      {/* 图片 */}
      {inView && !error && (
        <img
          src={displaySrc}
          alt={alt}
          className={clsx(
            'absolute inset-0 w-full h-full object-cover transition-opacity duration-500',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          loading={lazy ? 'lazy' : 'eager'}
        />
      )}

      {/* 错误状态 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 dark:text-slate-600">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )}
    </div>
  );
};
