'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Input, Select, Tag, Progress, Spin, App, Space, Card,
  Modal, Tooltip, Popconfirm, Alert, Divider
} from 'antd';
import {
  ArrowLeft, ArrowRight, Save, Search, Replace, CheckCircle2,
  Eye, Edit3, Languages, ChevronLeft, ChevronRight, Download,
  SkipForward, RotateCcw, X
} from 'lucide-react';
import clsx from 'clsx';
import request from '@/services/request';
import type { ApiResponse } from '@/types';

interface ReviewRegion {
  region_id: string;
  original_text: string;
  translated_text: string;
  region_type: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

interface ReviewPage {
  page_id: string;
  page_number: number;
  chapter_id: string;
  original_image_url: string;
  status: string;
  width: number;
  height: number;
  regions: ReviewRegion[];
}

interface ReviewResponse {
  items: ReviewPage[];
  total: number;
  page: number;
  page_size: number;
}

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const projectId = params.id!;
  const [currentPageNum, setCurrentPageNum] = useState(Number(searchParams.get('page')) || 1);
  const [editedTranslations, setEditedTranslations] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showBatchReplace, setShowBatchReplace] = useState(false);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchReplace, setBatchReplace] = useState('');
  const [batchScope, setBatchScope] = useState<'current_page' | 'all_pages'>('current_page');
  const [showOriginal, setShowOriginal] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch review pages
  const { data: reviewData, isLoading } = useQuery({
    queryKey: ['review-pages', projectId, currentPageNum],
    queryFn: async () => {
      const res = await request.get<ApiResponse<ReviewResponse>>(
        `/projects/${projectId}/review/pages?page=${currentPageNum}&page_size=1`
      );
      return res.data?.data || { items: [], total: 0, page: 1, page_size: 1 };
    },
    enabled: !!projectId,
    staleTime: 10_000,
  });

  // Fetch review stats
  const { data: stats } = useQuery({
    queryKey: ['review-stats', projectId],
    queryFn: async () => {
      const res = await request.get<ApiResponse<any>>(`/projects/${projectId}/review/stats`);
      return res.data?.data || { total_pages: 0, reviewed_pages: 0, unreviewed_pages: 0, progress_percent: 0 };
    },
    enabled: !!projectId,
    refetchInterval: 15_000,
  });

  const currentPage = reviewData?.items?.[0] || null;
  const totalPages = reviewData?.total || 0;

  // Initialize edited translations from loaded data
  useEffect(() => {
    if (currentPage?.regions) {
      const edits: Record<string, string> = {};
      currentPage.regions.forEach((r) => {
        edits[r.region_id] = r.translated_text || '';
      });
      setEditedTranslations(edits);
    }
  }, [currentPage?.page_id]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setInterval(() => {
      handleSave(false);
    }, 30_000);
    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [editedTranslations, currentPage]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (markReviewed: boolean) => {
      if (!currentPage) return;
      const translations = Object.entries(editedTranslations).map(([region_id, translated_text]) => ({
        region_id,
        translated_text,
      }));
      return request.post(`/projects/${projectId}/review/pages/${currentPage.page_id}/translations`, {
        translations,
        mark_reviewed: markReviewed,
      });
    },
    onSuccess: (_, markReviewed) => {
      if (markReviewed) {
        message.success('已保存并标记为已校对');
      } else {
        message.success('已自动保存');
      }
      queryClient.invalidateQueries({ queryKey: ['review-stats', projectId] });
    },
    onError: (err: Error) => message.error(`保存失败: ${err.message}`),
  });

  const handleSave = useCallback((markReviewed: boolean = false) => {
    if (!currentPage) return;
    setSaving(true);
    saveMutation.mutate(markReviewed, { onSettled: () => setSaving(false) });
  }, [currentPage, saveMutation]);

  // Batch replace mutation
  const batchReplaceMutation = useMutation({
    mutationFn: async () => {
      return request.post(`/projects/${projectId}/review/batch-replace`, {
        search: batchSearch,
        replace: batchReplace,
        scope: batchScope,
        page_id: batchScope === 'current_page' ? currentPage?.page_id : undefined,
        project_id: projectId,
      });
    },
    onSuccess: (res: any) => {
      const data = res.data?.data;
      message.success(`批量替换完成：匹配 ${data?.matched || 0} 处，已替换 ${data?.replaced || 0} 处`);
      setShowBatchReplace(false);
      setBatchSearch('');
      setBatchReplace('');
      queryClient.invalidateQueries({ queryKey: ['review-pages', projectId] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  // Navigate
  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPageNum(page);
    router.replace(`/pc/projects/${projectId}/review?page=${page}`);
  };

  const nextUnreviewed = async () => {
    try {
      const res = await request.get(`/projects/${projectId}/review/pages/next-unreviewed?current=${currentPageNum}`);
      const data = res.data?.data;
      if (data) {
        setCurrentPageNum(data.page_number);
        router.replace(`/pc/projects/${projectId}/review?page=${data.page_number}`);
      } else {
        message.success('所有页面都已校对完毕！');
      }
    } catch {
      message.error('跳转失败');
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') { e.preventDefault(); handleSave(false); }
        if (e.key === 'f') { e.preventDefault(); setShowBatchReplace(true); setSearchFocused(true); }
        if (e.key === 'Enter') { e.preventDefault(); handleSave(true); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // Page navigation
  const handleKeyNav = useCallback((e: KeyboardEvent) => {
    if (searchFocused) return;
    if (e.key === 'ArrowLeft') goToPage(currentPageNum - 1);
    if (e.key === 'ArrowRight') goToPage(currentPageNum + 1);
  }, [currentPageNum, totalPages, searchFocused]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyNav);
    return () => window.removeEventListener('keydown', handleKeyNav);
  }, [handleKeyNav]);

  return (
    <div className="h-full flex flex-col bg-slate-100 dark:bg-slate-950" ref={containerRef}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button
            size="small"
            icon={<ArrowLeft size={14} />}
            onClick={() => router.push(`/pc/projects/${projectId}`)}
          >
            返回编辑
          </Button>
          <Divider type="vertical" />
          <h1 className="text-sm font-semibold text-slate-700 dark:text-slate-300">校对工作台</h1>
          {stats && (
            <Progress
              percent={stats.progress_percent}
              size="small"
              style={{ width: 120 }}
              format={() => `${stats.reviewed_pages}/${stats.total_pages}`}
            />
          )}
        </div>

        <Space size="small">
          <Button size="small" icon={<SkipForward size={14} />} onClick={nextUnreviewed}>
            下一未校对
          </Button>
          <Button size="small" icon={<Search size={14} />} onClick={() => setShowBatchReplace(true)}>
            批量替换
          </Button>
          <Tooltip title="保存 (Ctrl+S)">
            <Button size="small" icon={<Save size={14} />} onClick={() => handleSave(false)} loading={saving}>
              保存
            </Button>
          </Tooltip>
          <Tooltip title="标记已校对 (Ctrl+Enter)">
            <Button size="small" type="primary" icon={<CheckCircle2 size={14} />} onClick={() => handleSave(true)}>
              校对完成
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Manga page preview */}
        <div className="flex-1 flex items-center justify-center bg-black/90 p-4 relative overflow-auto">
          {isLoading ? (
            <Spin size="large" />
          ) : currentPage ? (
            <div className="relative" style={{ maxHeight: '100%' }}>
              <img
                src={currentPage.original_image_url}
                alt={`Page ${currentPage.page_number}`}
                className="max-h-[calc(100vh-140px)] object-contain rounded shadow-2xl"
              />

              {/* Translation overlay */}
              {!showOriginal && currentPage.regions.map((region) => (
                <div
                  key={region.region_id}
                  className="absolute pointer-events-none"
                  style={{
                    left: `${(region.bbox.x / currentPage.width) * 100}%`,
                    top: `${(region.bbox.y / currentPage.height) * 100}%`,
                    width: `${(region.bbox.width / currentPage.width) * 100}%`,
                    height: `${(region.bbox.height / currentPage.height) * 100}%`,
                  }}
                >
                  <div className="w-full h-full bg-primary-500/10 border border-primary-400/30 rounded" />
                  <div className="absolute inset-0 flex items-center justify-center text-white text-xs bg-black/60 rounded px-1 overflow-hidden">
                    <span className="truncate">
                      {editedTranslations[region.region_id] || region.translated_text || ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-400">暂无页面</div>
          )}

          {/* Page navigation overlay */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/70 backdrop-blur rounded-full px-4 py-2">
            <Button size="small" ghost onClick={() => goToPage(currentPageNum - 1)} disabled={currentPageNum <= 1}>
              <ChevronLeft size={16} />
            </Button>
            <Input
              size="small"
              value={currentPageNum}
              onChange={(e) => goToPage(Number(e.target.value))}
              style={{ width: 50, textAlign: 'center' }}
              className="!bg-white/20 !border-white/30 !text-white text-center"
            />
            <span className="text-xs text-white/70">/ {totalPages}</span>
            <Button size="small" ghost onClick={() => goToPage(currentPageNum + 1)} disabled={currentPageNum >= totalPages}>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>

        {/* Right: Translation editor panel */}
        <div className="w-96 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              译文编辑 — 第 {currentPageNum} 页
            </span>
            <Space size={4}>
              <Tooltip title="切换原文/译文显示">
                <Button size="small" type={showOriginal ? 'dashed' : 'text'} onClick={() => setShowOriginal(!showOriginal)}>
                  <Eye size={14} />
                </Button>
              </Tooltip>
            </Space>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {currentPage?.regions.map((region, idx) => {
              const confidenceColor = region.confidence >= 0.8 ? 'text-green-500' :
                                     region.confidence >= 0.6 ? 'text-orange-500' : 'text-red-500';

              return (
                <Card key={region.region_id} size="small" className="!mb-2">
                  <div className="space-y-2">
                    {/* Region header */}
                    <div className="flex items-center justify-between">
                      <Space size={4}>
                        <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                          #{idx + 1}
                        </span>
                        <Tag color={region.region_type === 'speech' ? 'blue' :
                                   region.region_type === 'thought' ? 'purple' :
                                   region.region_type === 'onomatopoeia' ? 'orange' : 'default'}
                          className="text-[10px] px-1">
                          {region.region_type}
                        </Tag>
                      </Space>
                      <span className={`text-[10px] ${confidenceColor}`}>
                        {Math.round(region.confidence * 100)}%
                      </span>
                    </div>

                    {/* Original text */}
                    <div className="bg-slate-50 dark:bg-slate-800 rounded p-2">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        {region.original_text || '（无原文）'}
                      </p>
                    </div>

                    {/* Translated text (editable) */}
                    <Input.TextArea
                      value={editedTranslations[region.region_id] || ''}
                      onChange={(e) => setEditedTranslations(prev => ({
                        ...prev,
                        [region.region_id]: e.target.value,
                      }))}
                      rows={2}
                      className="text-xs"
                      placeholder="输入译文..."
                    />
                  </div>
                </Card>
              );
            })}

            {(!currentPage?.regions || currentPage.regions.length === 0) && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Edit3 size={32} className="mb-2 opacity-50" />
                <p className="text-sm">暂无文字区域</p>
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800">
            <Space className="w-full" direction="vertical" size="small">
              <Progress
                percent={currentPage ? Math.round((Object.keys(editedTranslations).filter(k => editedTranslations[k]).length / Math.max(currentPage.regions?.length || 1, 1)) * 100) : 0}
                size="small"
                format={(p) => `已填 ${p}%`}
              />
              <div className="flex gap-2">
                <Button size="small" block onClick={() => goToPage(currentPageNum - 1)} disabled={currentPageNum <= 1}>
                  上一页
                </Button>
                <Button size="small" block onClick={() => goToPage(currentPageNum + 1)} disabled={currentPageNum >= totalPages}>
                  下一页
                </Button>
              </div>
            </Space>
          </div>
        </div>
      </div>

      {/* Batch replace modal */}
      <Modal
        title="批量替换"
        open={showBatchReplace}
        onCancel={() => { setShowBatchReplace(false); setSearchFocused(false); }}
        onOk={() => batchReplaceMutation.mutate()}
        confirmLoading={batchReplaceMutation.isPending}
        okText="执行替换"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="space-y-4 mt-2">
          <div>
            <label className="text-sm text-slate-600 dark:text-slate-400 mb-1 block">搜索文本</label>
            <Input
              ref={(ref) => { if (ref && searchFocused) { ref.focus(); setSearchFocused(false); } }}
              value={batchSearch}
              onChange={(e) => setBatchSearch(e.target.value)}
              placeholder="输入要搜索的译文内容"
              prefix={<Search size={14} />}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 dark:text-slate-400 mb-1 block">替换为</label>
            <Input
              value={batchReplace}
              onChange={(e) => setBatchReplace(e.target.value)}
              placeholder="输入替换后的文本"
              prefix={<Replace size={14} />}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 dark:text-slate-400 mb-1 block">范围</label>
            <Select
              value={batchScope}
              onChange={setBatchScope}
              style={{ width: '100%' }}
              options={[
                { value: 'current_page', label: '当前页面' },
                { value: 'all_pages', label: '全部页面' },
              ]}
            />
          </div>
          {batchSearch && batchReplace && (
            <Alert
              type="info"
              message="替换预览"
              description={`将"${batchSearch}"替换为"${batchReplace}"，范围：${batchScope === 'current_page' ? '当前页面' : '全部页面'}`}
              showIcon
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
