'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookOpen, Library, User } from 'lucide-react';
import clsx from 'clsx';
import { NetworkStatusBar } from '@/components/common/NetworkStatusBar';

const TAB_ITEMS = [
  { key: '/m/', label: '首页', icon: Home, href: '/m/' },
  { key: '/m/projects', label: '作品', icon: Library, href: '/m/projects' },
  { key: '/m/reader', label: '阅读', icon: BookOpen, href: '/m/reader/demo' },
  { key: '/m/me', label: '我的', icon: User, href: '/m/me' },
];

interface MobileLayoutProps {
  children: React.ReactNode;
  hideTabBar?: boolean;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({ children, hideTabBar = false }) => {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-surface-dark">
      {/* 弱网提示 */}
      <NetworkStatusBar />
      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>

      {/* 底部Tab导航 */}
      {!hideTabBar && (
        <nav className="flex-shrink-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200/60 dark:border-slate-800/60 safe-area-bottom">
          <div className="flex items-center justify-around h-14">
            {TAB_ITEMS.map((item) => {
              const isActive = pathname === item.href || 
                (item.key !== '/m/' && pathname.startsWith(item.key));
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={clsx(
                    'relative flex flex-col items-center justify-center gap-0.5 min-w-[64px] py-1.5 transition-all duration-200',
                    isActive
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                  )}
                >
                  <item.icon size={22} className={clsx(
                    'transition-transform duration-200',
                    isActive && 'scale-110'
                  )} />
                  <span className="text-[10px] font-semibold">{item.label}</span>
                  {isActive && (
                    <div className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary-500 dark:bg-primary-400 rounded-full" />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
};
