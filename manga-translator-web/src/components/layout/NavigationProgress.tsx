'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * PRD 6.1：电脑端操作响应 ≤100ms
 * 路由切换时立即显示顶部进度条，避免用户感知"点击无反应"
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setPending(false);
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a[href]');
      if (!anchor || anchor.getAttribute('target') === '_blank') return;
      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('//')) return;
      const target = href.split('?')[0].split('#')[0];
      if (target !== pathname) {
        setPending(true);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [pathname]);

  if (!pending) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] h-0.5 overflow-hidden bg-primary-100 dark:bg-primary-900/40"
      role="progressbar"
      aria-label="页面加载中"
    >
      <div className="h-full w-1/3 bg-primary-500 animate-[nav-progress_0.9s_ease-in-out_infinite]" />
    </div>
  );
}
