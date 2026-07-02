'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Spin, Progress, Tooltip, Drawer, Switch, Select } from 'antd';
import {
  ArrowLeft, Maximize2, Minimize2, Sun, Moon, Settings, Download,
  Bookmark, BookmarkCheck, Type, Volume2, Languages, AlertCircle,
  RefreshCw, Save, MessageCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { ReaderControls, PageRenderer, ReaderNavigation, WordLookupPopup } from '@/components/reader';
import { useReadingState } from '@/hooks/useReadingState';
import { useKeyboardShortcuts, type ShortcutBinding } from '@/hooks/useKeyboardShortcuts';
import { useMemo, useState } from 'react';

const pageColors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444'];

/** 源语言名 → 语言代码（查词用） */
function langCode(sourceLang?: string): string {
  const s = (sourceLang || '').toLowerCase();
  if (s.includes('ja') || s.includes('日')) return 'ja';
  if (s.includes('ko') || s.includes('韩') || s.includes('韓')) return 'ko';
  if (s.includes('en') || s.includes('英')) return 'en';
  return 'ja';
}

export default function ReaderPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const reader = useReadingState({ projectId: projectId! });

  // §2.7.4 单词查词弹窗状态
  const [lookup, setLookup] = useState<{ word: string; anchor: { x: number; y: number } } | null>(null);
  const handleWordLookup = (word: string, anchor: { x: number; y: number }) => setLookup({ word, anchor });

  // 键盘快捷键
  const shortcuts = useMemo<ShortcutBinding[]>(() => [
    { key: 'ArrowLeft', handler: () => reader.readingDirection === 'rtl'
      ? reader.setCurrentPage(p => Math.min(reader.totalPages - 1, p + 1))
      : reader.setCurrentPage(p => Math.max(0, p - 1)), description: '上一页' },
    { key: 'ArrowRight', handler: () => reader.readingDirection === 'rtl'
      ? reader.setCurrentPage(p => Math.max(0, p - 1))
      : reader.setCurrentPage(p => Math.min(reader.totalPages - 1, p + 1)), description: '下一页' },
  ], [reader.totalPages, reader.readingDirection]);

  useKeyboardShortcuts({ shortcuts });

  if (reader.loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <Spin size="large" />
      </div>
    );
  }

  if (reader.error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-900 gap-4">
        <AlertCircle size={48} className="text-red-400" />
        <p className="text-white/60">{reader.error}</p>
        <button onClick={reader.loadData} className="btn-primary">
          <RefreshCw size={16} /> 重试
        </button>
      </div>
    );
  }

  const cd = reader.currentPageData;
  const cp = reader.currentPage;

  return (
    <div className={clsx('h-screen flex flex-col transition-colors duration-300',
      reader.isDarkMode ? 'bg-slate-950' : 'bg-slate-900')}>
      
      {/* 顶部控制栏 */}
      <div className={clsx('absolute top-0 left-0 right-0 z-20 transition-all duration-300',
        reader.showControls ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0')}
        onMouseEnter={() => reader.setShowControls(true)}>
        <div className="bg-gradient-to-b from-black/80 to-transparent px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/pc" className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 transition-colors">
                <ArrowLeft size={20} />
              </Link>
              <div className="h-5 w-px bg-white/20" />
              <div>
                <h1 className="text-sm font-medium text-white">{reader.project?.name || '漫画阅读'}</h1>
                <p className="text-xs text-white/50">{cp + 1} / {reader.totalPages} 页</p>
              </div>
            </div>
            <ReaderControls layoutMode={reader.layoutMode} onLayoutModeChange={reader.setLayoutMode}
              displayMode={reader.displayMode} onDisplayModeChange={reader.setDisplayMode} variant="dark"
              showAudioButton={true} onAudioToggle={reader.handleTTS} isAudioPlaying={reader.isTTSPlaying} />
            <div className="flex items-center gap-1">
              <button onClick={() => reader.setIsDarkMode(!reader.isDarkMode)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 transition-colors">
                {reader.isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button onClick={reader.toggleFullscreen} className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 transition-colors">
                {reader.isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
              <button onClick={() => reader.setSettingsOpen(true)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 transition-colors">
                <Settings size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 阅读区域 */}
      <div className="flex-1 flex items-center justify-center"
        onMouseMove={() => reader.setShowControls(true)}
        onMouseLeave={() => setTimeout(() => reader.setShowControls(false), 3000)}
        onClick={() => reader.setShowControls(!reader.showControls)}>
        {reader.layoutMode === 'bilingual' ? (
          <div className="flex items-center justify-center gap-4 px-8 w-full max-w-6xl">
            <div className="flex-1 flex flex-col items-center">
              <span className="text-xs text-white/40 mb-2">原文 ({reader.project?.source_lang || '日文'})</span>
              <PageRenderer pageUrl={cd?.original_url || `https://picsum.photos/seed/reader${cp + 1}/800/1100`}
                alt={`原文 第${cp + 1}页`} displayMode="original" pageNumber={cp + 1}
                placeholderColor={pageColors[cp % 6]} overlayLabel={`第${cp + 1}页`}
                regions={(cd as any)?.regions} regionModeOverrides={reader.regionModeOverrides}
                onBubbleClick={reader.handleBubbleClick} onWordLookup={handleWordLookup} />
            </div>
            <div className="w-px h-96 bg-white/10" />
            <div className="flex-1 flex flex-col items-center">
              <span className="text-xs text-white/40 mb-2">译文 (简体中文)</span>
              <PageRenderer pageUrl={cd?.processed_url || cd?.original_url || `https://picsum.photos/seed/reader${cp + 1}/800/1100`}
                alt={`译文 第${cp + 1}页`} displayMode="translated" pageNumber={cp + 1}
                placeholderColor={pageColors[(cp + 1) % 6]} overlayLabel={`第${cp + 1}页`}
                regions={(cd as any)?.regions} regionModeOverrides={reader.regionModeOverrides}
                onBubbleClick={reader.handleBubbleClick} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 px-8">
            {reader.layoutMode === 'double' && (
              <PageRenderer
                pageUrl={reader.pages[cp - 1]?.original_url || `https://picsum.photos/seed/reader${cp}/800/1100`}
                alt={`第${cp}页`} displayMode="original" pageNumber={cp}
                placeholderColor={pageColors[cp % 6]} className="w-[300px]" />
            )}
            <PageRenderer
              pageUrl={reader.displayMode === 'translated'
                ? cd?.processed_url || cd?.original_url || `https://picsum.photos/seed/reader${cp + 1}/800/1100`
                : cd?.original_url || `https://picsum.photos/seed/reader${cp + 1}/800/1100`}
              alt={`第${cp + 1}页`} displayMode={reader.displayMode}
              pageNumber={cp + 1} placeholderColor={pageColors[(cp + (reader.layoutMode === 'double' ? 1 : 0)) % 6]}
              className={reader.layoutMode === 'double' ? 'w-[300px]' : 'w-[400px]'}
              regions={(cd as any)?.regions}
              regionModeOverrides={reader.regionModeOverrides}
              onBubbleClick={reader.handleBubbleClick} onWordLookup={handleWordLookup} />
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      <div className={clsx('absolute bottom-0 left-0 right-0 z-20 transition-all duration-300',
        reader.showControls ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0')}>
        <div className="bg-gradient-to-t from-black/80 to-transparent px-4 py-3">
          {reader.isExporting && reader.exportProgress !== null && (
            <div className="max-w-md mx-auto mb-2">
              <Progress percent={reader.exportProgress} size="small" strokeColor="#6366F1"
                trailColor="rgba(255,255,255,0.1)" format={(p) => `导出 ${p}%`}
                className="[&_.ant-progress-text]:!text-white/60 [&_.ant-progress-text]:!text-xs" />
            </div>
          )}
          <ReaderNavigation currentPage={cp} totalPages={reader.totalPages}
            onPrev={() => reader.setCurrentPage((p) => Math.max(0, p - 1))}
            onNext={() => reader.setCurrentPage((p) => Math.min(reader.totalPages - 1, p + 1))}
            onGoTo={(page) => reader.setCurrentPage(page)} variant="dark" />
          <div className="flex items-center justify-center gap-3 mt-3">
            <Tooltip title={reader.isBookmarked ? '取消书签' : '添加书签'}>
              <button onClick={reader.handleBookmark}
                className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs',
                  reader.isBookmarked ? 'text-yellow-400 bg-white/10' : 'text-white/60 hover:bg-white/10')}>
                {reader.isBookmarked ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                {reader.isBookmarked ? '已收藏' : '添加书签'}
              </button>
            </Tooltip>
            <Tooltip title={`字号: ${reader.FONT_SIZES[reader.fontSize]}px`}>
              <button onClick={reader.cycleFontSize}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/10 text-white/60 text-xs transition-colors">
                <Type size={14} /> 字号
                <span className="opacity-40">({reader.FONT_SIZES[reader.fontSize]})</span>
              </button>
            </Tooltip>
            <Tooltip title={reader.isTTSPlaying ? '停止朗读' : '朗读当前页'}>
              <button onClick={reader.handleTTS}
                className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs',
                  reader.isTTSPlaying ? 'text-primary-400 bg-white/10' : 'text-white/60 hover:bg-white/10')}>
                <Volume2 size={14} className={reader.isTTSPlaying ? 'animate-pulse' : ''} />
                {reader.isTTSPlaying ? '停止' : '朗读'}
              </button>
            </Tooltip>
            <Tooltip title="切换显示语言">
              <button onClick={reader.handleToggleLang}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/10 text-white/60 text-xs transition-colors">
                <Languages size={14} /> 切换语言
                <span className="opacity-40">({reader.displayMode === 'translated' ? '译文' : reader.displayMode === 'original' ? '原文' : '双语'})</span>
              </button>
            </Tooltip>
            <div className="w-px h-4 bg-white/20" />
            <Tooltip title="导出当前页/章节/全部">
              <button onClick={reader.handleExport} disabled={reader.isExporting}
                className={clsx('flex items-center gap-1.5 px-4 py-1.5 rounded-lg transition-colors text-xs',
                  reader.isExporting ? 'text-white/30 cursor-wait' : 'text-white hover:bg-primary-500/80 bg-primary-500/40')}>
                {reader.isExporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                {reader.isExporting ? '导出中...' : '导出'}
              </button>
            </Tooltip>
            {Object.keys(reader.regionModeOverrides).length > 0 && (
              <Tooltip title="重置所有气泡显示">
                <button onClick={() => reader.setRegionModeOverrides({})}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/10 text-amber-400/80 text-xs transition-colors">
                  <MessageCircle size={14} /> 重置({Object.keys(reader.regionModeOverrides).length})
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {/* 提示 + 保存指示 */}
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-white/30 text-xs pointer-events-none flex items-center gap-3">
        <span>使用 ← → 方向键翻页 · 点击页面切换显示/隐藏控制栏</span>
        {reader.savingProgress && (
          <span className="flex items-center gap-1 text-white/40">
            <Save size={10} className="animate-pulse" /> 保存中...
          </span>
        )}
      </div>

      {/* 进度条 */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/5">
        <div className="h-full bg-primary-500/60 transition-all duration-500"
          style={{ width: `${reader.totalPages > 0 ? ((cp + 1) / reader.totalPages) * 100 : 0}%` }} />
      </div>

      {/* 设置抽屉 */}
      <Drawer title="阅读设置" placement="right" open={reader.settingsOpen}
        onClose={() => reader.setSettingsOpen(false)} width={320}
        styles={{
          header: { background: '#1e293b', borderBottom: '1px solid #334155', color: '#f1f5f9' },
          body: { background: '#1e293b', padding: '16px 24px' },
        }}
        closeIcon={<span className="text-slate-300 hover:text-white transition-colors">✕</span>}>
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium text-slate-200">暗色模式</p><p className="text-xs text-slate-400 mt-0.5">切换阅读背景亮度</p></div>
            <Switch checked={reader.isDarkMode} onChange={reader.setIsDarkMode} checkedChildren={<Moon size={12} />} unCheckedChildren={<Sun size={12} />} />
          </div>
          <div className="h-px bg-slate-700" />
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium text-slate-200">阅读方向</p><p className="text-xs text-slate-400 mt-0.5">控制翻页键的方向逻辑</p></div>
            <Select value={reader.readingDirection} onChange={reader.setReadingDirection} size="small" style={{ width: 100 }}
              popupClassName="reader-select-popup"
              options={[{ value: 'ltr', label: '左翻 (→)' }, { value: 'rtl', label: '右翻 (←)' }]} />
          </div>
          <div className="h-px bg-slate-700" />
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium text-slate-200">自动翻页</p><p className="text-xs text-slate-400 mt-0.5">{reader.autoFlipInterval > 0 ? `每 ${reader.autoFlipInterval} 秒自动翻页` : '关闭自动翻页'}</p></div>
            <Select value={reader.autoFlipInterval} onChange={reader.setAutoFlipInterval} size="small" style={{ width: 100 }}
              popupClassName="reader-select-popup"
              options={[{ value: 0, label: '关闭' }, { value: 3, label: '3 秒' }, { value: 5, label: '5 秒' }, { value: 10, label: '10 秒' }, { value: 30, label: '30 秒' }]} />
          </div>
          <div className="h-px bg-slate-700" />
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium text-slate-200">气泡点击切换</p><p className="text-xs text-slate-400 mt-0.5">点击文字气泡切换原文/译文/双语</p></div>
            <Switch checked={reader.bubbleEnabled} onChange={reader.setBubbleEnabled} />
          </div>
          <div className="h-px bg-slate-700" />
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium text-slate-200">当前字号</p><p className="text-xs text-slate-400 mt-0.5">点击底部「字号」按钮切换</p></div>
            <span className="text-sm text-slate-300">{reader.FONT_SIZES[reader.fontSize]}px</span>
          </div>
        </div>
      </Drawer>

      {/* §2.7.4 单词即点即译弹窗 */}
      {lookup && (
        <WordLookupPopup
          word={lookup.word}
          lang={langCode(reader.project?.source_lang)}
          sourceProjectId={projectId}
          anchor={lookup.anchor}
          onClose={() => setLookup(null)}
        />
      )}
    </div>
  );
}
