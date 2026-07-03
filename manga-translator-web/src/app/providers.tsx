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
          colorTextBase: isDark ? '#F1F5F9' : '#0F172A',
          colorBgBase: isDark ? '#0F172A' : '#F8FAFC',
          borderRadius: 12,
          borderRadiusLG: 16,
          borderRadiusSM: 8,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          fontSize: 14,
          lineHeight: 1.6,
          controlHeight: 40,
          paddingContentHorizontal: 20,
          paddingContentVertical: 16,
          boxShadow: '0 4px 16px -4px rgba(0,0,0,0.08), 0 2px 6px -2px rgba(0,0,0,0.04)',
          boxShadowSecondary: '0 8px 24px -6px rgba(0,0,0,0.1), 0 3px 10px -4px rgba(0,0,0,0.06)',
          motionUnit: 0.08,
          motionBase: 0,
          motionEaseOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
          motionEaseInOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
        },
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        components: {
          Button: {
            controlHeight: 40,
            borderRadius: 12,
            borderRadiusSM: 8,
            fontWeight: 600,
            paddingInline: 18,
            paddingInlineSM: 12,
            primaryShadow: '0 2px 8px -2px rgba(59,130,246,0.3)',
          },
          Card: {
            borderRadiusLG: 16,
            borderRadius: 14,
            paddingLG: 24,
            padding: 20,
            boxShadow: '0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.04)',
          },
          Modal: {
            borderRadiusLG: 16,
            titleFontSize: 17,
            paddingContentHorizontalLG: 24,
          },
          Table: {
            borderRadius: 14,
            headerBg: isDark ? 'rgb(30 41 59 / 0.8)' : 'rgb(248 250 252)',
            headerColor: isDark ? 'rgb(203 213 225)' : 'rgb(71 85 105)',
            headerSplitColor: isDark ? 'rgb(51 65 85 / 0.6)' : 'rgb(226 232 240)',
            borderColor: isDark ? 'rgb(51 65 85 / 0.5)' : 'rgb(226 232 240 / 0.8)',
            rowHoverBg: isDark ? 'rgb(30 41 59 / 0.6)' : 'rgb(248 250 252)',
          },
          Input: {
            borderRadius: 12,
            borderRadiusSM: 8,
            controlHeight: 40,
            controlHeightSM: 34,
            paddingInline: 14,
            colorBorder: isDark ? 'rgb(51 65 85)' : 'rgb(203 213 225)',
            hoverBorderColor: isDark ? 'rgb(71 85 105)' : 'rgb(148 163 184)',
            activeBorderColor: '#3B82F6',
            activeShadow: '0 0 0 2px rgba(59,130,246,0.15)',
          },
          Select: {
            borderRadius: 12,
            controlHeight: 40,
            optionSelectedBg: isDark ? 'rgb(30 58 138 / 0.4)' : 'rgb(219 234 254)',
            optionSelectedColor: isDark ? 'rgb(147 197 253)' : 'rgb(29 78 216)',
          },
          Form: {
            itemMarginBottom: 22,
            labelFontSize: 13,
            labelColor: isDark ? 'rgb(203 213 225)' : 'rgb(71 85 105)',
            labelFontWeight: 600,
          },
          Menu: {
            itemBorderRadius: 12,
            itemHeight: 40,
            itemMarginInline: 8,
            horizontalItemSelectedColor: '#3B82F6',
          },
          Tag: {
            borderRadiusSM: 6,
            defaultBg: isDark ? 'rgb(30 41 59)' : 'rgb(241 245 249)',
          },
          Tabs: {
            itemColor: isDark ? 'rgb(148 163 184)' : 'rgb(100 116 139)',
            itemHoverColor: '#3B82F6',
            itemSelectedColor: '#3B82F6',
            inkBarColor: '#3B82F6',
            horizontalItemPadding: '10px 0',
          },
          Tooltip: {
            borderRadius: 8,
            colorBgSpotlight: isDark ? 'rgb(30 41 59)' : 'rgb(15 23 42)',
          },
          Dropdown: {
            borderRadiusLG: 12,
            paddingBlock: 8,
          },
          Progress: {
            defaultColor: '#3B82F6',
            remainingColor: isDark ? 'rgb(51 65 85)' : 'rgb(226 232 240)',
            lineBorderRadius: 10,
          },
          Badge: {
            dotSize: 8,
            textFontSize: 11,
            textFontWeight: 600,
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
