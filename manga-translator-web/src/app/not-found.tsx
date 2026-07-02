'use client';

import Link from 'next/link';
import { Home, ArrowLeft } from 'lucide-react';

export default function RootNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center bg-slate-50 dark:bg-slate-950">
      <p className="text-6xl font-bold text-slate-200 dark:text-slate-700 mb-2">404</p>
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">页面未找到</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 max-w-md">
        您访问的地址不存在。PC 端功能请使用 <code className="text-primary-500">/pc/</code> 前缀路径。
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <Link href="/pc" className="btn-primary py-2.5 px-6 inline-flex items-center justify-center gap-2">
          <Home size={18} />
          返回 PC 首页
        </Link>
        <button
          type="button"
          onClick={() => typeof window !== 'undefined' && window.history.back()}
          className="btn-ghost py-2.5 px-6 border border-slate-200 dark:border-slate-700 inline-flex items-center justify-center gap-2"
        >
          <ArrowLeft size={18} />
          返回上一页
        </button>
      </div>
    </div>
  );
}
