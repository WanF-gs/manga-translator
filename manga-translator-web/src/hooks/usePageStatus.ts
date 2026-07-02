'use client';

import { useMemo } from 'react';
import type { PageStatus } from '@/types';

export interface PageStatusInfo {
  status: PageStatus;
  label: string;
  color: string;
  bgColor: string;
  icon: string;
  description: string;
}

export const PAGE_STATUS_MAP: Record<PageStatus, PageStatusInfo> = {
  pending: {
    status: 'pending',
    label: '待处理',
    color: '#94A3B8',
    bgColor: 'bg-slate-100 dark:bg-slate-800',
    icon: '⏳',
    description: '等待翻译',
  },
  translating: {
    status: 'translating',
    label: '翻译中',
    color: '#3B82F6',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    icon: '🔄',
    description: '正在翻译',
  },
  reviewed: {
    status: 'reviewed',
    label: '待审核',
    color: '#F59E0B',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: '👀',
    description: '需要审核',
  },
  completed: {
    status: 'completed',
    label: '已完成',
    color: '#10B981',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    icon: '✅',
    description: '翻译完成',
  },
};

export function usePageStatus(status: PageStatus) {
  return useMemo(() => PAGE_STATUS_MAP[status] || PAGE_STATUS_MAP.pending, [status]);
}
