'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import {
  BookOpen,
  Settings,
  Trash2,
  User,
  LogOut,
  Menu,
  X,
  Home,
  Upload,
  Languages,
  Sun,
  Moon,
  Type,
  Key,
  Search,
  GraduationCap,
  Headphones,
  Film,
  CreditCard,
  Bell,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { NavigationProgress } from '@/components/layout/NavigationProgress';
import { RoutePrefetcher } from '@/components/layout/RoutePrefetcher';
import { NetworkStatusBar } from '@/components/layout/NetworkStatusBar';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { useHasAuth } from '@/hooks/useAuthHydrated';
import OnboardingWizard, { useOnboardingStore } from '@/components/common/OnboardingWizard';

// ── P2 A11y: Skip-to-content link (WCAG 2.1 §2.4.1 Bypass Blocks) ──
const SkipToContent = () => (
  <a
    href="#main-content"
    className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-md focus:shadow-lg focus:outline-none"
    aria-label="跳转到主内容"
  >
    跳转到主内容
  </a>
);

// 非关键组件懒加载，避免阻塞首屏交互（PRD：点击响应 ≤100ms）
const NotificationBell = dynamic(
  () => import('@/components/common/NotificationBell').then((m) => ({ default: m.NotificationBell })),
  {
    ssr: false,
    loading: () => (
      <div className="p-2 rounded-lg text-slate-300 dark:text-slate-600" aria-hidden>
        <Bell size={18} />
      </div>
    ),
  }
);

interface PcLayoutProps {
  children: React.ReactNode;
}

const MOBILE_BREAKPOINT = 768;

const NAV_ITEMS = [  { key: '/', label: '作品列表', icon: Home, href: '/pc' },
  { key: '/pc/upload', label: '上传翻译', icon: Upload, href: '/pc/upload' },
  { key: '/pc/fonts', label: '字体管理', icon: Type, href: '/pc/fonts' },
  { key: '/pc/search', label: '跨作品搜索', icon: Search, href: '/pc/search' },
  { key: '/pc/audio', label: '音频剧场', icon: Headphones, href: '/pc/audio' },
  { key: '/pc/dynamic-manga', label: '动态漫画', icon: Film, href: '/pc/dynamic-manga' },
  { key: '/pc/learn', label: '学习中心', icon: GraduationCap, href: '/pc/learn' },
  { key: '/pc/plans', label: '订阅方案', icon: CreditCard, href: '/pc/plans' },
  { key: '/pc/api-keys', label: 'API 密钥', icon: Key, href: '/pc/api-keys' },
  { key: '/pc/settings', label: '设置', icon: Settings, href: '/pc/settings' },
  { key: '/pc/trash', label: '回收站', icon: Trash2, href: '/pc/trash' },
];

