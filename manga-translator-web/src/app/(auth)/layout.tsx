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
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* 装饰背景 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-bl from-primary-500/10 via-purple-500/5 to-transparent dark:from-primary-500/5 dark:via-purple-500/3 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-accent-500/8 via-rose-500/5 to-transparent dark:from-accent-500/4 dark:via-rose-500/2 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />
        <div className="absolute top-1/2 left-1/2 w-[300px] h-[300px] bg-gradient-to-r from-blue-400/5 to-violet-400/5 dark:from-blue-400/3 dark:to-violet-400/3 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      </div>

      <header className="relative flex items-center justify-between px-4 py-4 sm:px-8 z-10">
        <Link
          href="/pc"
          className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:text-primary-600 dark:hover:text-primary-400 transition-colors group"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-sm shadow-primary-500/25 group-hover:shadow-md group-hover:shadow-primary-500/30 transition-shadow">
            <Languages size={18} className="text-white" />
          </div>
          <span className="font-bold text-sm hidden sm:inline tracking-tight">Manga TL</span>
        </Link>
        <Link
          href="/pc"
          className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors font-medium"
        >
          <ArrowLeft size={15} />
          返回首页
        </Link>
      </header>
      <div className="relative flex-1 flex items-center justify-center pb-8 z-10">
        {children}
      </div>
    </div>
  );
}
