'use client';

import React from 'react';
import Link from 'next/link';
import { Result, Button } from 'antd';
import { WifiOff, RefreshCw, Home } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <Result
        icon={<WifiOff size={64} className="text-slate-400" />}
        title="离线模式"
        subTitle={
          <div className="space-y-2">
            <p className="text-slate-500">当前网络不可用</p>
            <p className="text-xs text-slate-400">
              已缓存的内容（漫画页面、翻译结果）仍可正常查看。
              <br />新的翻译需要在网络恢复后进行。
            </p>
          </div>
        }
        extra={
          <div className="flex gap-3 justify-center mt-4">
            <Button
              type="primary"
              icon={<RefreshCw size={14} />}
              onClick={() => window.location.reload()}
            >
              重新连接
            </Button>
            <Link href="/pc">
              <Button icon={<Home size={14} />}>返回首页</Button>
            </Link>
          </div>
        }
      />
    </div>
  );
}
