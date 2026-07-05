'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, Form, Upload, App, Popconfirm, Input, Select, Tag, Space, Tooltip, Button, type ColumnsType } from 'antd';
import { Plus, UploadCloud, Trash2, Search, Type, Palette, Download, FileType, Eye, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fontApi, type FontData, type FontListParams } from '@/services/font';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';

// B8 fix: Check if URL uses unsupported protocol
function isSupportedUrl(url?: string): boolean {
  if (!url) return false;
  return !url.startsWith('system://') && !url.startsWith('chrome://') && !url.startsWith('file://');
}

const CATEGORY_OPTIONS = [
  { value: 'dialogue', label: '对话气泡' },
  { value: 'narration', label: '旁白文字' },
  { value: 'onomatopoeia', label: '拟声词' },
  { value: 'title', label: '标题文字' },
];

const LICENSE_OPTIONS = [
  { value: 'free_commercial', label: '可商用' },
  { value: 'attribution', label: '需署名' },
  { value: 'personal_only', label: '仅个人使用' },
];

const STYLE_TAG_OPTIONS = [
  { value: '热血', label: '热血' },
  { value: '温馨', label: '温馨' },
  { value: '搞笑', label: '搞笑' },
  { value: '恐怖', label: '恐怖' },
  { value: '通用', label: '通用' },
  { value: '手写', label: '手写' },
  { value: '少女', label: '少女' },
  { value: '少年', label: '少年' },
  { value: '现代', label: '现代' },
  { value: '古典', label: '古典' },
  { value: '粗体', label: '粗体' },
  { value: 'sans-serif', label: '无衬线' },
];

const LANGUAGE_TAG_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日文' },
  { value: 'en', label: '英文' },
  { value: 'ko', label: '韩文' },
];

const CATEGORY_COLORS: Record<string, string> = {
  dialogue: 'blue',
  narration: 'purple',
  onomatopoeia: 'orange',
  title: 'red',
};

const LICENSE_COLORS: Record<string, string> = {
  free_commercial: 'green',
  attribution: 'gold',
  personal_only: 'default',
};

// ── §2.25 Font live preview component with @font-face loading ──
const PREVIEW_SAMPLE_ZH = '永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭。The quick brown fox jumps over the lazy dog.';
const GLYPH_CHECK_CHARS = '你好世界漢字日本語한국어The quick fox 123!@#';

interface FontLivePreviewProps {
  fontUrl: string;
  fontName: string;
}

/** Detect font style (bold/italic) from name or file url so preview reflects actual weight. */
function detectFontStyle(name: string, url: string) {
  const lower = `${name} ${url}`.toLowerCase();
  const isBold = /bold|粗体|heavy|black|extra-bold|extra|weight/.test(lower) && !/extra-light|light/.test(lower);
  const isItalic = /italic|斜体|oblique/.test(lower);
  return { isBold, isItalic };
}

