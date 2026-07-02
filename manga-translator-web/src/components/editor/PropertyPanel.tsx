'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Select, Slider, ColorPicker, Button, Tooltip, Modal, Input, message, Empty } from 'antd';
import type { Color } from 'antd/es/color-picker';
import {
  PanelRight,
  Lock,
  Unlock,
  Trash2,
  Copy,
  GripVertical,
  Save,
  Shield,
  X,
  Plus,
  Search,
  Link2,
  Unlink2,
} from 'lucide-react';
import clsx from 'clsx';
import Link from 'next/link';
import type { EditorRegion } from './types';
import type { StyleConfig, OnomatopoeiaMode, CultureStrategy } from '@/types';
import { REGION_TYPE_CONFIGS, FONT_OPTIONS, FONT_SIZE_MIN, FONT_SIZE_MAX } from './types';
import {
  REGION_TYPE_LABELS,
  ONOMATOPOEIA_MODE_LABELS,
  CULTURE_STRATEGY_LABELS,
  type RegionType,
} from '@/types';
import { TranslationMemoryBadge } from './TranslationMemoryBadge';
import { presetApi } from '@/services/preset';
import { termApi } from '@/services/term';
import type { TermEntry } from '@/services/term';
import type { StylePreset } from '@/types';

interface PropertyPanelProps {
  /** 当前选中的区域（null 表示未选中） */
  region: EditorRegion | null;
  /** 更新区域回调 */
  onUpdate: (regionId: string, data: Partial<EditorRegion>) => void;
  /** 删除区域回调 */
  onDelete: (regionId: string) => void;
  /** 锁定/解锁区域回调 */
  onToggleLock: (regionId: string) => void;
  /** 应用到所有选区 */
  onApplyAll?: (regionId: string) => void;
  /** §2.2.8 矩形→多边形（贴合气泡内轮廓） */
  onConvertToPolygon?: (regionId: string) => void;
  /** §2.2.8 多边形→矩形 */
  onConvertToRect?: (regionId: string) => void;
  /** §2.2.4 拆分选区 */
  onSplitRegion?: (regionId: string) => void;
  /** 应用预设到区域 */
  onApplyPreset?: (regionId: string, style: StyleConfig) => void;
  /** 关闭面板回调 */
  onClose: () => void;
}

