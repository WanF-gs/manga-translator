'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';

/**
 * 等待 Zustand persist 水合完成；超时后强制就绪，避免访客页无限骨架屏。
 */
export function useAuthHydrated(timeoutMs = 500): boolean {
  const storeHydrated = useAuthStore((s) => s._hydrated);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (storeHydrated) {
      setReady(true);
      return;
    }

    const finish = () => {
      useAuthStore.setState({ _hydrated: true });
      setReady(true);
    };

    if (useAuthStore.persist.hasHydrated()) {
      finish();
      return;
    }

    const unsub = useAuthStore.persist.onFinishHydration(finish);
    const timer = setTimeout(finish, timeoutMs);

    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [storeHydrated, timeoutMs]);

  return ready || storeHydrated;
}

/** 是否已登录（仅依赖 Zustand store，避免残留 cookie 导致误判） */
export function useHasAuth(): boolean {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  return isAuthenticated || !!accessToken;
}
