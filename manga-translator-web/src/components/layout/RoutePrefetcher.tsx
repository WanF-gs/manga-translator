'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface RoutePrefetcherProps {
  routes: string[];
  /** 登录后才预热（避免访客浪费带宽） */
  enabled?: boolean;
}

/**
 * 登录后空闲时预取侧边栏路由的 RSC + JS chunk，
 * 消除首次点击 5~6 秒的冷启动编译/下载延迟。
 */
export function RoutePrefetcher({ routes, enabled = true }: RoutePrefetcherProps) {
  const router = useRouter();
  const doneRef = useRef(false);

  useEffect(() => {
    if (!enabled || doneRef.current || routes.length === 0) return;

    const run = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      routes.forEach((route, index) => {
        window.setTimeout(() => {
          try {
            router.prefetch(route);
          } catch {
            /* ignore prefetch errors in dev */
          }
        }, index * 120);
      });
    };

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }

    const t = window.setTimeout(run, 800);
    return () => window.clearTimeout(t);
  }, [enabled, routes, router]);

  return null;
}