export const PcLayout: React.FC<PcLayoutProps> = ({ children }) => {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuthStore();
  const { resolved, setMode } = useThemeStore();
  const hasAuth = useHasAuth();

  const prefetchRoutes = useMemo(() => NAV_ITEMS.map((item) => item.href), []);

  const isEditorPage = pathname.startsWith('/pc/projects/') && pathname.split('/').length > 3;

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const toggleTheme = useCallback(() => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setMode]);

  const handleLogout = useCallback(() => {
    logout();
    router.push('/login');
  }, [logout, router]);

  const userMenuItems: MenuProps['items'] = user
    ? [
        {
          key: 'profile',
          label: (
            <Link href="/pc/settings" className="block" onClick={closeMobileSidebar}>
              个人设置
            </Link>
          ),
        },
        {
          key: 'theme',
          label: resolved === 'dark' ? '切换浅色模式' : '切换深色模式',
          onClick: toggleTheme,
        },
        { type: 'divider' },
        {
          key: 'logout',
          label: '退出登录',
          danger: true,
          onClick: handleLogout,
        },
      ]
    : [
        {
          key: 'login',
          label: (
            <Link href="/login" className="block" onClick={closeMobileSidebar}>
              登录
            </Link>
          ),
        },
        {
          key: 'register',
          label: (
            <Link href="/register" className="block" onClick={closeMobileSidebar}>
              注册账号
            </Link>
          ),
        },
      ];

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50/30 dark:from-surface-dark dark:via-slate-900 dark:to-blue-950/20">
      <SkipToContent />
      <NavigationProgress />
      <RoutePrefetcher routes={prefetchRoutes} enabled={hasAuth} />
      <NetworkStatusBar />
      {/* 移动端遮罩 */}
      {isMobile && sidebarOpen && !isEditorPage && (
        <button
          type="button"
          aria-label="关闭菜单"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ===== 左侧导航栏 ===== */}
      {!isEditorPage && (
        <aside
          className={clsx(
            'flex flex-col bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-r border-slate-200/60 dark:border-slate-800/60 transition-all duration-300 ease-out z-50',
            isMobile
              ? clsx('fixed inset-y-0 left-0 shadow-2xl w-[min(17rem,85vw)]', sidebarOpen ? 'translate-x-0' : '-translate-x-full')
              : sidebarOpen ? 'w-60' : 'w-[4.25rem]'
          )}
        >
          {/* Logo区域 */}
          <div className={clsx(
            'flex items-center h-14 border-b border-slate-200/60 dark:border-slate-800/60',
            sidebarOpen ? 'justify-between px-4' : 'justify-center'
          )}>
            {sidebarOpen && (
              <Link href="/pc" className="flex items-center gap-2.5 group">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-sm shadow-primary-500/25 group-hover:shadow-md group-hover:shadow-primary-500/30 transition-shadow">
                  <Sparkles className="w-4.5 h-4.5 text-white" />
                </div>
                <span className="font-bold text-sm text-slate-900 dark:text-white tracking-tight">
                  Manga TL
                </span>
              </Link>
            )}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={clsx(
                'p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200',
                !sidebarOpen && 'mx-auto'
              )}
              aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            >
              {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>

          {/* 导航菜单 */}
          <nav className={clsx(
            'flex-1 py-3 space-y-0.5',
            sidebarOpen ? 'px-3' : 'px-2'
          )}>
            {NAV_ITEMS.map((item, index) => {
              const isActive = pathname === item.href || 
                (item.href !== '/pc' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  prefetch={true}
                  onClick={closeMobileSidebar}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200 ease-out',
                    sidebarOpen ? 'px-3 py-2.5' : 'px-2 py-2.5 justify-center',
                    isActive
                      ? 'bg-primary-50 text-primary-700 shadow-sm dark:bg-primary-900/40 dark:text-primary-300 dark:shadow-primary-900/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-200'
                  )}
                  title={!sidebarOpen ? item.label : undefined}
                  style={{ animationDelay: `${index * 0.03}s` }}
                >
                  <item.icon size={sidebarOpen ? 18 : 20} className={clsx(
                    'flex-shrink-0 transition-transform duration-200',
                    isActive && 'scale-110'
                  )} />
                  {sidebarOpen && (
                    <span className="truncate">{item.label}</span>
                  )}
                  {isActive && sidebarOpen && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500 dark:bg-primary-400" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* 用户区域 */}
          <div className={clsx(
            'border-t border-slate-200/60 dark:border-slate-800/60',
            sidebarOpen ? 'p-3' : 'p-2'
          )}>
            {sidebarOpen ? (
              <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="topRight">
                <button
                  type="button"
                  className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-all duration-200"
                  aria-label="用户菜单"
                >
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 dark:from-primary-500 dark:to-primary-700 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <User size={16} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {user ? (
                      <>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {user.nickname}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {user.plan_type === 'premium' ? '✨ 高级版' : '免费版'} · 点击打开菜单
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-primary-600 dark:text-primary-400 truncate">
                          未登录
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          点击登录或注册
                        </p>
                      </>
                    )}
                  </div>
                </button>
              </Dropdown>
            ) : (
              <div className="flex flex-col items-center gap-2.5">
                {user ? (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-sm">
                    <User size={16} className="text-white" />
                  </div>
                ) : (
                  <Link
                    href="/login"
                    className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-sm"
                    title="登录"
                  >
                    <User size={16} className="text-white" />
                  </Link>
                )}
                <button
                  onClick={toggleTheme}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
                  title={resolved === 'dark' ? '切换浅色模式' : '切换深色模式'}
                >
                  {resolved === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                {user && (
                  <button
                    onClick={handleLogout}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200"
                    title="退出登录"
                  >
                    <LogOut size={15} />
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ===== 主内容区 ===== */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        {!isEditorPage && (
          <div className="flex items-center justify-between px-5 py-2.5 gap-2 border-b border-slate-200/50 dark:border-slate-800/50 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl">
            {isMobile && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all md:hidden"
                aria-label="打开菜单"
              >
                <Menu size={18} />
              </button>
            )}
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all duration-200"
                title={resolved === 'dark' ? '切换浅色模式' : '切换深色模式'}
              >
                {resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>
              {hasAuth && <NotificationBell />}
            </div>
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          aria-label="主内容区域"
          className={clsx(
          'focus:outline-none flex-1 overflow-hidden',
          isEditorPage ? 'flex flex-col' : 'overflow-y-auto'
        )}>
          {/* P2 A11y: Live region for dynamic content announcements (WCAG §4.1.3) */}
          <div
            id="aria-live-polite"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          />
          <div
            id="aria-live-assertive"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="sr-only"
          />
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
      {/* P1 Onboarding: Show tutorial for first-time users */}
      {hasAuth && (
        <OnboardingWizard
          visible={!useOnboardingStore.getState().hasCompletedTutorial}
          onClose={() => useOnboardingStore.getState().dismissTutorial()}
        />
      )}
    </div>
  );
};
