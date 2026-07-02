'use client';

import React, { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { message, Slider, Button, Modal } from 'antd';
import { Popup } from 'antd-mobile';
import { ArrowLeft, Trash2, Plus, Monitor, Type, AlignLeft, Lock, Unlock } from 'lucide-react';
import { pageApi } from '@/services/page';
import { useProjectDetail, useChapters, usePages } from '@/hooks/useApiQueries';
import type { TextRegion, PageData } from '@/types';
import { REGION_TYPE_COLORS, REGION_TYPE_LABELS, type RegionType } from '@/types';

export default function MobileEditPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();

  // React Query 数据
  const { data: project, isLoading: projLoading } = useProjectDetail(projectId!);
  const { data: chapters, isLoading: chLoading } = useChapters(projectId!);

  // 加载所有页面
  const { data: allPages = [], isLoading: pagesLoading } = usePages(chapters?.[0]?.chapter_id || '');
  const [pages, setPages] = useState<PageData[]>([]);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [currentPageData, setCurrentPageData] = useState<PageData | null>(null);
  const [regions, setRegions] = useState<TextRegion[]>([]);
  const [pageDataLoading, setPageDataLoading] = useState(false);

  // 编辑状态
  const [selectedRegion, setSelectedRegion] = useState<TextRegion | null>(null);
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [editText, setEditText] = useState('');
  const [editFontSize, setEditFontSize] = useState(16);
  const [showPCGuide, setShowPCGuide] = useState(false);

  const loading = projLoading || chLoading || pageDataLoading;

  // 加载页面数据（手动的每页详情加载）
  const loadPageData = useCallback(async (pageId: string) => {
    setPageDataLoading(true);
    try {
      const res = await pageApi.getDetail(pageId);
      const data = (res.data as any)?.data || res.data;
      setCurrentPageData(data);
      setRegions(data.regions || []);
      setSelectedRegion(null);
      setEditSheetVisible(false);
    } catch {
      message.warning('页面数据加载失败');
    } finally {
      setPageDataLoading(false);
    }
  }, []);

  // 初始化：加载所有章节页面 + 选中第一页
  React.useEffect(() => {
    if (!chapters || chapters.length === 0) return;
    const loadAllPages = async () => {
      const all: PageData[] = [];
      for (const ch of chapters) {
        try {
          const res = await pageApi.getList(ch.chapter_id);
          const data = (res.data as any)?.data;
          const items = Array.isArray(data) ? data : data?.items || [];
          all.push(...items.map((p: any) => ({ ...p, chapter_id: ch.chapter_id })));
        } catch { /* skip */ }
      }
      setPages(all);
      if (all.length > 0 && !currentPageId) {
        setCurrentPageId(all[0].page_id);
        await loadPageData(all[0].page_id);
      }
    };
    loadAllPages();
  }, [chapters]);

  const handleSelectPage = (pageId: string) => {
    setCurrentPageId(pageId);
    loadPageData(pageId);
  };

  const handleRegionTap = (region: TextRegion) => {
    setSelectedRegion(region);
    setEditText(region.translated_text || '');
    setEditFontSize(region.style_config?.font_size || 16);
    setEditSheetVisible(true);
  };

  const handleSaveEdit = useCallback(async () => {
    if (!selectedRegion || !currentPageId) return;
    const updated = regions.map((r) =>
      r.region_id === selectedRegion.region_id
        ? { ...r, translated_text: editText, style_config: { ...r.style_config, font_family: r.style_config?.font_family || '内置漫画对话体', font_size: editFontSize, color: r.style_config?.color || '#000000' } }
        : r
    );
    setRegions(updated as TextRegion[]);
    setEditSheetVisible(false);
    try { await pageApi.updateRegions(currentPageId, updated as TextRegion[]); message.success('已保存'); }
    catch { message.info('修改已本地保存'); }
  }, [selectedRegion, currentPageId, regions, editText, editFontSize]);

  const handleDeleteRegion = useCallback(async () => {
    if (!selectedRegion || !currentPageId) return;
    const updated = regions.filter((r) => r.region_id !== selectedRegion.region_id);
    setRegions(updated); setEditSheetVisible(false); setSelectedRegion(null);
    try { await pageApi.updateRegions(currentPageId, updated as TextRegion[]); message.success('已删除区域'); }
    catch { message.info('已本地删除'); }
  }, [selectedRegion, currentPageId, regions]);

  const handleAddRegion = useCallback(() => {
    if (!currentPageId) return;
    const newRegion: TextRegion = {
      region_id: `mobile_${Date.now()}`, page_id: currentPageId, type: 'speech' as RegionType,
      boundary: { x: 100, y: 200, width: 200, height: 80 }, original_text: '', translated_text: '',
      confidence: 1, is_locked: false,
      style_config: { font_family: '内置漫画对话体', font_size: 16, color: '#000000', text_align: 'center', vertical: false },
      sort_order: regions.length + 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const updated = [...regions, newRegion];
    setRegions(updated); handleRegionTap(newRegion);
    try { pageApi.updateRegions(currentPageId, updated as TextRegion[]); } catch { /* ignore */ }
  }, [currentPageId, regions]);

  const handleToggleLock = useCallback(() => {
    if (!selectedRegion || !currentPageId) return;
    const updated = regions.map((r) =>
      r.region_id === selectedRegion.region_id ? { ...r, is_locked: !r.is_locked } : r
    );
    setRegions(updated); setSelectedRegion({ ...selectedRegion, is_locked: !selectedRegion.is_locked });
    try { pageApi.updateRegions(currentPageId, updated as TextRegion[]); } catch { /* ignore */ }
  }, [selectedRegion, currentPageId, regions]);

  if (loading && pages.length === 0) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const projectName = project?.name || '';
  const currentPageNumber = pages.findIndex((p) => p.page_id === currentPageId) + 1;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col">
      <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 safe-area-top">
        <div className="flex items-center justify-between px-4 h-12">
          <div className="flex items-center gap-2">
            <button onClick={() => router.back()} className="p-1.5 -ml-1.5">
              <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
            </button>
            <div>
              <h1 className="text-sm font-medium text-slate-900 dark:text-white truncate max-w-[160px]">{projectName || '轻量编辑'}</h1>
              <p className="text-[10px] text-slate-400">{currentPageNumber}/{pages.length} 页</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleAddRegion} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-primary-500" title="添加区域"><Plus size={18} /></button>
            <button onClick={() => setShowPCGuide(true)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400" title="在电脑上编辑"><Monitor size={18} /></button>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-2 flex gap-2 overflow-x-auto no-scrollbar">
        {pages.map((page, idx) => (
          <button key={page.page_id} onClick={() => handleSelectPage(page.page_id)}
            className={`flex-shrink-0 w-12 h-16 rounded-lg text-xs font-medium flex items-center justify-center transition-colors ${
              page.page_id === currentPageId ? 'bg-primary-500 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
            }`}>{idx + 1}</button>
        ))}
      </div>

      <div className="flex-1 relative overflow-auto bg-slate-200 dark:bg-slate-950">
        <div className="relative mx-auto" style={{ maxWidth: '100vw' }}>
          {currentPageData?.original_url ? (
            <div className="relative">
              <img src={currentPageData.processed_url || currentPageData.original_url} alt="漫画页面" className="w-full h-auto block" draggable={false} />
              {regions.map((region) => {
                const bw = currentPageData.width || 800; const bh = currentPageData.height || 1200;
                const typeColor = REGION_TYPE_COLORS[region.type] || '#3B82F6';
                return (
                  <button key={region.region_id} onClick={() => handleRegionTap(region)}
                    className={`absolute border-2 rounded transition-colors ${region.is_locked ? 'border-dashed opacity-60' : 'border-solid'} ${selectedRegion?.region_id === region.region_id ? 'ring-2 ring-primary-400 border-primary-500' : ''}`}
                    style={{ left: `${(region.boundary.x / bw) * 100}%`, top: `${(region.boundary.y / bh) * 100}%`, width: `${(region.boundary.width / bw) * 100}%`, height: `${(region.boundary.height / bh) * 100}%`, borderColor: typeColor, backgroundColor: `${typeColor}15` }}>
                    <span className="absolute top-0 left-0 px-1 py-0.5 text-[8px] text-white rounded-br" style={{ backgroundColor: typeColor }}>{REGION_TYPE_LABELS[region.type]}</span>
                    {region.is_locked && <Lock size={10} className="absolute bottom-0.5 right-0.5 text-slate-400" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="aspect-[800/1100] bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 text-sm">暂无页面</div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-4 py-2 safe-area-bottom">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{regions.length} 个区域 ·{selectedRegion ? ' 已选中' : ' 点击区域编辑'}</span>
          <span className="text-primary-500 font-medium">轻量编辑模式</span>
        </div>
      </div>

      <Popup visible={editSheetVisible} onMaskClick={() => { setEditSheetVisible(false); setSelectedRegion(null); }}
        bodyStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '20px 16px 24px', maxHeight: '60vh' }}>
        {selectedRegion && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs text-white" style={{ backgroundColor: REGION_TYPE_COLORS[selectedRegion.type] || '#3B82F6' }}>{REGION_TYPE_LABELS[selectedRegion.type]}</span>
              {selectedRegion.confidence != null && <span className="text-xs text-slate-400">置信度: {Math.round(selectedRegion.confidence * 100)}%</span>}
              <button onClick={handleToggleLock} className="ml-auto p-1 text-slate-400">{selectedRegion.is_locked ? <Lock size={16} /> : <Unlock size={16} />}</button>
            </div>
            {selectedRegion.original_text && (
              <div><label className="text-xs text-slate-400 mb-1 block">原文</label><div className="p-2 bg-slate-50 dark:bg-slate-800 rounded text-sm text-slate-700 dark:text-slate-300">{selectedRegion.original_text}</div></div>
            )}
            <div><label className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Type size={12} /> 译文</label>
              <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                className="w-full h-20 text-sm p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 resize-none focus:outline-none focus:border-primary-400" placeholder="输入译文..." />
            </div>
            <div><label className="text-xs text-slate-400 mb-2 flex items-center gap-1"><AlignLeft size={12} /> 字号: {editFontSize}px</label>
              <Slider min={8} max={72} value={editFontSize} onChange={(val) => setEditFontSize(val as number)} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button block type="primary" onClick={handleSaveEdit} className="flex-1">保存修改</Button>
              <Button block danger onClick={handleDeleteRegion} icon={<Trash2 size={16} />} className="flex-1">删除区域</Button>
            </div>
          </div>
        )}
      </Popup>

      <Modal title="在电脑上编辑" open={showPCGuide} onCancel={() => setShowPCGuide(false)} footer={null} centered width={300}>
        <div className="py-4 text-center">
          <Monitor size={48} className="mx-auto mb-3 text-primary-500" />
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">精细编辑功能（样式调整、笔刷修补、批量处理）请在电脑端打开编辑器获得完整体验。</p>
          <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3 mb-3"><p className="text-xs text-slate-500 dark:text-slate-400">在电脑浏览器中访问同一账号即可同步所有数据</p></div>
          <button onClick={() => setShowPCGuide(false)} className="btn-primary text-sm w-full">知道了</button>
        </div>
      </Modal>
    </div>
  );
}
