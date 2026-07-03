'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { App, Spin, Button, Slider, Modal, Dropdown } from 'antd';
import { Popup, TextArea } from 'antd-mobile';
import {
  ArrowLeft,
  Save,
  Wand2,
  ScanText,
  Languages,
  Type,
  Trash2,
  Lock,
  Unlock,
  Plus,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Monitor,
  MoreVertical,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';

import clsx from 'clsx';

import { useProjectData } from '@/hooks/useProjectData';
import { useAIPipeline } from '@/hooks/useAIPipeline';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useEditorStore } from '@/stores/editorStore';
import { MobileCanvas } from '@/components/editor/MobileCanvas';

import { resolvePageImageUrl, resolveProcessedImageUrl } from '@/utils/pageImage';
import type { TextRegion, StyleConfig, RegionType } from '@/types';
import { REGION_TYPE_COLORS, REGION_TYPE_LABELS } from '@/types';

const REGION_TYPES: { key: RegionType; label: string }[] = [
  { key: 'speech', label: '对话' },
  { key: 'thought', label: '内心' },
  { key: 'narration', label: '旁白' },
  { key: 'onomatopoeia', label: '拟声' },
  { key: 'effect', label: '效果' },
];

const DEFAULT_STYLE: StyleConfig = {
  font_family: '内置漫画对话体',
  font_size: 16,
  color: '#000000',
  text_align: 'center',
  vertical: false,
};

