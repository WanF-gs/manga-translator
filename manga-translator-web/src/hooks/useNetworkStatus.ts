'use client';

/**
 * 网络状态检测 Hook
 * 检测弱网（2G/3G）并返回优化建议
 */
import { useState, useEffect, useCallback } from 'react';

export type NetworkType = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

export interface NetworkStatus {
  /** 是否在线 */
  online: boolean;
  /** 网络类型 */
  type: NetworkType;
  /** 是否为弱网 (2G/3G/慢速2G) */
  isSlow: boolean;
  /** 是否应显示低画质提示 */
  showLowQualityHint: boolean;
}

function getNetworkType(): NetworkType {
  if (typeof navigator === 'undefined' || !('connection' in navigator)) return 'unknown';
  const conn = (navigator as any).connection;
  if (!conn) return 'unknown';
  return (conn.effectiveType as NetworkType) || 'unknown';
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => {
    const type = getNetworkType();
    return {
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      type,
      isSlow: type === 'slow-2g' || type === '2g' || type === '3g',
      showLowQualityHint: type === 'slow-2g' || type === '2g' || type === '3g',
    };
  });

  useEffect(() => {
    const updateStatus = () => {
      const type = getNetworkType();
      setStatus({
        online: navigator.onLine,
        type,
        isSlow: type === 'slow-2g' || type === '2g' || type === '3g',
        showLowQualityHint: type === 'slow-2g' || type === '2g' || type === '3g',
      });
    };

    // 监听连接变化
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);

    const conn = (navigator as any).connection;
    if (conn) {
      conn.addEventListener('change', updateStatus);
    }

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
      if (conn) conn.removeEventListener('change', updateStatus);
    };
  }, []);

  return status;
}

/**
 * 生成图片质量参数
 */
export function useLowQualityUrl(url: string, isSlow: boolean): string {
  if (!isSlow || !url) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}quality=low&width=400`;
}
