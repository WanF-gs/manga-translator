/**
 * 认证页面布局
 * 登录/注册页面使用独立布局，无侧边栏
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Languages, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: '登录 - Manga Translator',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/30">
      {/* 装饰背景 */}
      <div className="absolute inset-0 pointer-events-none">
        {/* 主渐变 orb */}
        <div className="absolute top-0 right-0 w-[700px] h-[700px] bg-gradient-to-bl from-primary-400/15 via-purple-400/8 to-transparent dark:from-primary-500/8 dark:via-purple-500/5 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 animate-float" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-accent-400/12 via-rose-400/6 to-transparent dark:from-accent-500/6 dark:via-rose-500/3 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />
        <div className="absolute top-1/2 left-1/2 w-[400px] h-[400px] bg-gradient-to-r from-blue-400/6 to-violet-400/6 dark:from-blue-400/4 dark:to-violet-400/4 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        {/* 小装饰点 */}
        <div className="absolute top-[20%] left-[15%] w-2 h-2 rounded-full bg-primary-400/30 dark:bg-primary-400/20 animate-pulse-soft" />
        <div className="absolute top-[60%] right-[20%] w-2.5 h-2.5 rounded-full bg-accent-400/25 dark:bg-accent-400/15 animate-pulse-soft" style={{ animationDelay: '1s' }} />
        <div className="absolute bottom-[30%] left-[25%] w-1.5 h-1.5 rounded-full bg-purple-400/30 dark:bg-purple-400/20 animate-pulse-soft" style={{ animationDelay: '2s' }} />
        {/* 网格图案 */}
        <div className="absolute inset-0 bg-dot-pattern opacity-40 dark:opacity-25" />
      </div>

      <header className="relative flex items-center justify-between px-4 py-5 sm:px-8 z-10">
        <Link
          href="/pc"
          className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:text-primary-600 dark:hover:text-primary-400 transition-all duration-200 group"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 dark:from-primary-500 dark:to-blue-700 flex items-center justify-center shadow-sm shadow-primary-500/25 group-hover:shadow-md group-hover:shadow-primary-500/35 transition-all duration-200 group-hover:scale-105">
            <Languages size={18} className="text-white" />
          </div>
          <span className="font-bold text-sm hidden sm:inline tracking-tight">Manga TL</span>
        </Link>
        <Link
          href="/pc"
          className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors font-medium group"
        >
          <ArrowLeft size={15} className="group-hover:-translate-x-0.5 transition-transform" />
          返回首页
        </Link>
      </header>
      <div className="relative flex-1 flex items-center justify-center pb-12 z-10">
        {children}
      </div>
    </div>
  );
}
