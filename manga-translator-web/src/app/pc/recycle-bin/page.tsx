'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';

/**
 * P1-B2 fix: Redirect /pc/recycle-bin → /pc/trash
 * Ensures legacy URL or direct navigation doesn't 404.
 */
export default function RecycleBinRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/pc/trash');
  }, [router]);

  return (
    <div className="h-full flex items-center justify-center">
      <Spin size="large" tip="正在跳转到回收站..." />
    </div>
  );
}
