'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button, Dropdown, Segmented, Modal } from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowLeft,
  Wand2,
  Undo2,
  Redo2,
  Download,
  Save,
  Eye,
  HelpCircle,
  Keyboard,
  Layers,
  ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '@/stores/editorStore';
import { StyleToggle } from './StyleToggle';

interface ToolbarProps {
  /** 项目名称 */
  projectName: string;
  /** 当前页码（1-based） */
  currentPageNumber?: number;
  /** 总页数 */
  totalPages?: number;
  /** 显示原文切换回调 */
  onToggleShowOriginal: () => void;
  /** 直接设置显示模式 */
  displayMode?: 'original' | 'translated' | 'bilingual';
  /** 一键翻译回调（仅翻译当前页） */
  onAutoTranslate?: () => void;
  /** 批量翻译全部页回调 */
  onBatchTranslate?: () => void;
  /** 保存回调 */
  onSave?: () => void;
  /** 导出回调 */
  onExport?: (type: 'current' | 'all' | 'bilingual') => void;
}

/** 顶部工具栏 */
export const Toolbar: React.FC<ToolbarProps> = ({
  projectName,
  currentPageNumber,
  totalPages,
  onToggleShowOriginal,
  onAutoTranslate,
  onBatchTranslate,
  onSave,
  onExport,
  displayMode = 'translated',
}) => {
  const {
    mode,
    setMode,
    historyIndex,
    history,
    undo,
    redo,
  } = useEditorStore();

  // 三态模式标签与颜色
  const modeLabels: Record<string, string> = {
    original: '原文',
    translated: '译文',
    bilingual: '双语',
  };
  const modeColors: Record<string, string> = {
    original: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    translated: 'bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400',
    bilingual: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  };
  
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length;

  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const exportMenuItems: MenuProps['items'] = [
    { key: 'current', label: '导出当前页' },
    { key: 'all', label: '批量处理全部' },
    { key: 'bilingual', label: '双语导出' },
  ];

  const SHORTCUTS = [
    { keys: 'Ctrl+S', desc: '保存' },
    { keys: 'Ctrl+Z', desc: '撤销' },
    { keys: 'Ctrl+Y', desc: '重做' },
    { keys: 'Ctrl+B', desc: '切换原文/译文/双语' },
    { keys: 'Delete / Backspace', desc: '删除选中区域' },
    { keys: '↑↓←→', desc: '微调选中区域位置' },
    { keys: 'Ctrl+滚轮', desc: '缩放画布' },
    { keys: 'Space+拖拽', desc: '平移画布' },
    { keys: '双击画布', desc: '重置视图' },
  ];

  // 多页时翻译按钮变为下拉：仅翻译当前页 / 翻译全部页
  const hasMultiplePages = (totalPages ?? 0) > 1;
  const translateMenuItems: MenuProps['items'] = [
    {
      key: 'current',
      label: '仅翻译当前页',
      icon: <Wand2 size={14} />,
    },
    {
      key: 'all',
      label: `翻译全部 ${totalPages ?? 0} 页`,
      icon: <Layers size={14} />,
    },
  ];

  const handleTranslateMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'current') {
      onAutoTranslate?.();
    } else if (key === 'all') {
      onBatchTranslate?.();
    }
  };

  return (
    <>
    <header className="h-12 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-3 flex-shrink-0 z-10">
      {/* 左侧：返回 + 作品信息 */}
      <div className="flex items-center gap-3">
        <Link
          href="/pc"
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
          title="返回作品列表"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
        <span className="text-sm font-medium text-slate-900 dark:text-white truncate max-w-[200px]">
          {projectName}
        </span>
        {currentPageNumber != null && totalPages != null && (
          <span className="text-xs text-slate-400 flex-shrink-0">
            {currentPageNumber} / {totalPages}
          </span>
        )}
      </div>

      {/* 中间：模式切换 + 操作按钮 */}
      <div className="flex items-center gap-2">
        {/* 模式切换 */}
        <Segmented
          size="small"
          value={mode}
          onChange={(val) => setMode(val as 'simple' | 'professional')}
          options={[
            { label: '简易模式', value: 'simple' },
            { label: '专业编辑', value: 'professional' },
          ]}
          className="bg-slate-100 dark:bg-slate-800"
        />

        {/* 简易模式：翻译按钮（多页时下拉选择仅当前/全部） */}
        {mode === 'simple' && (
          hasMultiplePages ? (
            <Dropdown.Button
              type="primary"
              size="small"
              icon={<Wand2 size={14} />}
              menu={{
                items: translateMenuItems,
                onClick: handleTranslateMenuClick,
              }}
              onClick={() => onAutoTranslate?.()}
              className="text-xs"
              trigger={['click']}
            >
              <span className="flex items-center gap-1">
                仅翻译当前页
                <ChevronDown size={10} />
              </span>
            </Dropdown.Button>
          ) : (
            <Button
              type="primary"
              size="small"
              icon={<Wand2 size={14} />}
              onClick={onAutoTranslate}
              className="text-xs"
            >
              一键翻译
            </Button>
          )
        )}

        {/* 专业模式：撤销/重做 */}
        {mode === 'professional' && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={undo}
              disabled={!canUndo}
              className={clsx(
                'p-1.5 rounded-md transition-colors',
                'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
                'disabled:opacity-30 disabled:cursor-not-allowed'
              )}
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className={clsx(
                'p-1.5 rounded-md transition-colors',
                'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
                'disabled:opacity-30 disabled:cursor-not-allowed'
              )}
              title="重做 (Ctrl+Y)"
            >
              <Redo2 size={16} />
            </button>
          </div>
        )}
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-1">
        {/* 简体/繁体风格切换 */}
        <StyleToggle
          currentStyle="simplified"
          onToggle={(style) => {
            console.log('Translation style switched to:', style);
          }}
        />

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* 原文/译文/双语 三态切换 */}
        <button
          onClick={onToggleShowOriginal}
          className={clsx(
            'p-1.5 rounded-lg text-xs transition-colors flex items-center gap-1',
            modeColors[displayMode] || 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
          )}
          title={`当前：${modeLabels[displayMode] || displayMode} · 点击切换`}
        >
          <Eye size={16} />
          <span className="hidden sm:inline">{modeLabels[displayMode]}</span>
        </button>

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* 保存按钮 */}
        <button
          onClick={onSave}
          className="btn-secondary text-xs py-1.5"
          title="保存"
        >
          <Save size={14} />
          保存
        </button>

        {/* 导出下拉菜单 */}
        <Dropdown
          menu={{
            items: exportMenuItems,
            onClick: ({ key }) => onExport?.(key as 'current' | 'all' | 'bilingual'),
          }}
          trigger={['click']}
        >
          <button className="btn-primary text-xs py-1.5">
            <Download size={14} />
            导出
          </button>
        </Dropdown>

        {/* 快捷键帮助 */}
        <button
          onClick={() => setShortcutsOpen(true)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ml-1"
          title="快捷键"
        >
          <Keyboard size={14} />
        </button>
      </div>
    </header>

    {/* 快捷键提示模态框 */}
    <Modal
      title={
        <div className="flex items-center gap-2">
          <Keyboard size={16} className="text-primary-500" />
          <span>键盘快捷键</span>
        </div>
      }
      open={shortcutsOpen}
      onCancel={() => setShortcutsOpen(false)}
      footer={null}
      width={400}
    >
      <div className="space-y-1 py-2">
        {SHORTCUTS.map((item) => (
          <div key={item.keys} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800">
            <span className="text-sm text-slate-600 dark:text-slate-400">{item.desc}</span>
            <kbd className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs font-mono text-slate-500 border border-slate-200 dark:border-slate-700">
              {item.keys}
            </kbd>
          </div>
        ))}
      </div>
    </Modal>
    </>
  );
};