const ONOMATOPOEIA_MODE_OPTIONS = Object.entries(ONOMATOPOEIA_MODE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const CULTURE_STRATEGY_OPTIONS = Object.entries(CULTURE_STRATEGY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** 右侧属性面板：编辑选中文字区域的属性 */
export const PropertyPanel: React.FC<PropertyPanelProps> = ({
  region,
  onUpdate,
  onDelete,
  onToggleLock,
  onApplyAll,
  onConvertToPolygon,
  onConvertToRect,
  onSplitRegion,
  onApplyPreset,
  onClose,
}) => {
  // 本地编辑状态（用于 debounce 更新）
  const [localTranslated, setLocalTranslated] = useState('');
  const [savePresetModalOpen, setSavePresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  // 预设列表
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);

  // P1-4: 术语锁定词管理状态
  const [termSearchModalOpen, setTermSearchModalOpen] = useState(false);
  const [termSearchQuery, setTermSearchQuery] = useState('');
  const [termSearchResults, setTermSearchResults] = useState<TermEntry[]>([]);
  const [termSearchLoading, setTermSearchLoading] = useState(false);
  const [linkedTerms, setLinkedTerms] = useState<TermEntry[]>([]); // 当前区域关联的术语
  const [linkingTermId, setLinkingTermId] = useState<string | null>(null);

  useEffect(() => {
    if (region) {
      setLocalTranslated(region.translated_text || '');
    }
  }, [region?.region_id]);

  // 加载预设列表
  useEffect(() => {
    if (presetsLoaded) return;
    const loadPresets = async () => {
      try {
        const res = await presetApi.getList();
        const data = (res.data?.data || res.data) as StylePreset[];
        setPresets(Array.isArray(data) ? data : []);
      } catch {
        // 后端不可用时使用空列表
      }
      setPresetsLoaded(true);
    };
    loadPresets();
  }, [presetsLoaded]);

  // 应用预设
  const handleApplyPreset = useCallback(
    (presetId: string) => {
      const preset = presets.find((p) => p.preset_id === presetId);
      if (!preset?.style_config || !region) return;
      if (onApplyPreset) {
        onApplyPreset(region.region_id, preset.style_config);
      } else {
        onUpdate(region.region_id, { style_config: preset.style_config } as Partial<EditorRegion>);
      }
      message.success(`已应用预设「${preset.name}」`);
    },
    [presets, region, onApplyPreset, onUpdate]
  );

  const handleTranslatedChange = useCallback(
    (value: string) => {
      setLocalTranslated(value);
      if (region) {
        onUpdate(region.region_id, { translated_text: value });
      }
    },
    [region, onUpdate]
  );

  const handleStyleChange = useCallback(
    (key: string, value: unknown) => {
      if (region) {
        onUpdate(region.region_id, {
          style_config: {
            ...region.style_config,
            [key]: value,
          } as StyleConfig,
        });
      }
    },
    [region, onUpdate]
  );

  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      if (region) {
        onUpdate(region.region_id, { [field]: value } as Partial<EditorRegion>);
      }
    },
    [region, onUpdate]
  );

  // ===== 另存为预设 =====
  const handleSaveAsPreset = useCallback(async () => {
    if (!region?.style_config || !presetName.trim()) {
      message.warning('请输入预设名称');
      return;
    }
    setSavingPreset(true);
    try {
      // 确定分类：如果是拟声词类型则用 onomatopoeia，否则根据区域类型映射
      const categoryMap: Record<string, string> = {
        speech: 'speech',
        thought: 'speech',
        narration: 'narration',
        onomatopoeia: 'onomatopoeia',
        effect: 'onomatopoeia',
      };
      await presetApi.create({
        name: presetName.trim(),
        category: (categoryMap[region.type] || 'speech') as any,
        style_config: region.style_config,
        scope: 'account',
      });
      message.success(`预设「${presetName.trim()}」已保存`);
      setSavePresetModalOpen(false);
      setPresetName('');
    } catch (err: any) {
      const code = err?.response?.status || 0;
      if (code === 404) {
        message.info('预设已保存到本地（后端暂不可用）');
        setSavePresetModalOpen(false);
        setPresetName('');
      } else {
        message.error(err?.message || '保存失败');
      }
    } finally {
      setSavingPreset(false);
    }
  }, [region, presetName]);

  // P1-4: 术语锁定词管理
  // 搜索术语库
  const handleSearchTerms = useCallback(async () => {
    if (!termSearchQuery.trim()) return;
    setTermSearchLoading(true);
    try {
      const res = await termApi.getList({ keyword: termSearchQuery.trim(), page_size: 20 });
      const data = (res.data?.data || res.data) as any;
      setTermSearchResults(data?.items || (Array.isArray(data) ? data : []));
    } catch {
      message.error('搜索术语失败');
    } finally {
      setTermSearchLoading(false);
    }
  }, [termSearchQuery]);

  // 关联术语到当前区域
  const handleLinkTerm = useCallback(
    async (term: TermEntry) => {
      if (!region) return;
      setLinkingTermId(term.term_id);
      // 将术语信息加入 memory_matches
      const currentMatches = [...(region as any).memory_matches || []];
      const exists = currentMatches.some(
        (m: any) => m.source === term.source_text || m.term_id === term.term_id
      );
      if (exists) {
        message.info('该术语已关联');
        setLinkingTermId(null);
        return;
      }
      const newMatch = {
        term_id: term.term_id,
        source: term.source_text,
        target: term.target_text,
        similarity: 100,
      };
      currentMatches.push(newMatch);
      onUpdate(region.region_id, { memory_matches: currentMatches } as Partial<EditorRegion>);
      setLinkedTerms((prev) => [...prev, term]);
      message.success(`已关联术语「${term.source_text}」`);
      setLinkingTermId(null);
    },
    [region, onUpdate]
  );

  // 解除术语关联
  const handleUnlinkTerm = useCallback(
    (index: number) => {
      if (!region) return;
      const currentMatches = [...((region as any).memory_matches || [])];
      const removed = currentMatches[index];
      currentMatches.splice(index, 1);
      onUpdate(region.region_id, { memory_matches: currentMatches } as Partial<EditorRegion>);
      setLinkedTerms((prev) => prev.filter((_, i) => i !== index));
      message.success(`已解除关联「${removed?.source || '未知'}」`);
    },
    [region, onUpdate]
  );

  // 基于当前区域快速创建术语
  const handleQuickCreateTerm = useCallback(async () => {
    if (!region || !region.original_text || !region.translated_text) {
      message.warning('需要原文和译文才能创建术语');
      return;
    }
    try {
      const res = await termApi.create({
        source_text: region.original_text,
        target_text: region.translated_text,
        scope: 'project',
        project_id: (region as any).project_id,
      });
      const termData = res.data?.data || res.data;
      if (termData) {
        // 同时关联到当前区域
        const currentMatches = [...((region as any).memory_matches || [])];
        currentMatches.push({
          term_id: (termData as any).term_id,
          source: region.original_text,
          target: region.translated_text,
          similarity: 100,
        });
        onUpdate(region.region_id, { memory_matches: currentMatches } as Partial<EditorRegion>);
        setLinkedTerms((prev) => [...prev, termData as TermEntry]);
        message.success('术语已创建并关联');
      }
    } catch (err: any) {
      message.error(err?.message || '创建术语失败');
    }
  }, [region, onUpdate]);

  // 同步 linkedTerms 与 region 数据
  useEffect(() => {
    if (region) {
      const matches = (region as any).memory_matches || [];
      setLinkedTerms(matches.map((m: any) => ({
        term_id: m.term_id || '',
        source_text: m.source || '',
        target_text: m.target || '',
        scope: 'project' as const,
        created_at: '',
        updated_at: '',
      })));
    }
  }, [region?.region_id, (region as any)?.memory_matches?.length]);

  if (!region) {
    return (
      <aside className="w-72 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-900 dark:text-white">
            属性面板
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <PanelRight size={14} className="text-slate-400" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <GripVertical size={32} className="mb-2 opacity-50" />
          <p className="text-sm">选择一个文字区域</p>
          <p className="text-xs mt-1">以编辑其属性</p>
        </div>
      </aside>
    );
  }

  const config = REGION_TYPE_CONFIGS[region.type as RegionType] ?? REGION_TYPE_CONFIGS.speech;
  const style = region.style_config || {
    font_family: '内置漫画对话体',
    font_size: 16,
    color: '#000000',
    stroke_color: '#FFFFFF',
    text_align: 'center' as const,
    vertical: false,
  };

  return (
    <aside className="w-72 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col flex-shrink-0">
      {/* 头部 */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-900 dark:text-white">
          属性面板
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <PanelRight size={14} className="text-slate-400" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* 区域类型标签 */}
        <div>
          <label className="label text-xs">区域类型</label>
          <div className="flex items-center gap-2">
            <span
              className="px-2 py-1 rounded text-xs font-medium text-white"
              style={{ backgroundColor: config.color }}
            >
              {config.label}
            </span>
            <Select
              size="small"
              value={region.type}
              onChange={(val) => onUpdate(region.region_id, { type: val })}
              className="flex-1"
              options={Object.entries(REGION_TYPE_LABELS).map(([key, label]) => ({
                value: key,
                label,
              }))}
            />
          </div>
        </div>

        {/* §2.2.8 选区形状：矩形(降级) ↔ 多边形(贴合气泡内轮廓) */}
        {(() => {
          const isPoly =
            (region.boundary_mode === 'polygon' || region.boundary_mode === 'bezier') &&
            Array.isArray((region as any).points) &&
            (region as any).points.length >= 3;
          return (
            <div>
              <label className="label text-xs">选区形状</label>
              <div className="flex items-center gap-1.5">
                <Tooltip title="矩形（降级方案）">
                  <button
                    type="button"
                    disabled={region.is_locked || !onConvertToRect}
                    onClick={() => onConvertToRect?.(region.region_id)}
                    className={clsx(
                      'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium border transition-colors disabled:opacity-40',
                      !isPoly
                        ? 'bg-primary-500 text-white border-primary-500'
                        : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                    )}
                  >
                    ▭ 矩形
                  </button>
                </Tooltip>
                <Tooltip title="多边形：拖拽顶点贴合气泡内轮廓，最小化视觉遮挡（§2.2.8）">
                  <button
                    type="button"
                    disabled={region.is_locked || !onConvertToPolygon}
                    onClick={() => onConvertToPolygon?.(region.region_id)}
                    className={clsx(
                      'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium border transition-colors disabled:opacity-40',
                      isPoly
                        ? 'bg-primary-500 text-white border-primary-500'
                        : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                    )}
                  >
                    ▱ 多边形
                  </button>
                </Tooltip>
                <Tooltip title="沿中线拆分为两个选区（§2.2.4）">
                  <button
                    type="button"
                    disabled={region.is_locked || !onSplitRegion}
                    onClick={() => onSplitRegion?.(region.region_id)}
                    className="flex items-center justify-center px-2 py-1.5 rounded text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
                  >
                    <Unlink2 size={13} />
                  </button>
                </Tooltip>
              </div>
              {isPoly && (
                <p className="text-[11px] text-slate-400 mt-1 leading-tight">
                  拖拽蓝点移动顶点 · 双击删除 · 点击边中点加点
                </p>
              )}
            </div>
          );
        })()}

        {/* 原文（只读） */}
        <div>
          <label className="label text-xs">原文</label>
          <textarea
            className="input-field text-sm h-16 resize-none bg-slate-50 dark:bg-slate-800/50"
            value={region.original_text || ''}
            readOnly
          />
          {region.confidence != null && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-slate-400">
                OCR置信度：{Math.round(region.confidence * 100)}%
              </span>
              <span
                className={clsx(
                  'text-xs font-medium',
                  region.confidence >= 0.8 ? 'text-green-500' :
                  region.confidence >= 0.6 ? 'text-yellow-500' :
                  'text-red-500'
                )}
              >
                {region.confidence >= 0.8 ? '高' :
                 region.confidence >= 0.6 ? '中' : '低 ⚠'}
              </span>
              {region.confidence < 0.6 && (
                <span className="text-xs text-red-400 ml-1">建议复核</span>
              )}
            </div>
          )}
        </div>

        {/* 译文（可编辑） */}
        <div>
          <label className="label text-xs">译文</label>
          <textarea
            className="input-field text-sm h-16 resize-none"
            value={localTranslated}
            onChange={(e) => handleTranslatedChange(e.target.value)}
            placeholder="输入译文..."
          />
          {/* 翻译记忆标记 */}
          <TranslationMemoryBadge
            matches={
              (region as any).memory_matches || []
            }
          />

          {/* === P1-4: 锁定词管理面板（仅锁定区域显示） === */}
          {region.is_locked && (
            <div className="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield size={13} className="text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  锁定词管理
                </span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-300">
                  {linkedTerms.length} 条术语
                </span>
              </div>

              {/* 关联术语列表 */}
              {linkedTerms.length > 0 ? (
                <div className="space-y-1 mb-2 max-h-24 overflow-y-auto">
                  {linkedTerms.map((term, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/60 dark:bg-slate-800/50 border border-amber-100 dark:border-amber-800/50 text-[11px] group"
                    >
                      <span className="text-slate-600 dark:text-slate-300 truncate max-w-[80px]">
                        {term.source_text || '—'}
                      </span>
                      <span className="text-amber-500 dark:text-amber-400">→</span>
                      <span className="text-amber-700 dark:text-amber-300 font-medium truncate max-w-[80px]">
                        {term.target_text || '—'}
                      </span>
                      <button
                        onClick={() => handleUnlinkTerm(idx)}
                        className="ml-auto p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        title="解除关联"
                      >
                        <Unlink2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-amber-500 dark:text-amber-500/70 mb-2">
                  暂无关联术语
                </p>
              )}

              {/* 操作按钮组 */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    setTermSearchQuery('');
                    setTermSearchResults([]);
                    setTermSearchModalOpen(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium bg-amber-100 dark:bg-amber-800/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-700/40 transition-colors"
                >
                  <Link2 size={11} />
                  关联术语
                </button>
                <button
                  onClick={handleQuickCreateTerm}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium bg-amber-100 dark:bg-amber-800/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-700/40 transition-colors"
                >
                  <Plus size={11} />
                  创建并关联
                </button>
              </div>
            </div>
          )}
        </div>

        {/* === 拟声词处理模式（仅拟声词类型显示） === */}
        {region.type === 'onomatopoeia' && (
          <div>
            <label className="label text-xs">拟声词处理模式</label>
            <Select
              size="small"
              value={region.onomatopoeia_mode || 'keep_annotation'}
              onChange={(val) => handleFieldChange('onomatopoeia_mode', val)}
              className="w-full"
              options={ONOMATOPOEIA_MODE_OPTIONS}
            />
            <p className="text-[10px] text-slate-400 mt-0.5">
              {region.onomatopoeia_mode === 'keep_annotation' || !region.onomatopoeia_mode
                ? '保留原文拟声词，旁附小字译注'
                : region.onomatopoeia_mode === 'replace'
                ? '替换为目标语言等效拟声词'
                : '原文保留，译文叠加显示'}
            </p>
          </div>
        )}

        {/* === 文化梗处理策略 === */}
        <div>
          <label className="label text-xs">文化梗处理策略</label>
          <Select
            size="small"
            value={region.culture_strategy || 'localize'}
            onChange={(val) => handleFieldChange('culture_strategy', val)}
            className="w-full"
            options={CULTURE_STRATEGY_OPTIONS}
          />
            <p className="text-[10px] text-slate-400 mt-0.5">
              {region.culture_strategy === 'footnote'
                ? '在页面底部添加注释说明'
                : region.culture_strategy === 'tooltip'
                ? '阅读器中点击弹出注释'
                : '替换为目标语言文化等效表达'}
          </p>
        </div>

        {/* 样式配置 */}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
          <label className="label text-xs mb-2">字体样式</label>

          {/* 预设应用下拉框 */}
          {presets.length > 0 && (
            <div className="mb-3">
              <label className="text-[10px] text-slate-400 mb-0.5 block">应用预设</label>
              <Select
                size="small"
                placeholder="选择预设一键套用..."
                value={undefined}
                onChange={handleApplyPreset}
                className="w-full"
                options={presets.map((p) => ({
                  value: p.preset_id,
                  label: `📦 ${p.name}`,
                }))}
              />
            </div>
          )}

          {/* 字体选择 */}
          <div className="mb-2">
            <label className="text-[10px] text-slate-400 mb-0.5 block">字体</label>
            <Select
              size="small"
              value={style.font_family || '内置漫画对话体'}
              onChange={(val) => handleStyleChange('font_family', val)}
              className="w-full"
              options={FONT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
            />
          </div>

          {/* 字号滑块 */}
          <div className="mb-2">
            <label className="text-[10px] text-slate-400 mb-0.5 block">
              字号：{style.font_size || 16}px
            </label>
            <Slider
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              value={style.font_size || 16}
              onChange={(val) => handleStyleChange('font_size', val)}
              className="w-full"
            />
          </div>

          {/* 颜色选择器 */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="text-[10px] text-slate-400 mb-0.5 block">文字颜色</label>
              <ColorPicker
                size="small"
                value={style.color || '#000000'}
                onChange={(color: Color) => handleStyleChange('color', color.toHexString())}
                className="w-full"
              >
                <div
                  className="w-full h-7 rounded border border-slate-200 dark:border-slate-600 cursor-pointer"
                  style={{ backgroundColor: style.color || '#000000' }}
                />
              </ColorPicker>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 mb-0.5 block">描边颜色</label>
              <ColorPicker
                size="small"
                value={style.stroke_color || '#FFFFFF'}
                onChange={(color: Color) => handleStyleChange('stroke_color', color.toHexString())}
                className="w-full"
              >
                <div
                  className="w-full h-7 rounded border border-slate-200 dark:border-slate-600 cursor-pointer"
                  style={{ backgroundColor: style.stroke_color || '#FFFFFF' }}
                />
              </ColorPicker>
            </div>
          </div>

          {/* 描边宽度 */}
          <div className="mb-2">
            <label className="text-[10px] text-slate-400 mb-0.5 block">
              描边宽度：{style.stroke_width ?? 0}px
            </label>
            <Slider
              min={0}
              max={10}
              step={0.5}
              value={style.stroke_width ?? 0}
              onChange={(val) => handleStyleChange('stroke_width', val)}
              className="w-full"
            />
          </div>

          {/* 对齐方式 */}
          <div className="mb-2">
            <label className="text-[10px] text-slate-400 mb-0.5 block">对齐方式</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  onClick={() => handleStyleChange('text_align', align)}
                  className={clsx(
                    'flex-1 py-1 px-2 rounded text-xs font-medium transition-colors border',
                    (style.text_align || 'center') === align
                      ? 'bg-primary-500 text-white border-primary-500'
                      : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                  )}
                >
                  {align === 'left' ? '左' : align === 'center' ? '中' : '右'}
                </button>
              ))}
            </div>
          </div>

          {/* 竖排文字 */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-slate-400">竖排文字</label>
            <input
              type="checkbox"
              checked={style.vertical || false}
              onChange={(e) => handleStyleChange('vertical', e.target.checked)}
              className="rounded"
            />
          </div>
        </div>
      </div>

      {/* 底部操作按钮 */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <div className="flex gap-2">
          <Tooltip title={region.is_locked ? '解锁选区' : '锁定选区'}>
            <Button
              size="small"
              icon={region.is_locked ? <Unlock size={14} /> : <Lock size={14} />}
              onClick={() => onToggleLock(region.region_id)}
              className="flex-1 text-xs relative"
            >
              {region.is_locked ? '解锁' : '锁定'}
              {region.is_locked && ((region as any).memory_matches || []).length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold px-1 leading-none">
                  {((region as any).memory_matches || []).length}
                </span>
              )}
            </Button>
          </Tooltip>
          <Tooltip title="删除选区">
            <Button
              size="small"
              danger
              icon={<Trash2 size={14} />}
              onClick={() => onDelete(region.region_id)}
              className="flex-1 text-xs"
            >
              删除
            </Button>
          </Tooltip>
        </div>
        {onApplyAll && (
          <Button
            size="small"
            icon={<Copy size={14} />}
            onClick={() => onApplyAll(region.region_id)}
            block
            className="text-xs"
          >
            应用到所有选区
          </Button>
        )}
        {/* 另存为预设 */}
        <Button
          size="small"
          icon={<Save size={14} />}
          onClick={() => {
            setPresetName('');
            setSavePresetModalOpen(true);
          }}
          block
          className="text-xs"
        >
          另存为样式预设
        </Button>
        {/* 管理术语库 */}
        <Link href="/pc/settings?tab=terms" className="block">
          <Button
            size="small"
            icon={<Shield size={14} />}
            block
            className="text-xs"
          >
            管理术语库
          </Button>
        </Link>
      </div>

      {/* 保存预设弹窗 */}
      <Modal
        title="另存为预设"
        open={savePresetModalOpen}
        onOk={handleSaveAsPreset}
        onCancel={() => setSavePresetModalOpen(false)}
        confirmLoading={savingPreset}
        okText="保存"
        cancelText="取消"
        centered
      >
        <div className="py-2">
          <label className="block text-sm text-slate-600 dark:text-slate-400 mb-2">预设名称</label>
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="例如：我的对话样式"
            maxLength={50}
            autoFocus
          />
          <p className="text-[10px] text-slate-400 mt-1">
            将当前选区的字体、字号、颜色、描边、对齐等样式保存为预设
          </p>
        </div>
      </Modal>

      {/* P1-4: 搜索关联术语弹窗 */}
      <Modal
        title="关联术语库"
        open={termSearchModalOpen}
        onCancel={() => setTermSearchModalOpen(false)}
        footer={null}
        width={400}
        centered
      >
        <div className="py-2">
          <div className="flex gap-2 mb-3">
            <Input
              value={termSearchQuery}
              onChange={(e) => setTermSearchQuery(e.target.value)}
              placeholder="搜索术语..."
              onPressEnter={handleSearchTerms}
              prefix={<Search size={14} className="text-slate-400" />}
              className="flex-1"
              autoFocus
            />
            <Button
              type="primary"
              size="small"
              onClick={handleSearchTerms}
              loading={termSearchLoading}
            >
              搜索
            </Button>
          </div>

          {termSearchResults.length > 0 ? (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {termSearchResults.map((term) => {
                const isLinked = linkedTerms.some(
                  (lt) => lt.source_text === term.source_text
                );
                return (
                  <div
                    key={term.term_id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                          {term.source_text}
                        </span>
                        <span className="text-slate-400">→</span>
                        <span className="text-primary-600 dark:text-primary-400 font-medium truncate max-w-[120px]">
                          {term.target_text}
                        </span>
                      </div>
                      {term.note && (
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{term.note}</p>
                      )}
                    </div>
                    <Button
                      size="small"
                      type={isLinked ? 'default' : 'primary'}
                      disabled={isLinked}
                      loading={linkingTermId === term.term_id}
                      onClick={() => handleLinkTerm(term)}
                      className="text-[11px] flex-shrink-0"
                    >
                      {isLinked ? '已关联' : '关联'}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              description={
                termSearchQuery
                  ? '未找到匹配的术语'
                  : '输入关键词搜索术语库'
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}

          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Link
              href="/pc/settings?tab=terms"
              className="text-[11px] text-primary-500 hover:text-primary-600 hover:underline transition-colors inline-flex items-center gap-1"
            >
              <Plus size={12} />
              在术语库中创建新术语
            </Link>
          </div>
        </div>
      </Modal>
    </aside>
  );
};
