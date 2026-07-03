'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Spin, message, Tooltip, Empty, Select, Divider } from 'antd';
import {
  Paintbrush,
  Check,
  Copy,
  X,
  Sparkles,
  Palette,
  Loader2,
  AlertCircle,
  Replace,
  Type,
} from 'lucide-react';
import clsx from 'clsx';
import { presetApi } from '@/services/preset';
import { useFontLoaderContext } from '@/hooks/useFontLoader';
import type { StylePreset, StyleConfig, PresetCategory } from '@/types';
import type { EditorRegion } from './types';

interface StylePanelProps {
  selectedRegion: EditorRegion | null;
  allRegions: EditorRegion[];
  onApplyToRegion: (regionId: string, style: StyleConfig) => void;
  onBatchApply: (regionIds: string[], style: StyleConfig) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<PresetCategory, string> = {
  speech: '对话气泡',
  thought: '内心独白',
  narration: '旁白',
  onomatopoeia: '拟声词',
  effect: '效果字',
};

const CATEGORY_COLORS: Record<PresetCategory, string> = {
  speech: '#3B82F6',
  thought: '#8B5CF6',
  narration: '#F59E0B',
  onomatopoeia: '#EF4444',
  effect: '#10B981',
};

/** 样式预览小卡片 */
function PresetCard({
  preset,
  isSelected,
  onSelect,
  onApply,
  canApply,
}: {
  preset: StylePreset;
  isSelected: boolean;
  onSelect: () => void;
  onApply: () => void;
  canApply: boolean;
}) {
  const style = preset.style_config || {};

  return (
    <div
      onClick={onSelect}
      className={clsx(
        'p-2.5 rounded-lg border-2 cursor-pointer transition-all duration-200',
        isSelected
          ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20 shadow-sm'
          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm'
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{preset.name}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {CATEGORY_LABELS[preset.category] || preset.category}
          </p>
        </div>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium"
          style={{ backgroundColor: CATEGORY_COLORS[preset.category] || '#64748B' }}
        >
          {preset.scope}
        </span>
      </div>

      {/* 样式预览 */}
      <div
        className="rounded-md p-2 mb-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
        style={{
          fontFamily: style.font_family || 'inherit',
          fontSize: `${Math.min((style.font_size || 16), 24)}px`,
          color: style.color || '#000000',
          textAlign: (style.text_align || 'center') as any,
          textShadow: style.stroke_width
            ? `0 0 ${style.stroke_width}px ${style.stroke_color || '#fff'}`
            : undefined,
        }}
      >
        <span style={{ writingMode: style.vertical ? 'vertical-rl' : 'horizontal-tb' }}>
          こんにちは
        </span>
      </div>

      {/* 样式标签 */}
      <div className="flex flex-wrap gap-1 text-[10px] text-slate-400">
        <span className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
          {style.font_family?.slice(0, 10) || '默认'}
        </span>
        <span className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
          {style.font_size || 16}px
        </span>
        <span className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
          {style.text_align || 'center'}
        </span>
        {style.vertical && (
          <span className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">竖排</span>
        )}
      </div>

      {/* 操作按钮 */}
      {isSelected && (
        <div className="mt-2 flex gap-1.5">
          <Tooltip title={canApply ? '应用到选中区域' : '请先选中区域'}>
            <Button
              size="small"
              type="primary"
              icon={<Check size={12} />}
              onClick={(e) => {
                e.stopPropagation();
                onApply();
              }}
              disabled={!canApply}
              className="text-xs flex-1"
            >
              应用
            </Button>
          </Tooltip>
          <Tooltip title="批量应用同类型区域">
            <Button
              size="small"
              icon={<Copy size={12} />}
              onClick={(e) => {
                e.stopPropagation();
                // batch apply is handled by parent
              }}
              disabled={!canApply}
              className="text-xs flex-1"
            >
              批量
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export const StylePanel: React.FC<StylePanelProps> = ({
  selectedRegion,
  allRegions,
  onApplyToRegion,
  onBatchApply,
  onClose,
}) => {
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<PresetCategory | 'all'>('all');
  const [applying, setApplying] = useState<string | null>(null);

  // ── v3.0: 批量替换字体（共享 FontLoaderContext）──
  const [batchFontId, setBatchFontId] = useState<string | undefined>(undefined);
  const [batchTarget, setBatchTarget] = useState<'all' | 'selected_type'>('selected_type');
  const [batchReplacing, setBatchReplacing] = useState(false);

  const { fontList, loading: fontsLoading } = useFontLoaderContext();

  const fontOptions = useMemo(() => {
    const list = fontList || [];
    const sys = list.filter(f => f.is_active && f.user_id === null);
    const usr = list.filter(f => f.is_active && f.user_id !== null);
    const groups: { label: string; options: { value: string; label: string }[] }[] = [];
    if (sys.length) groups.push({ label: '系统字体', options: sys.map(f => ({ value: f.font_id, label: f.name })) });
    if (usr.length) groups.push({ label: '我的字体', options: usr.map(f => ({ value: f.font_id, label: f.name })) });
    return groups;
  }, [fontList]);

  const loadPresets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await presetApi.getList(
        activeCategory !== 'all' ? activeCategory : undefined
      );
      // 后端返回 data: { items: [...] }，需要取 items 字段
      const rawData = (res.data as any)?.data;
      const items = Array.isArray(rawData) ? rawData : rawData?.items || [];
      // P1 FIX: 后端返回空列表时也 fallback 到默认预设
      setPresets(items.length > 0 ? items : getDefaultPresets());
    } catch (err: any) {
      const statusCode = err?.response?.status || 0;
      if (statusCode === 404) {
        // 预设服务未部署，使用默认预设
        setPresets(getDefaultPresets());
        setError(null);
      } else {
        setError(err?.message || '加载预设失败');
        setPresets(getDefaultPresets());
      }
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  const handleApplyPreset = useCallback(
    async (preset: StylePreset) => {
      if (!selectedRegion) {
        message.warning('请先选中一个文字区域');
        return;
      }
      setApplying(preset.preset_id);
      try {
        onApplyToRegion(selectedRegion.region_id, preset.style_config);
        message.success(`已应用「${preset.name}」样式`);
      } catch {
        message.error('应用失败');
      } finally {
        setApplying(null);
      }
    },
    [selectedRegion, onApplyToRegion]
  );

  const handleBatchApply = useCallback(
    async (preset: StylePreset) => {
      if (!selectedRegion) {
        message.warning('请先选中一个文字区域作为样式参照');
        return;
      }
      const sameTypeRegions = allRegions.filter(
        (r) => r.type === selectedRegion.type
      );
      if (sameTypeRegions.length === 0) {
        message.warning('没有找到同类型区域');
        return;
      }
      setApplying(preset.preset_id);
      try {
        const ids = sameTypeRegions.map((r) => r.region_id);
        onBatchApply(ids, preset.style_config);
        message.success(`已批量应用「${preset.name}」到 ${ids.length} 个${CATEGORY_LABELS[preset.category] || ''}区域`);
      } catch {
        message.error('批量应用失败');
      } finally {
        setApplying(null);
      }
    },
    [selectedRegion, allRegions, onBatchApply]
  );

  // ── v3.0: 批量替换字体 ──
  const handleBatchFontReplace = useCallback(() => {
    if (!batchFontId) {
      message.warning('请先选择目标字体');
      return;
    }
    const selected = (fontList || []).find((f) => f.font_id === batchFontId);
    if (!selected) return;

    let targetIds: string[];
    if (batchTarget === 'selected_type' && selectedRegion) {
      targetIds = allRegions.filter((r) => r.type === selectedRegion.type).map((r) => r.region_id);
    } else {
      targetIds = allRegions.map((r) => r.region_id);
    }
    if (targetIds.length === 0) {
      message.warning('没有可替换的区域');
      return;
    }
    setBatchReplacing(true);
    try {
      const newStyle: Partial<StyleConfig> = {
        font_id: selected.font_id,
        font_family: selected.name,
      };
      onBatchApply(targetIds, newStyle as StyleConfig);
      message.success(`已将 ${targetIds.length} 个区域的字体替换为「${selected.name}」`);
      setBatchFontId(undefined);
    } catch {
      message.error('批量替换失败');
    } finally {
      setBatchReplacing(false);
    }
  }, [batchFontId, batchTarget, selectedRegion, allRegions, fontList, onBatchApply]);

  const filteredPresets = activeCategory === 'all'
    ? presets
    : presets.filter((p) => p.category === activeCategory);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      {/* 头部 */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette size={16} className="text-primary-500" />
          <span className="text-sm font-medium text-slate-900 dark:text-white">样式预设</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X size={14} className="text-slate-400" />
        </button>
      </div>

      {/* 分类筛选 */}
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex gap-1 overflow-x-auto">
        {(['all', 'speech', 'thought', 'narration', 'onomatopoeia', 'effect'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={clsx(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
              activeCategory === cat
                ? 'bg-primary-500 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            )}
          >
            {cat === 'all' ? '全部' : CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* 预设列表 */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spin tip="加载预设...">
              <div className="p-4" />
            </Spin>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <AlertCircle size={32} className="text-amber-400" />
            <p className="text-xs text-slate-400">{error}</p>
            <Button size="small" onClick={loadPresets} icon={<Loader2 size={12} />}>
              重试
            </Button>
          </div>
        ) : filteredPresets.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无预设样式"
            className="my-8"
          />
        ) : (
          <div className="space-y-2">
            {filteredPresets.map((preset) => (
              <PresetCard
                key={preset.preset_id}
                preset={preset}
                isSelected={selectedPresetId === preset.preset_id}
                onSelect={() => setSelectedPresetId(preset.preset_id)}
                onApply={() => handleApplyPreset(preset)}
                canApply={!!selectedRegion}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── v3.0: 批量替换字体 ── */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
        <div className="flex items-center gap-1.5 mb-2">
          <Replace size={13} className="text-indigo-500" />
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            批量替换字体
          </span>
        </div>
        <Select
          size="small"
          showSearch
          placeholder="选择目标字体..."
          value={batchFontId}
          onChange={(v) => setBatchFontId(v)}
          filterOption={(input, option) =>
            String(option?.label || '').toLowerCase().includes(input.toLowerCase())
          }
          options={[
            ...(fontOptions.map(g => ({
              label: g.label,
              title: g.label,
              options: g.options,
            }))),
          ]}
          className="w-full mb-2"
        />
        <div className="flex gap-1.5">
          <Button
            size="small"
            type={batchTarget === 'selected_type' ? 'primary' : 'default'}
            onClick={() => setBatchTarget('selected_type')}
            disabled={!selectedRegion}
            className="text-[10px] flex-1"
          >
            {selectedRegion ? '同类型' : '同类型'}
          </Button>
          <Button
            size="small"
            type={batchTarget === 'all' ? 'primary' : 'default'}
            onClick={() => setBatchTarget('all')}
            className="text-[10px] flex-1"
          >
            全部区域
          </Button>
          <Button
            size="small"
            type="primary"
            danger
            icon={<Replace size={11} />}
            onClick={handleBatchFontReplace}
            loading={batchReplacing}
            disabled={!batchFontId}
            className="text-[10px]"
          >
            替换
          </Button>
        </div>
        {batchTarget === 'selected_type' && selectedRegion && (
          <p className="text-[10px] text-slate-400 mt-1">
            将替换 {allRegions.filter(r => r.type === selectedRegion.type).length} 个{CATEGORY_LABELS[selectedRegion.type as PresetCategory] || ''}区域
          </p>
        )}
        {batchTarget === 'all' && (
          <p className="text-[10px] text-slate-400 mt-1">
            将替换全部 {allRegions.length} 个区域
          </p>
        )}
      </div>

      {/* 底部批量操作 */}
      {selectedPresetId && selectedRegion && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <Button
            block
            size="small"
            icon={<Sparkles size={14} />}
            onClick={() => {
              const preset = presets.find((p) => p.preset_id === selectedPresetId);
              if (preset) handleBatchApply(preset);
            }}
            loading={applying === selectedPresetId}
            className="text-xs"
          >
            应用到所有同类型文字区域
          </Button>
        </div>
      )}
    </div>
  );
};

/** 后端不可用时的默认预设 */
function getDefaultPresets(): StylePreset[] {
  return [
    {
      preset_id: 'default-speech-1',
      name: '标准对话',
      category: 'speech',
      scope: 'system',
      style_config: {
        font_family: '内置漫画对话体',
        font_size: 16,
        color: '#1e293b',
        stroke_width: 2,
        stroke_color: '#ffffff',
        text_align: 'center',
        vertical: false,
      },
      created_at: '',
    },
    {
      preset_id: 'default-speech-2',
      name: '大声呐喊',
      category: 'speech',
      scope: 'system',
      style_config: {
        font_family: '内置漫画对话体',
        font_size: 22,
        color: '#dc2626',
        stroke_width: 3,
        stroke_color: '#ffffff',
        text_align: 'center',
        vertical: false,
      },
      created_at: '',
    },
    {
      preset_id: 'default-narration-1',
      name: '标准旁白',
      category: 'narration',
      scope: 'system',
      style_config: {
        font_family: '内置漫画旁白体',
        font_size: 14,
        color: '#475569',
        stroke_width: 1,
        stroke_color: '#f8fafc',
        text_align: 'left',
        vertical: false,
      },
      created_at: '',
    },
    {
      preset_id: 'default-narration-2',
      name: '竖排旁白',
      category: 'narration',
      scope: 'system',
      style_config: {
        font_family: '内置漫画旁白体',
        font_size: 14,
        color: '#334155',
        stroke_width: 1,
        stroke_color: '#f1f5f9',
        text_align: 'center',
        vertical: true,
      },
      created_at: '',
    },
    {
      preset_id: 'default-ono-1',
      name: '大型拟声词',
      category: 'onomatopoeia',
      scope: 'system',
      style_config: {
        font_family: '内置拟声词样式',
        font_size: 24,
        color: '#b91c1c',
        stroke_width: 4,
        stroke_color: '#fee2e2',
        text_align: 'center',
        vertical: false,
      },
      created_at: '',
    },
    {
      preset_id: 'default-ono-2',
      name: '轻量拟声',
      category: 'onomatopoeia',
      scope: 'system',
      style_config: {
        font_family: '内置拟声词样式',
        font_size: 16,
        color: '#6d28d9',
        stroke_width: 2,
        stroke_color: '#ede9fe',
        text_align: 'center',
        vertical: false,
      },
      created_at: '',
    },
  ];
}
