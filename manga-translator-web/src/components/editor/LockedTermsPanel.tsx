'use client';

/**
 * 锁定术语面板 - 任务2
 * 在PropertyPanel中管理当前作品的锁定词（不可翻译的原词）
 * 支持添加/删除锁定词、导入预设术语库中的词、搜索过滤
 */
import React, { useState, useCallback, useMemo } from 'react';
import { Input, Button, Tag, Tooltip, Empty, Popconfirm, message, Select } from 'antd';
import {
  Search,
  Plus,
  Trash2,
  Shield,
  Import,
  BookOpen,
  X,
} from 'lucide-react';
import clsx from 'clsx';

export interface LockedTerm {
  /** 锁定词唯一标识 */
  id: string;
  /** 原词（不可翻译） */
  word: string;
  /** 来源：manual=手动添加, preset=从预设导入 */
  source: 'manual' | 'preset';
  /** 来源预设ID（当source为preset时） */
  presetId?: string;
  /** 备注 */
  note?: string;
  /** 创建时间 */
  createdAt: string;
}

interface LockedTermsPanelProps {
  /** 当前锁定词列表 */
  lockedTerms: LockedTerm[];
  /** 添加锁定词 */
  onAdd: (word: string) => void;
  /** 删除锁定词 */
  onDelete: (id: string) => void;
  /** 批量导入锁定词（从预设术语库） */
  onImportPreset: (terms: Array<{ id: string; word: string; note?: string }>) => void;
  /** 预设术语库数据（用于导入） */
  presetTerms: Array<{ term_id: string; source_text: string; target_text: string; note?: string }>;
  /** 预设术语加载状态 */
  presetTermsLoading?: boolean;
  /** 作品ID（用于过滤项目级术语） */
  projectId?: string;
  /** 关闭面板回调 */
  onClose?: () => void;
}