function FontLivePreview({ fontUrl, fontName }: FontLivePreviewProps) {
  const [fontLoaded, setFontLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [glyphResult, setGlyphResult] = useState<{ coverage: number; missing: string[] } | null>(null);
  const loadedRef = useRef(false);
  const style = detectFontStyle(fontName, fontUrl);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    // 声明正确的 weight/style，让浏览器正确匹配，避免英文 fallback 到默认字体
    const descriptors: FontFaceDescriptors = {
      weight: style.isBold ? '700' : '400',
      style: style.isItalic ? 'italic' : 'normal',
    };
    const encodedUrl = fontUrl.replace(/[^/]+$/, (name) => encodeURIComponent(name));
    const fontFace = new FontFace(`preview-${fontName}`, `url(${encodedUrl})`, descriptors);
    fontFace.load().then((f) => {
      document.fonts.add(f);
      setFontLoaded(true);
      // Check glyph coverage
      checkGlyphCoverage(f, GLYPH_CHECK_CHARS).then(setGlyphResult);
    }).catch((err) => {
      setLoadError(`字体加载失败: ${err.message}`);
    });
  }, [fontUrl, fontName]);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Preview rendering */}
      <div className="bg-slate-50 dark:bg-slate-900 p-4 min-h-[80px]">
        {loadError ? (
          <p className="text-red-500 text-sm flex items-center gap-2">
            <AlertTriangle size={14} /> {loadError}
          </p>
        ) : !fontLoaded ? (
          <p className="text-slate-400 text-sm">加载字体中...</p>
        ) : (
          <p
            className="text-xl leading-relaxed whitespace-pre-wrap break-all"
            style={{
              fontFamily: `"preview-${fontName}"`,
              lineHeight: 1.6,
              fontWeight: style.isBold ? 'bold' : 'normal',
              fontStyle: style.isItalic ? 'italic' : 'normal',
            }}
          >
            {PREVIEW_SAMPLE_ZH}
          </p>
        )}
      </div>
      {/* Glyph coverage bar */}
      {glyphResult && (
        <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            {glyphResult.missing.length === 0 ? (
              <CheckCircle2 size={14} className="text-green-500" />
            ) : (
              <AlertTriangle size={14} className="text-amber-500" />
            )}
            <span className="text-slate-600 dark:text-slate-400">
              字符覆盖率: {glyphResult.coverage.toFixed(0)}%
            </span>
          </div>
          {glyphResult.missing.length > 0 && (
            <Tooltip title={`缺失字符: ${glyphResult.missing.join(' ')}`}>
              <span className="text-amber-600 dark:text-amber-400 cursor-help">
                缺 {glyphResult.missing.length} 字
              </span>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Check glyph coverage using Canvas measureText heuristics.
 * Returns coverage percentage and list of characters likely missing (tofu/□).
 */
async function checkGlyphCoverage(
  font: FontFace,
  text: string
): Promise<{ coverage: number; missing: string[] }> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { coverage: 1, missing: [] };

  // Measure reference width for a known-present CJK char
  canvas.width = 100;
  canvas.height = 50;
  ctx.font = `48px "${font.family}"`;
  const refWidth = ctx.measureText('中').width || 1;

  const missing: string[] = [];
  let covered = 0;
  let total = 0;
  for (const ch of text) {
    // Skip whitespace entirely — it has no meaningful glyph to measure
    if (ch === ' ' || ch === '\t' || ch === '\n') continue;
    total++;
    const w = ctx.measureText(ch).width;
    const isCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch);
    // Heuristic: missing glyph (tofu) typically renders as 0-width or much narrower than expected
    const expectedMin = isCJK ? refWidth * 0.3 : 2;
    if (w < expectedMin) {
      missing.push(ch);
    } else {
      covered++;
    }
  }
  const denom = Math.max(1, total);
  return { coverage: Math.min(100, (covered / denom) * 100), missing };
}

export default function FontsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<FontListParams>({});
  const [uploadForm] = Form.useForm();
  const [previewFont, setPreviewFont] = useState<FontData | null>(null);

  const { data: fontData, isLoading, isError, refetch } = useQuery({
    queryKey: ['fonts', filters],
    queryFn: async () => {
      const res = await fontApi.getList(filters);
      return res.data?.data || { items: [], total: 0 };
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const deleteMutation = useMutation({
    mutationFn: (fontId: string) => fontApi.delete(fontId),
    onSuccess: () => {
      message.success('字体已删除');
      queryClient.invalidateQueries({ queryKey: ['fonts'] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async (values: { name: string; category: string; license: string; style_tags?: string[]; language_tags?: string[]; file: any }) => {
      const fd = new FormData();
      if (values.file?.fileList?.[0]?.originFileObj) {
        fd.append('file', values.file.fileList[0].originFileObj);
      }
      const queryParams: Record<string, string> = {
        name: values.name,
        category: values.category,
        license_type: values.license,
      };
      if (values.style_tags?.length) {
        queryParams.style_tags = values.style_tags.join(',');
      }
      if (values.language_tags?.length) {
        queryParams.language_tags = values.language_tags.join(',');
      }
      return fontApi.upload(fd, queryParams);
    },
    onSuccess: () => {
      message.success('字体上传成功');
      setUploadOpen(false);
      uploadForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['fonts'] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const handleUpload = () => {
    uploadForm.validateFields().then((values) => uploadMutation.mutate(values));
  };

  const columns: ColumnsType<FontData> = [
    {
      title: '字体名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
            <Type size={18} className="text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">{name}</p>
            <p className="text-xs text-slate-400">{record.style_tags?.join(', ') || '--'}</p>
          </div>
        </div>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (cat: string) => (
        <Tag color={CATEGORY_COLORS[cat] || 'default'}>
          {CATEGORY_OPTIONS.find((c) => c.value === cat)?.label || cat}
        </Tag>
      ),
    },
    {
      title: '所持语言',
      dataIndex: 'language_tags',
      key: 'language_tags',
      width: 150,
      render: (tags: string[]) => (
        <Space size={4} wrap>
          {(tags || []).map((t) => (
            <Tag key={t} className="text-xs">{t}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '许可证',
      dataIndex: 'license',
      key: 'license',
      width: 130,
      render: (lic: string) => (
        <Tag color={LICENSE_COLORS[lic] || 'default'}>
          {LICENSE_OPTIONS.find((l) => l.value === lic)?.label || lic}
        </Tag>
      ),
    },
    {
      title: '文件大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 100,
      render: (size: number) => size ? `${(size / 1024).toFixed(1)} KB` : '--',
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? '启用' : '停用'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: FontData) => (
        <Space>
          <Tooltip title="预览字体信息">
            <Button
              type="text"
              size="small"
              icon={<Eye size={14} />}
              onClick={() => setPreviewFont(record)}
            />
          </Tooltip>
          <Tooltip title={isSupportedUrl(record.file_url) ? '下载字体' : '系统字体暂不支持下载'}>
            <Button
              type="text"
              size="small"
              icon={<Download size={14} />}
              disabled={!isSupportedUrl(record.file_url)}
              onClick={() => {
                if (isSupportedUrl(record.file_url)) {
                  const a = document.createElement('a');
                  a.href = record.file_url!;
                  a.download = record.name;
                  a.target = '_blank';
                  a.click();
                }
              }}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除该字体？"
            onConfirm={() => deleteMutation.mutate(record.font_id)}
          >
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const items = fontData?.items || [];

  if (isError && !isLoading) {
    return (
      <ErrorDisplay
        message="字体列表加载失败"
        detail="无法连接后端服务，请确认服务已启动后重试"
        onRetry={() => refetch()}
        fullScreen={false}
        className="min-h-[60vh]"
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 顶部操作栏 - 使用玻璃态效果 */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 dark:shadow-indigo-500/10">
                  <Type size={22} className="text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  字体管理
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  上传和管理自定义字体，支持 AI 智能匹配
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => refetch()}
                disabled={isLoading}
                className="btn-secondary text-sm py-2.5 px-5"
              >
                <RefreshCw size={16} />
                刷新
              </button>
              <button
                onClick={() => setUploadOpen(true)}
                className="btn-primary text-sm py-2.5 px-5"
              >
                <Plus size={16} />
                上传字体
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* 过滤器 - 使用玻璃态卡片 */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative group flex-1 max-w-xs">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
              <input
                type="text"
                placeholder="搜索字体名称..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setFilters((prev) => ({ ...prev, category: e.target.value ? undefined : prev.category }));
                }}
                className="input-field pl-10 pr-4 py-2.5 w-full text-sm rounded-xl"
              />
            </div>
            <select
              value={filters.category || ''}
              onChange={(e) => setFilters({ ...filters, category: e.target.value || undefined })}
              className="px-3 py-2.5 text-sm bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 min-w-[130px]"
            >
              <option value="">全部分类</option>
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={filters.license || ''}
              onChange={(e) => setFilters({ ...filters, license: e.target.value || undefined })}
              className="px-3 py-2.5 text-sm bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 min-w-[130px]"
            >
              <option value="">全部许可证</option>
              {LICENSE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => {
                if (filters.is_active === undefined) setFilters({ ...filters, is_active: true });
                else if (filters.is_active === true) setFilters({ ...filters, is_active: false });
                else setFilters({ ...filters, is_active: undefined });
              }}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
                filters.is_active === undefined
                  ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  : filters.is_active
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/40'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {filters.is_active === undefined ? '全部状态' : filters.is_active ? '✓ 仅已启用' : '仅已停用'}
            </button>
          </div>
        </div>

        {/* 字体列表 - 使用自定义样式 */}
        <div className="glass-card overflow-hidden">
          <div className="p-5 border-b border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <Type size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    字体列表
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {items.length > 0 ? `共 ${fontData?.total || items.length} 个字体` : '加载中...'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4 p-4">
                    <div className="skeleton w-12 h-12 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-4 w-1/4 rounded-lg" />
                      <div className="skeleton h-3 w-1/3 rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Type size={28} className="text-slate-400 dark:text-slate-500" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                  暂无字体，点击右上角上传你的第一个字体
                </p>
                <button
                  onClick={() => setUploadOpen(true)}
                  className="btn-primary inline-flex px-5 py-2.5 text-sm"
                >
                  <Plus size={16} />
                  上传字体
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((font: FontData, index: number) => (
                  <div
                    key={font.font_id}
                    className="group flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md transition-all duration-300"
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300">
                        <Type size={20} className="text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {font.name}
                          </h4>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            font.is_active
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {font.is_active ? '启用' : '停用'}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            font.license === 'free_commercial'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : font.license === 'attribution'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {LICENSE_OPTIONS.find(l => l.value === font.license)?.label || font.license}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200/50 dark:bg-slate-700/50">
                            {CATEGORY_OPTIONS.find(c => c.value === font.category)?.label || font.category}
                          </span>
                          {font.language_tags && font.language_tags.map((tag: string) => (
                            <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-800">
                              {tag}
                            </span>
                          ))}
                          {font.file_size && (
                            <span>{(font.file_size / 1024).toFixed(1)} KB</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <button
                        onClick={() => setPreviewFont(font)}
                        className="p-2 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all"
                        title="预览字体"
                      >
                        <Eye size={16} />
                      </button>
                      {isSupportedUrl(font.file_url) && (
                        <button
                          onClick={() => {
                            const a = document.createElement('a');
                            a.href = font.file_url!;
                            a.download = font.name;
                            a.target = '_blank';
                            a.click();
                          }}
                          className="p-2 rounded-lg text-slate-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all"
                          title="下载字体"
                        >
                          <Download size={16} />
                        </button>
                      )}
                      <Popconfirm
                        title="确认删除该字体？"
                        onConfirm={() => deleteMutation.mutate(font.font_id)}
                      >
                        <button className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
                          <Trash2 size={16} />
                        </button>
                      </Popconfirm>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 字体预览弹窗 — §2.25 增强：实时渲染预览 + 缺字标记 */}
      <Modal
        title="字体详情"
        open={!!previewFont}
        onCancel={() => setPreviewFont(null)}
        footer={null}
        destroyOnHidden
        width={520}
      >
        {previewFont && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
                <Type size={28} className="text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold">{previewFont.name}</h3>
                <p className="text-sm text-slate-500">{previewFont.style_tags?.join(', ') || '无样式标签'}</p>
              </div>
            </div>
            {/* Font live preview — @font-face dynamic loading */}
            {previewFont.file_url && (
              <FontLivePreview fontUrl={previewFont.file_url} fontName={previewFont.name} />
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-400">分类：</span><Tag color={CATEGORY_COLORS[previewFont.category] || 'default'}>{CATEGORY_OPTIONS.find(c => c.value === previewFont.category)?.label || previewFont.category}</Tag></div>
              <div><span className="text-slate-400">许可：</span><Tag color={LICENSE_COLORS[previewFont.license] || 'default'}>{LICENSE_OPTIONS.find(l => l.value === previewFont.license)?.label || previewFont.license}</Tag></div>
              <div><span className="text-slate-400">状态：</span><Tag color={previewFont.is_active ? 'green' : 'default'}>{previewFont.is_active ? '已启用' : '已停用'}</Tag></div>
              <div><span className="text-slate-400">大小：</span>{(previewFont.file_size ? `${(previewFont.file_size / 1024).toFixed(1)} KB` : '--')}</div>
            </div>
            <div>
              <span className="text-sm text-slate-400">支持语言：</span>
              <Space size={4} wrap className="mt-1">
                {(previewFont.language_tags || []).map(t => <Tag key={t}>{t}</Tag>)}
              </Space>
            </div>
            {isSupportedUrl(previewFont.file_url) ? (
              <Button block icon={<Download size={14} />} onClick={() => {
                const a = document.createElement('a');
                a.href = previewFont.file_url!;
                a.download = previewFont.name;
                a.target = '_blank';
                a.click();
              }}>下载字体文件</Button>
            ) : (
              <p className="text-xs text-amber-500">这是系统内置字体，无需下载</p>
            )}
          </div>
        )}
      </Modal>

      {/* 上传弹窗 */}
      <Modal
        title="上传字体"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onOk={handleUpload}
        confirmLoading={uploadMutation.isPending}
        destroyOnHidden
      >
        <Form form={uploadForm} layout="vertical" className="mt-4">
          <Form.Item name="name" label="字体名称" rules={[{ required: true, message: '请输入字体名称' }]}>
            <Input placeholder="如：手写体、粗黑体" prefix={<Type size={14} />} />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
            <Select options={CATEGORY_OPTIONS} placeholder="请选择分类" />
          </Form.Item>
          <Form.Item name="license" label="许可证" rules={[{ required: true, message: '请选择许可证' }]}>
            <Select options={LICENSE_OPTIONS} placeholder="请选择许可证" />
          </Form.Item>
          <Form.Item name="style_tags" label="风格标签">
            <Select
              mode="multiple"
              placeholder="选择风格标签（可选）"
              options={STYLE_TAG_OPTIONS}
              maxTagCount={5}
              allowClear
            />
          </Form.Item>
          <Form.Item name="language_tags" label="支持语言">
            <Select
              mode="multiple"
              placeholder="选择支持语言（可选）"
              options={LANGUAGE_TAG_OPTIONS}
              maxTagCount={4}
              allowClear
            />
          </Form.Item>
          <Form.Item
            name="file"
            label="字体文件"
            valuePropName="fileList"
            getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)}
            rules={[{ required: true, message: '请上传字体文件' }]}
            extra="支持 .ttf / .otf 格式，大小不超过 20MB"
          >
            <Upload
              accept=".ttf,.otf"
              maxCount={1}
              beforeUpload={(file) => {
                if (file.size > 20 * 1024 * 1024) {
                  message.error('文件大小不能超过 20MB');
                  return Upload.LIST_IGNORE;
                }
                if (!/\.(ttf|otf)$/i.test(file.name)) {
                  message.error('仅支持 .ttf 和 .otf 格式');
                  return Upload.LIST_IGNORE;
                }
                return false;
              }}
            >
              <Button icon={<UploadCloud size={14} />}>选择文件</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
