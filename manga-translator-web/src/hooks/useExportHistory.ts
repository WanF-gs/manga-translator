'use client';

import { useState, useCallback } from 'react';
import { exportApi } from '@/services/export';
import type { ExportTaskStatus } from '@/services/export';

const HISTORY_KEY = 'manga_export_history';

export interface ExportHistoryItem {
  taskId: string;
  projectId?: string;
  format: string;
  scope: string;
  progress: number;
  status: string;
  filename?: string;
  downloadUrl?: string;
  createdAt: string;
  completedAt?: string;
}

export function useExportHistory() {
  const [history, setHistory] = useState<ExportHistoryItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const saveHistory = useCallback((items: ExportHistoryItem[]) => {
    setHistory(items);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
  }, []);

  const addToHistory = useCallback(
    (item: ExportHistoryItem) => {
      const updated = [item, ...history].slice(0, 50);
      saveHistory(updated);
    },
    [history, saveHistory]
  );

  const updateHistoryItem = useCallback(
    (taskId: string, updates: Partial<ExportHistoryItem>) => {
      const updated = history.map((h) =>
        h.taskId === taskId ? { ...h, ...updates } : h
      );
      saveHistory(updated);
    },
    [history, saveHistory]
  );

  const removeFromHistory = useCallback(
    (taskId: string) => {
      saveHistory(history.filter((h) => h.taskId !== taskId));
    },
    [history, saveHistory]
  );

  const clearHistory = useCallback(() => {
    saveHistory([]);
  }, [saveHistory]);

  return {
    history,
    addToHistory,
    updateHistoryItem,
    removeFromHistory,
    clearHistory,
  };
}