export default function MobileEditorPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id!;
  const router = useRouter();
  const { message: antMessage } = App.useApp();

  const {
    project,
    pages,
    currentPage,
    currentPageId,
    isLoading,
    error,
    pageIndex,
    totalPages,
    navigateToPage,
    refetchAll,
  } = useProjectData(projectId);


  // 编辑器状态
  const store = useEditorStore();
  const regions = store.regions;
  const selectedRegionId = store.selectedRegionId;
  const showRegions = store.showRegions;
  const setRegions = store.setRegions;
  const selectRegion = store.selectRegion;
  const updateRegion = store.updateRegion;
  const toggleShowRegions = store.toggleShowRegions;
  const setActiveStep = store.setActiveStep;
  const getPageProcessing = store.getPageProcessing;
  const resetPageProcessing = store.resetPageProcessing;

  const [processedUrl, setProcessedUrl] = useState<string | undefined>(undefined);
  const [showTranslated, setShowTranslated] = useState(true);
  const [failedStep, setFailedStep] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const autoDetectedPagesRef = useRef<Set<string>>(new Set());

  const effectiveTargetLang = useMemo(
    () => (project as any)?.default_target_lang || 'zh-CN',
    [project]
  );

  const { autoTranslate, retryStep, cancelPipeline } = useAIPipeline({
    currentPageId,
    projectSourceLang: (project as any)?.source_lang,
    defaultTargetLang: effectiveTargetLang,
    currentPageData: currentPage,
    setRegions: (r) => setRegions(r as TextRegion[]),
    setProcessedUrl: (url) => setProcessedUrl(url),
  });

  const { debouncedSave, saveNow } = useAutoSave({
    currentPageId,
    getRegions: () => useEditorStore.getState().regions as TextRegion[],
  });

  // 页面切换时同步 regions
  useEffect(() => {
    if (currentPageId && currentPage?.regions) {
      setRegions(currentPage.regions as TextRegion[]);
    }
    if (currentPageId) {
      setProcessedUrl((currentPage as any)?.processed_url);
      setFailedStep(null);
      setStepError(null);
      setActiveStep(null);
      resetPageProcessing(currentPageId);
    }
    return () => {
      if (currentPageId) cancelPipeline();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId]);

  // 新页面无区域时自动检测
  useEffect(() => {
    if (!currentPageId || !currentPage) return;
    if (regions.length > 0) return;
    if (autoDetectedPagesRef.current.has(currentPageId)) return;
    if ((currentPage as any)?.processed_url) return;
    autoDetectedPagesRef.current.add(currentPageId);
    handleRetryStep('detect');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId, currentPage, regions.length]);


  const canvasImageUrl = useMemo(() => {
    if (showTranslated && processedUrl) {
      return resolveProcessedImageUrl(processedUrl) || resolvePageImageUrl(currentPageId, currentPage?.original_url) || '';
    }
    return resolvePageImageUrl(currentPageId, currentPage?.original_url) || '';
  }, [showTranslated, processedUrl, currentPageId, currentPage]);

  const handleSave = useCallback(async () => {
    const ok = await saveNow();
    antMessage[ok ? 'success' : 'warning'](ok ? '已保存' : '保存失败，修改仅本地生效');
  }, [saveNow, antMessage]);

  const handleAutoTranslate = useCallback(async () => {
    setFailedStep(null);
    setStepError(null);
    const result = await autoTranslate();
    if (result?.failedStep) {
      setFailedStep(result.failedStep);
      setStepError(result.errorMessage);
    } else {
      refetchAll();
    }
  }, [autoTranslate, refetchAll]);

  const handleRetryStep = useCallback(
    async (stepKey: string) => {
      setFailedStep(null);
      setStepError(null);
      const result = await retryStep(stepKey);
      if (result?.failedStep) {
        setFailedStep(result.failedStep);
        setStepError(result.errorMessage);
      } else {
        refetchAll();
      }
    },
    [retryStep, refetchAll]
  );

  const handleUpdateRegion = useCallback(
    (rid: string, data: Partial<TextRegion>) => {
      updateRegion(rid, data);
      debouncedSave();
    },
    [updateRegion, debouncedSave]
  );

  const handleDeleteRegion = useCallback(
    (rid: string) => {
      setRegions(regions.filter((r) => r.region_id !== rid));
      if (selectedRegionId === rid) selectRegion(null);
      debouncedSave();
      antMessage.success('已删除选区');
    },
    [regions, selectedRegionId, selectRegion, setRegions, debouncedSave, antMessage]
  );

  const handleCreateRegion = useCallback(() => {
    if (!currentPageId) return;
    const dims = currentPage?.width && currentPage?.height
      ? { width: currentPage.width, height: currentPage.height }
      : { width: 800, height: 1200 };
    const newRegion: TextRegion = {
      region_id: `mobile_${Date.now()}`,
      page_id: currentPageId,
      type: 'speech',
      boundary: { x: dims.width * 0.25, y: dims.height * 0.4, width: dims.width * 0.5, height: dims.height * 0.08 },
      original_text: '',
      translated_text: '',
      confidence: 1,
      is_locked: false,
      style_config: { ...DEFAULT_STYLE },
      sort_order: regions.length + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setRegions([...regions, newRegion]);
    selectRegion(newRegion.region_id);
    debouncedSave();
  }, [currentPageId, currentPage, regions, setRegions, selectRegion, debouncedSave]);

  const selectedRegion = useMemo(
    () => regions.find((r) => r.region_id === selectedRegionId) || null,
    [regions, selectedRegionId]
  );

  const processing = currentPageId ? getPageProcessing(currentPageId).isProcessing : false;
  const activeStep = currentPageId ? getPageProcessing(currentPageId).activeStep : null;

  const STEP_LABELS: Record<string, string> = {
    detect: '文字检测',
    ocr: 'OCR 识别',
    translate: '智能翻译',
    inpaint: '背景修复',
    render: '文字回填',
  };

  if (isLoading && !currentPageId) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950">
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-950 gap-4 px-6">
        <AlertCircle size={48} className="text-red-400" />
        <p className="text-slate-600 dark:text-slate-400 text-center">
          {error instanceof Error ? error.message : String(error ?? '未知错误')}
        </p>
        <button onClick={refetchAll} className="btn-primary">
          <RefreshCw size={16} /> 重试
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* 顶部栏 */}
      <div className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 safe-area-top">
        <div className="flex items-center justify-between px-3 h-12">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => router.back()} className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
              <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-medium text-slate-900 dark:text-white truncate max-w-[140px]">
                {project?.name || '编辑器'}
              </h1>
              <p className="text-[10px] text-slate-400">
                {pageIndex + 1}/{totalPages} 页 · {regions.length} 区域
              </p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={handleSave}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="保存"
            >
              <Save size={18} />
            </button>
            <button
              onClick={() => setShowTranslated((v) => !v)}
              className={clsx(
                'p-2 rounded-lg transition-colors',
                showTranslated
                  ? 'text-primary-600 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-400'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
              title={showTranslated ? '显示原文' : '显示译文'}
            >
              {showTranslated ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
            <button
              onClick={() => toggleShowRegions()}
              className={clsx(
                'p-2 rounded-lg transition-colors',
                showRegions
                  ? 'text-primary-600 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-400'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
              title="显示/隐藏选区"
            >
              <ScanText size={18} />
            </button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'pc',
                    icon: <Monitor size={16} />,
                    label: '在电脑端编辑',
                    onClick: () => router.push(`/pc/projects/${projectId}`),
                  },
                  {
                    key: 'add',
                    icon: <Plus size={16} />,
                    label: '添加区域',
                    onClick: handleCreateRegion,
                  },
                ],
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <button className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                <MoreVertical size={18} />
              </button>
            </Dropdown>
          </div>
        </div>

        {/* 快捷处理栏 */}
        <div className="flex items-center gap-2 px-3 pb-2 overflow-x-auto no-scrollbar">
          <button
            onClick={handleAutoTranslate}
            disabled={processing || !currentPageId}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
              processing
                ? 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                : 'bg-primary-500 text-white hover:bg-primary-600 shadow-sm'
            )}
          >
            <Wand2 size={14} />
            {processing ? '处理中' : '一键翻译'}
          </button>
          {['detect', 'ocr', 'translate', 'render'].map((step) => (
            <button
              key={step}
              onClick={() => handleRetryStep(step)}
              disabled={processing}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors',
                activeStep === step
                  ? 'border-primary-500 text-primary-600 bg-primary-50 dark:bg-primary-900/20 dark:text-primary-400'
                  : failedStep === step
                  ? 'border-red-300 text-red-500 bg-red-50 dark:bg-red-900/20 dark:border-red-800'
                  : 'border-slate-200 text-slate-600 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
              )}
            >
              {failedStep === step && <AlertCircle size={12} />}
              {activeStep === step && <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />}
              {STEP_LABELS[step]}
            </button>
          ))}
        </div>
      </div>

      {/* 页面缩略图 */}
      {totalPages > 1 && (
        <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 py-2 flex gap-2 overflow-x-auto no-scrollbar z-20">
          {pages.map((p, idx) => (
            <button
              key={p.page_id}
              onClick={() => navigateToPage(p.page_id)}
              className={clsx(
                'flex-shrink-0 w-10 h-14 rounded-lg text-xs font-medium flex items-center justify-center transition-colors',
                p.page_id === currentPageId
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              )}
            >
              {idx + 1}
            </button>
          ))}
        </div>
      )}

      {/* 画布 */}
      <div className="flex-1 relative min-h-0">
        {currentPageId ? (
          <MobileCanvas
            imageUrl={canvasImageUrl}
            fallbackUrl={resolvePageImageUrl(currentPageId, currentPage?.original_url)}
            imageWidth={currentPage?.width || 800}
            imageHeight={currentPage?.height || 1200}
            regions={regions}
            selectedRegionId={selectedRegionId}
            showRegions={showRegions}
            isProcessing={processing}
            onSelectRegion={selectRegion}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400">请选择页面</div>
        )}

        {/* 翻页按钮 */}
        {totalPages > 1 && (
          <>
            <button
              disabled={pageIndex <= 0}
              onClick={() => navigateToPage(pages[pageIndex - 1]?.page_id)}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-white/80 dark:bg-slate-900/80 shadow disabled:opacity-30"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              disabled={pageIndex >= totalPages - 1}
              onClick={() => navigateToPage(pages[pageIndex + 1]?.page_id)}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-white/80 dark:bg-slate-900/80 shadow disabled:opacity-30"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-4 py-2 safe-area-bottom z-30">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>
            {processing
              ? `正在${STEP_LABELS[activeStep || 'detect'] || '处理'}...`
              : failedStep
              ? `${STEP_LABELS[failedStep]}失败`
              : `${regions.length} 个区域 · 点击区域编辑`}
          </span>
          <span className="text-primary-500 font-medium">移动端编辑</span>
        </div>
      </div>

      {/* 区域编辑底面板 */}
      <RegionEditorSheet
        region={selectedRegion}
        visible={!!selectedRegion}
        onClose={() => selectRegion(null)}
        onUpdate={handleUpdateRegion}
        onDelete={handleDeleteRegion}
      />

      {/* 失败提示 */}
      <Modal
        title="处理失败"
        open={!!failedStep && !!stepError}
        onCancel={() => setFailedStep(null)}
        footer={null}
        centered
        width={320}
      >
        <div className="py-2 text-center">
          <AlertCircle size={40} className="mx-auto mb-3 text-red-400" />
          <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">{stepError}</p>
          <Button type="primary" block onClick={() => failedStep && handleRetryStep(failedStep)}>
            重试 {failedStep && STEP_LABELS[failedStep]}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

interface RegionEditorSheetProps {
  region: TextRegion | null;
  visible: boolean;
  onClose: () => void;
  onUpdate: (rid: string, data: Partial<TextRegion>) => void;
  onDelete: (rid: string) => void;
}

function RegionEditorSheet({ region, visible, onClose, onUpdate, onDelete }: RegionEditorSheetProps) {
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState(16);
  const [color, setColor] = useState('#000000');
  const [type, setType] = useState<RegionType>('speech');
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (region) {
      setText(region.translated_text || '');
      setFontSize(region.style_config?.font_size || 16);
      setColor(region.style_config?.color || '#000000');
      setType(region.type || 'speech');
      setLocked(region.is_locked || false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region?.region_id]);


  const handleSave = () => {
    if (!region) return;
    onUpdate(region.region_id, {
      translated_text: text,
      type,
      is_locked: locked,
      style_config: {
        ...(region.style_config || DEFAULT_STYLE),
        font_size: fontSize,
        color,
      },
    });
    onClose();
  };

  const handleDelete = () => {
    if (!region) return;
    Modal.confirm({
      title: '删除选区',
      content: '确定要删除这个文字区域吗？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        onDelete(region.region_id);
      },
    });
  };

  return (
    <Popup
      visible={visible}
      onMaskClick={onClose}
      bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '16px 16px 24px', maxHeight: '75vh' }}
    >
      {region && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded text-xs text-white"
                style={{ backgroundColor: REGION_TYPE_COLORS[type] || '#3B82F6' }}
              >
                {REGION_TYPE_LABELS[type]}
              </span>
              {region.confidence != null && (
                <span className="text-xs text-slate-400">置信度 {Math.round(region.confidence * 100)}%</span>
              )}
            </div>
            <button onClick={() => setLocked((v) => !v)} className="p-1.5 text-slate-400">
              {locked ? <Lock size={18} /> : <Unlock size={18} />}
            </button>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">原文</label>
            <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg text-sm text-slate-700 dark:text-slate-300 min-h-[2.5rem]">
              {region.original_text || <span className="text-slate-300">无原文</span>}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 flex items-center gap-1">
              <Languages size={12} /> 译文
            </label>
            <TextArea
              value={text}
              onChange={(val) => setText(val)}
              placeholder="输入译文..."
              rows={3}
              className="text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-2 flex items-center gap-1">
              <Type size={12} /> 字号 {fontSize}px
            </label>
            <Slider min={8} max={72} value={fontSize} onChange={(v) => setFontSize(v as number)} />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-2 block">颜色</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
              />
              <span className="text-sm text-slate-600 dark:text-slate-300 font-mono">{color}</span>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-2 block">区域类型</label>
            <div className="flex flex-wrap gap-2">
              {REGION_TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setType(t.key)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    type === t.key
                      ? 'border-primary-500 text-primary-600 bg-primary-50 dark:bg-primary-900/20 dark:text-primary-400'
                      : 'border-slate-200 text-slate-600 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="primary" block onClick={handleSave} className="flex-[2]">
              <CheckCircle2 size={16} className="inline mr-1" /> 保存
            </Button>
            <Button block danger onClick={handleDelete} className="flex-1">
              <Trash2 size={16} className="inline mr-1" /> 删除
            </Button>
          </div>
        </div>
      )}
    </Popup>
  );
}
