'use client';

/**
 * 弱网状态提示栏
 * 在 2G/3G 网络下显示"当前网络较慢，已降低画质"提示
 */
import React, { useState } from 'react';
import { WifiOff, X } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

export const NetworkStatusBar: React.FC = () => {
  const { isSlow, online, showLowQualityHint } = useNetworkStatus();
  const [dismissed, setDismissed] = useState(false);

  if (!showLowQualityHint || !isSlow || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500/90 dark:bg-amber-600/90 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-2 safe-area-top">
        <div className="flex items-center gap-2">
          {!online ? (
            <WifiOff size={14} className="text-white" />
          ) : (
            <span className="text-xs">📶</span>
          )}
          <span className="text-xs font-medium text-white">
            {!online
              ? '网络已断开，部分功能不可用'
              : '当前网络较慢，已自动降低画质'}
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-white/70 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
