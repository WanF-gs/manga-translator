'use client';

import React, { useState, KeyboardEvent } from 'react';
import { Input, Card, Tag, Space, Skeleton, Empty, Button, Select, App, Alert } from 'antd';
import { Search, BookOpen, ArrowRight, WifiOff, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { searchApi, type SearchResult, type SearchParams } from '@/services/search';

const HIGHLIGHT_STYLE = 'bg-yellow-200 dark:bg-yellow-800/60 px-0.5 rounded';

function highlightText(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className={HIGHLIGHT_STYLE}>{part}</mark> : part
  );
}

export default function SearchPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useState<SearchParams>({ q: '', page: 1, page_size: 20 });

  const { data, isLoading, isFetching, isError, error: searchError, refetch } = useQuery({
    queryKey: ['search', searchParams],
    queryFn: async () => {
      if (!searchParams.q) return { items: [], total: 0 };
      const res = await searchApi.search(searchParams);
      return res.data?.data || { items: [], total: 0 };
    },
    enabled: !!searchParams.q,
    staleTime: 60_000,
    retry: false,
  });

  const handleSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) {
      message.warning('请输入搜索关键词');
      return;
    }
    setSearchParams({ q: trimmed, page: 1, page_size: 20 });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleResultClick = (result: SearchResult) => {
    router.push(`/pc/projects/${result.project_id}?page=${result.page_id}#region-${result.region_id}`);
  };

  const items = data?.items || [];
  const total = data?.total || 0;
  const hasSearched = !!searchParams.q;
  const showLoading = hasSearched && (isLoading || isFetching);

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
              <Search size={22} className="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">跨作品搜索</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                在所有翻译作品中检索文本内容
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="输入日语/中文/英文关键词，跨所有作品搜索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              size="large"
              allowClear
              data-testid="search-input"
            />
            <Button
              type="primary"
              size="large"
              onClick={handleSearch}
              loading={isFetching}
              data-testid="search-submit-btn"
              className="min-w-[88px]"
            >
              搜索
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        {!hasSearched && (
          <Empty
            className="mt-20"
            image={<Search size={48} className="text-slate-300 dark:text-slate-600 mx-auto mb-4" />}
            description={
              <div className="space-y-1">
                <p className="text-slate-500 dark:text-slate-400">输入关键词后点击搜索</p>
                <p className="text-xs text-slate-400">支持日文、中文、英文多语言全文检索</p>
              </div>
            }
          />
        )}

        {showLoading && (
          <Space direction="vertical" className="w-full" size="middle">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i} size="small">
                <Skeleton active paragraph={{ rows: 2 }} />
              </Card>
            ))}
          </Space>
        )}

        {hasSearched && !showLoading && isError ? (
          <div className="mt-8">
            <Alert
              type="warning"
              showIcon
              icon={<WifiOff size={16} />}
              message="搜索服务暂不可用"
              description={(searchError as any)?.message || '无法连接到搜索服务，请检查后端是否已启动'}
              action={
                <Button size="small" icon={<RefreshCw size={14} />} onClick={() => refetch()}>
                  重试
                </Button>
              }
            />
          </div>
        ) : hasSearched && !showLoading && items.length === 0 ? (
          <Empty
            className="mt-12"
            description={
              <div>
                <p className="text-slate-500 dark:text-slate-400">
                  未找到与「{searchParams.q}」相关的翻译内容
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  请尝试更换关键词或确认已上传翻译作品
                </p>
              </div>
            }
          />
        ) : null}

        {hasSearched && !showLoading && items.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-slate-500">
                找到 <span className="font-semibold text-primary-600">{total}</span> 条结果
              </p>
              <Select
                size="small"
                value={searchParams.match_type || 'all'}
                onChange={(v) => setSearchParams({ ...searchParams, match_type: v, page: 1 })}
                options={[
                  { value: 'all', label: '全部匹配' },
                  { value: 'exact', label: '精确匹配' },
                  { value: 'fuzzy', label: '模糊匹配' },
                ]}
                style={{ width: 120 }}
              />
            </div>

            <Space direction="vertical" className="w-full" size="small">
              {items.map((result) => (
                <Card
                  key={result.result_id}
                  size="small"
                  hoverable
                  className="cursor-pointer transition-all hover:shadow-md"
                  onClick={() => handleResultClick(result)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <BookOpen size={14} className="text-slate-400" />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {result.project_name}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <span className="text-xs text-slate-400">{result.chapter_name}</span>
                        <span className="text-xs text-slate-400">P{result.page_number}</span>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-1">
                        {result.context_before}
                        <span className="font-semibold text-primary-600 dark:text-primary-400">
                          {highlightText(result.matched_text, searchParams.q)}
                        </span>
                        {result.context_after}
                      </p>
                      <Space size={4}>
                        <Tag color="blue" className="text-xs">{result.match_type === 'exact' ? '精确' : result.match_type === 'fuzzy' ? '模糊' : '语义'}</Tag>
                        <Tag className="text-xs">{(result.score * 100).toFixed(0)}%</Tag>
                      </Space>
                    </div>
                    <ArrowRight size={16} className="text-slate-300 flex-shrink-0 mt-1" />
                  </div>
                </Card>
              ))}
            </Space>

            {total > searchParams.page_size! && (
              <div className="flex justify-center mt-6">
                <Space>
                  <Button
                    disabled={searchParams.page === 1}
                    onClick={() => setSearchParams({ ...searchParams, page: searchParams.page! - 1 })}
                  >
                    上一页
                  </Button>
                  <span className="text-sm text-slate-500 self-center">
                    {searchParams.page} / {Math.ceil(total / searchParams.page_size!)}
                  </span>
                  <Button
                    disabled={searchParams.page! * searchParams.page_size! >= total}
                    onClick={() => setSearchParams({ ...searchParams, page: searchParams.page! + 1 })}
                  >
                    下一页
                  </Button>
                </Space>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
