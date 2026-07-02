'use client';

import React, { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, theme as antTheme, App as AntApp } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { NotificationInstance } from 'antd/es/notification/interface';
import zhCN from 'antd/locale/zh_CN';
import { useThemeStore } from '@/stores/themeStore';
import { useAuthStore } from '@/stores/authStore';
import { setAuthCookie } from '@/lib/authCookie';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      retryDelay: 1000,
      refetchOnWindowFocus: false,
      // 后端不可达时与 axios timeout 对齐，避免无限 loading
      gcTime: 5 * 60 * 1000,
    },
  },
});

// ===== 全局 message/notification 持有者 =====
// 在 <AntApp> 挂载后由 MessageBridge 写入，非组件代码（如 axios 拦截器）可通过这些函数调用
let _message: MessageInstance | null = null;
let _notification: NotificationInstance | null = null;

export function getGlobalMessage(): MessageInstance | null {
  return _message;
}

export function getGlobalNotification(): NotificationInstance | null {
  return _notification;
}

/** 桥接组件：将 App.useApp() 的 message/notification 存入全局变量 */
function MessageBridge() {
  const { message, notification } = AntApp.useApp();

  useEffect(() => {
    _message = message;
    _notification = notification;
  }, [message, notification]);

  return null;
}

function AuthCookieSync() {
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (accessToken) {
      setAuthCookie(accessToken);
    }
  }, [accessToken]);

  return null;
}

function ThemeInner({ children }: { children: React.ReactNode }) {
  const { resolved, applyTheme } = useThemeStore();

  useEffect(() => {
    applyTheme();
  }, [applyTheme]);

  const isDark = resolved === 'dark';

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#3B82F6',
          colorSuccess: '#22C55E',
          colorWarning: '#EAB308',
          colorError: '#EF4444',
          colorInfo: '#3B82F6',
          borderRadius: 10,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        },
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        components: {
          Button: {
            controlHeight: 38,
            borderRadius: 10,
            fontWeight: 600,
          },
          Card: {
            borderRadiusLG: 14,
            paddingLG: 20,
          },
          Modal: {
            borderRadiusLG: 16,
          },
          Table: {
            borderRadius: 14,
            headerBg: isDark ? 'rgb(30 41 59)' : 'rgb(248 250 252)',
          },
          Input: {
            borderRadius: 10,
            controlHeight: 38,
          },
          Select: {
            borderRadius: 10,
            controlHeight: 38,
          },
          Form: {
            itemMarginBottom: 20,
            labelFontSize: 13,
            labelColor: isDark ? 'rgb(203 213 225)' : 'rgb(51 65 85)',
          },
        },
      }}
      locale={zhCN}
    >
      <AntApp message={{ maxCount: 3, top: 60 }}>
        <MessageBridge />
        <AuthCookieSync />
        {children}
      </AntApp>
    </ConfigProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeInner>
        {children}
      </ThemeInner>
    </QueryClientProvider>
  );
}
