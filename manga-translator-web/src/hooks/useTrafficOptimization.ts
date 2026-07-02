'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface TrafficState {
  /** 网络类型 */
  connectionType: string;
  /** 下行速度 Mbps */
  downlink: number;
  /** RTT ms */
  rtt: number;
  /** 是否为弱网 (< 2Mbps) */
  isWeakNetwork: boolean;
  /** 是否使用低质量预览 */
  useLowQuality: boolean;
  /** 预览图最大宽度 */
  maxPreviewWidth: number;
}

const WEAK_NETWORK_THRESHOLD = 2; // Mbps
const STRONG_NETWORK_THRESHOLD = 5;

/**
 * 移动端流量优化 Hook
 * - 检测网络状态
 * - 弱网自动使用低质量预览
 * - 自适应图片分辨率
 */
export function useTrafficOptimization(): TrafficState {
  const [state, setState] = useState<TrafficState>({
    connectionType: 'unknown',
    downlink: 10,
    rtt: 50,
    isWeakNetwork: false,
    useLowQuality: false,
    maxPreviewWidth: 800,
  });

  const updateState = useCallback(() => {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;

    if (!conn) {
      setState((prev) => ({ ...prev, isWeakNetwork: false, useLowQuality: false, maxPreviewWidth: 800 }));
      return;
    }

    const downlink = conn.downlink || 10;
    const rtt = conn.rtt || 50;
    const isWeak = downlink < WEAK_NETWORK_THRESHOLD;
    const useLow = downlink < STRONG_NETWORK_THRESHOLD;
    const maxWidth = downlink < 1 ? 400 : downlink < WEAK_NETWORK_THRESHOLD ? 600 : 800;

    setState({
      connectionType: conn.effectiveType || conn.type || 'unknown',
      downlink,
      rtt,
      isWeakNetwork: isWeak,
      useLowQuality: useLow,
      maxPreviewWidth: maxWidth,
    });
  }, []);

  useEffect(() => {
    updateState();

    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (conn) {
      conn.addEventListener('change', updateState);
      return () => conn.removeEventListener('change', updateState);
    }
  }, [updateState]);

  return state;
}

/**
 * 根据网络质量调整图片URL
 * 对支持参数调整的图片服务附加 width 参数
 */
export function getOptimizedUrl(url: string, maxWidth: number): string {
  if (!url || url.startsWith('blob:') || maxWidth >= 800) return url;

  // 对于 picsum 等占位图服务
  if (url.includes('picsum.photos')) {
    return url.replace(/\/\d+\/\d+/, `/${maxWidth}/${Math.round(maxWidth * 1.4)}`);
  }

  // 对于支持 w 参数的服务
  if (url.includes('?')) {
    return `${url}&w=${maxWidth}`;
  }
  return `${url}?w=${maxWidth}`;
}