export const LockedTermsPanel: React.FC<LockedTermsPanelProps> = ({
  lockedTerms,
  onAdd,
  onDelete,
  onImportPreset,
  presetTerms,
  presetTermsLoading = false,
  projectId,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [newWord, setNewWord] = useState('');
  const [importMode, setImportMode] = useState(false);
  const [importSearch, setImportSearch] = useState('');
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());

  // 过滤锁定词
  const filteredTerms = useMemo(() => {
    if (!searchQuery.trim()) return lockedTerms;
    const q = searchQuery.toLowerCase();
    return lockedTerms.filter(
      (t) =>
        t.word.toLowerCase().includes(q) ||
        (t.note && t.note.toLowerCase().includes(q))
    );
  }, [lockedTerms, searchQuery]);

  // 过滤预设术语（排除已锁定词）
  const lockedWordSet = useMemo(
    () => new Set(lockedTerms.map((t) => t.word)),
    [lockedTerms]
  );

  const filteredPresetTerms = useMemo(() => {
    const available = presetTerms.filter((t) => !lockedWordSet.has(t.source_text));
    if (!importSearch.trim()) return available;
    const q = importSearch.toLowerCase();
    return available.filter(
      (t) =>
        t.source_text.toLowerCase().includes(q) ||
        t.target_text.toLowerCase().includes(q) ||
        (t.note && t.note.toLowerCase().includes(q))
    );
  }, [presetTerms, lockedWordSet, importSearch]);

  // 添加锁定词
  const handleAdd = useCallback(() => {
    const trimmed = newWord.trim();
    if (!trimmed) {
      message.warning('请输入锁定词');
      return;
    }
    if (lockedWordSet.has(trimmed)) {
      message.warning('该词已在锁定列表中');
      return;
    }
    onAdd(trimmed);
    setNewWord('');
  }, [newWord, lockedWordSet, onAdd]);

  // 切换预设选择
  const togglePresetSelect = useCallback((termId: string) => {
    setSelectedPresetIds((prev) => {
      const next = new Set(prev);
      if (next.has(termId)) {
        next.delete(termId);
      } else {
        next.add(termId);
      }
      return next;
    });
  }, []);

  // 全选/取消全选
  const toggleSelectAll = useCallback(() => {
    if (selectedPresetIds.size === filteredPresetTerms.length) {
      setSelectedPresetIds(new Set());
    } else {
      setSelectedPresetIds(new Set(filteredPresetTerms.map((t) => t.term_id)));
    }
  }, [selectedPresetIds.size, filteredPresetTerms]);

  // 确认导入选中的预设术语
  const handleConfirmImport = useCallback(() => {
    if (selectedPresetIds.size === 0) {
      message.warning('请选择要导入的术语');
      return;
    }
    const selected = presetTerms
      .filter((t) => selectedPresetIds.has(t.term_id))
      .map((t) => ({
        id: t.term_id,
        word: t.source_text,
        note: t.note,
      }));
    onImportPreset(selected);
    setSelectedPresetIds(new Set());
    setImportMode(false);
    setImportSearch('');
    message.success(`已导入 ${selected.length} 个锁定词`);
  }, [selectedPresetIds, presetTerms, onImportPreset]);

  // 手动词数量统计
  const manualCount = lockedTerms.filter((t) => t.source === 'manual').length;
  const presetCount = lockedTerms.filter((t) => t.source === 'preset').length;

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-amber-500" />
          <span className="text-sm font-medium text-slate-900 dark:text-white">
            锁定术语
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-400">
            {lockedTerms.length} 个锁定词
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X size={12} className="text-slate-400" />
            </button>
          )}
        </div>
      </div>

      {/* 统计摘要 */}
      {lockedTerms.length > 0 && (
        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-amber-50/50 dark:bg-amber-900/10">
          <div className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
            <span>手动: {manualCount}</span>
            <span>预设: {presetCount}</span>
          </div>
        </div>
      )}

      {/* 操作栏 */}
      <div className="p-3 space-y-2 border-b border-slate-100 dark:border-slate-800">
        {/* 搜索 */}
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            size="small"
            placeholder="搜索锁定词..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 text-xs"
            allowClear
          />
        </div>

        {/* 添加锁定词 */}
        <div className="flex gap-1.5">
          <Input
            size="small"
            placeholder="输入要锁定的原词..."
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onPressEnter={handleAdd}
            className="flex-1 text-xs"
            maxLength={200}
          />
          <Button
            size="small"
            type="primary"
            icon={<Plus size={12} />}
            onClick={handleAdd}
            disabled={!newWord.trim()}
            className="text-xs flex-shrink-0"
          >
            添加
          </Button>
        </div>

        {/* 导入预设术语 */}
        <Button
          size="small"
          icon={<Import size={12} />}
          onClick={() => {
            setImportMode(!importMode);
            setImportSearch('');
            setSelectedPresetIds(new Set());
          }}
          block
          className={clsx(
            'text-xs',
            importMode && 'border-amber-400 text-amber-600 dark:text-amber-400'
          )}
        >
          {importMode ? '取消导入' : '从术语库导入'}
        </Button>
      </div>

      {/* 导入模式 */}
      {importMode && (
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-amber-50/30 dark:bg-amber-900/5 space-y-2 max-h-64 flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              选择要导入的术语
            </span>
            <button
              onClick={toggleSelectAll}
              className="text-[10px] text-primary-500 hover:text-primary-600"
            >
              {selectedPresetIds.size === filteredPresetTerms.length && filteredPresetTerms.length > 0
                ? '取消全选'
                : '全选'}
            </button>
          </div>
          <Input
            size="small"
            placeholder="搜索术语..."
            value={importSearch}
            onChange={(e) => setImportSearch(e.target.value)}
            className="text-xs"
            prefix={<Search size={12} className="text-slate-400" />}
            allowClear
          />
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {presetTermsLoading ? (
              <div className="text-center py-4 text-xs text-slate-400">加载中...</div>
            ) : filteredPresetTerms.length === 0 ? (
              <Empty
                description="暂无可用术语"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                className="text-xs"
              />
            ) : (
              filteredPresetTerms.map((term) => {
                const isSelected = selectedPresetIds.has(term.term_id);
                return (
                  <div
                    key={term.term_id}
                    onClick={() => togglePresetSelect(term.term_id)}
                    className={clsx(
                      'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-xs',
                      isSelected
                        ? 'bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700'
                        : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => togglePresetSelect(term.term_id)}
                      className="rounded flex-shrink-0"
                    />
                    <span className="flex-1 truncate text-slate-700 dark:text-slate-300">
                      {term.source_text}
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="text-primary-600 dark:text-primary-400 font-medium truncate max-w-[80px]">
                      {term.target_text}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <Button
            size="small"
            type="primary"
            onClick={handleConfirmImport}
            disabled={selectedPresetIds.size === 0}
            block
            className="text-xs"
          >
            确认导入 ({selectedPresetIds.size} 个)
          </Button>
        </div>
      )}

      {/* 锁定词列表 */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredTerms.length === 0 ? (
          <Empty
            description={
              searchQuery
                ? '未找到匹配的锁定词'
                : '暂无锁定词，添加原词可阻止翻译引擎翻译该词'
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            className="text-xs"
          />
        ) : (
          <div className="space-y-1">
            {filteredTerms.map((term) => (
              <div
                key={term.id}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 group hover:border-amber-200 dark:hover:border-amber-700/50 transition-colors"
              >
                <Shield
                  size={12}
                  className={clsx(
                    'flex-shrink-0',
                    term.source === 'preset'
                      ? 'text-blue-400'
                      : 'text-amber-400'
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                      {term.word}
                    </span>
                    <Tag
                      color={term.source === 'preset' ? 'blue' : 'orange'}
                      className="text-[9px] leading-none px-1 py-0"
                    >
                      {term.source === 'preset' ? '预设' : '手动'}
                    </Tag>
                  </div>
                  {term.note && (
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {term.note}
                    </p>
                  )}
                </div>
                <Popconfirm
                  title="确定移除此锁定词？"
                  description="移除后该词将恢复可翻译状态"
                  onConfirm={() => onDelete(term.id)}
                  okText="确定"
                  cancelText="取消"
                  placement="left"
                >
                  <button className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 size={12} />
                  </button>
                </Popconfirm>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="p-2 border-t border-slate-100 dark:border-slate-800">
        <p className="text-[10px] text-slate-400 text-center">
          锁定词在翻译时将保持原文不翻译
        </p>
      </div>
    </div>
  );
};

export default LockedTermsPanel;
