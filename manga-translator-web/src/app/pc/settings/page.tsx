'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Form, Select, Slider, Switch, Button, Spin, Divider, App } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  Settings,
  Globe,
  Download,
  Type,
  RotateCcw,
  Save,
  Palette,
  Monitor,
  BookOpen,
  ArrowUp,
} from 'lucide-react';

import { settingsApi } from '@/services/settings';
import type { UserSettingsFull } from '@/services/settings';
import { useHasAuth, useAuthHydrated } from '@/hooks/useAuthHydrated';

// P0 性能优化: 术语库面板使用 next/dynamic 懒加载
// Table/Modal/Tag/Popconfirm 等重型 antd 组件仅在使用者点击"术语库"标签时才加载
const TermsPanel = dynamic(
  () => import('@/components/settings/TermsPanel').then((m) => ({ default: m.TermsPanel })),
  {
    loading: () => (
      <div className="flex items-center justify-center py-20">
        <Spin size="large">
          <div className="p-8" />
        </Spin>
      </div>
    ),
    ssr: false,
  }
);

const ENGINE_OPTIONS = [
  { value: 'basic', label: '基础引擎' },
  { value: 'multimodal', label: '多模态引擎（推荐）' },
];

const LANG_OPTIONS = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en', label: '英文' },
  { value: 'ko', label: '韩文' },
  { value: 'ja', label: '日文' },
  { value: 'vi', label: '越南文' },
  { value: 'th', label: '泰文' },
];

const FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG（无损）' },
  { value: 'jpg', label: 'JPG（有损）' },
  { value: 'webp', label: 'WebP（推荐）' },
  { value: 'cbz', label: 'CBZ（漫画包）' },
  { value: 'pdf', label: 'PDF（文档）' },
];

const STYLE_OPTIONS = [
  { value: 'simplified', label: '简体中文' },
  { value: 'traditional', label: '繁体中文' },
];

const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const FONT_FAMILY_OPTIONS = [
  { value: 'source-han-sans', label: '思源黑体' },
  { value: 'source-han-serif', label: '思源宋体' },
  { value: 'noto-sans', label: 'Noto Sans' },
  { value: 'noto-serif', label: 'Noto Serif' },
  { value: 'default', label: '系统默认' },
];

const FONT_COLOR_PRESETS = [
  '#1e293b', '#000000', '#ffffff', '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
];

const DEFAULT_SETTINGS: UserSettingsFull = {
  default_engine: 'multimodal',
  default_target_lang: 'zh-CN',
  default_export_format: 'png',
  default_export_quality: 90,
  default_font_family: 'source-han-sans',
  default_font_size: 16,
  default_font_color: '#1e293b',
  default_font_style: 'regular',
  translation_style: 'simplified',
  auto_preprocess: true,
  notifications_enabled: true,
  auto_save_progress: true,
  theme: 'system',
  language: 'zh-CN',
};

type SettingsTab = 'preferences' | 'terms';

export default function SettingsPage() {
  const { message } = App.useApp();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tabParam = searchParams.get('tab') as SettingsTab | null;
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabParam === 'terms' ? 'terms' : 'preferences'
  );

  useEffect(() => {
    if (tabParam === 'terms') setActiveTab('terms');
    else if (!tabParam) setActiveTab('preferences');
  }, [tabParam]);

  const hasAuth = useHasAuth();
  const authReady = useAuthHydrated();
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  const {
    data: remoteSettings,
    isLoading: settingsLoading,
    isError: settingsIsError,
    error: settingsError,
    refetch: refetchSettings,
  } = useQuery({
    queryKey: ['settings', 'user'],
    queryFn: async () => {
      const res = await settingsApi.get({ timeout: 8000 });
      return res.data?.data as UserSettingsFull | null;
    },
    enabled: authReady && hasAuth,
    staleTime: 60 * 1000,
    retry: 1,
    retryDelay: 1000,
  });

  useEffect(() => {
    if (!settingsLoading) {
      setLoadTimedOut(false);
      return;
    }
    const t = setTimeout(() => setLoadTimedOut(true), 10000);
    return () => clearTimeout(t);
  }, [settingsLoading]);

  const [settings, setSettings] = useState<UserSettingsFull>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (remoteSettings) {
      setSettings({ ...DEFAULT_SETTINGS, ...remoteSettings });
    }
  }, [remoteSettings]);

  const updateField = useCallback(
    <K extends keyof UserSettingsFull>(key: K, value: UserSettingsFull[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setChanged(true);
    },
    []
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await settingsApi.update(settings);
      message.success('设置已保存');
      setChanged(false);
      queryClient.invalidateQueries({ queryKey: ['settings', 'user'] });
    } catch (err: any) {
      const code = err?.response?.status || 0;
      if (code === 404) {
        message.info('设置已保存到本地');
        setChanged(false);
      } else {
        message.error(err?.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }, [settings, queryClient]);

  const handleReset = useCallback(async () => {
    setSaving(true);
    try {
      await settingsApi.reset();
      setSettings(DEFAULT_SETTINGS);
      message.success('已恢复默认设置');
      setChanged(false);
    } catch {
      setSettings(DEFAULT_SETTINGS);
      message.success('已恢复默认设置');
      setChanged(false);
    } finally {
      setSaving(false);
    }
  }, []);

  // 设置加载中（带 10s 超时兜底，超时后使用本地默认值）
  const showLoadingGate =
    authReady &&
    hasAuth &&
    settingsLoading &&
    !loadTimedOut &&
    !settingsIsError &&
    activeTab === 'preferences';

  if (showLoadingGate) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
              <Settings size={22} className="text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">个人设置</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">加载中...</p>
            </div>
          </div>
        </div>
        <div className="h-full flex items-center justify-center">
          <Spin size="large">
            <div className="p-12">
              <div className="text-slate-400 text-sm mt-2">加载设置中...</div>
            </div>
          </Spin>
        </div>
      </div>
    );
  }

  const SectionTitle = ({ icon: Icon, title }: { icon: React.ElementType; title: string }) => (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={18} className="text-primary-500" />
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
    </div>
  );

  const SettingRow = ({
    label,
    desc,
    children,
  }: {
    label: string;
    desc?: string;
    children: React.ReactNode;
  }) => (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800">
      <div className="flex-1 mr-4">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
        {desc && <p className="text-xs text-slate-400 mt-0.5">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      {/* 头部 */}
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
              {activeTab === 'terms' ? (
                <BookOpen size={22} className="text-primary-600 dark:text-primary-400" />
              ) : (
                <Settings size={22} className="text-primary-600 dark:text-primary-400" />
              )}
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                {activeTab === 'terms' ? '术语库管理' : '个人设置'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {activeTab === 'terms'
                  ? '管理翻译术语和锁定词'
                  : '自定义你的翻译体验'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'preferences' && (
              <>
                <Button
                  icon={<RotateCcw size={14} />}
                  onClick={handleReset}
                  disabled={saving}
                  danger
                  ghost
                >
                  恢复默认
                </Button>
                <Button
                  type="primary"
                  icon={<Save size={14} />}
                  onClick={handleSave}
                  loading={saving}
                  disabled={!changed}
                >
                  保存设置
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="max-w-3xl mx-auto flex gap-6 mt-3">
          {([
            { key: 'preferences' as const, label: '翻译设置' },
            { key: 'terms' as const, label: '术语库' },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                router.push(`/pc/settings${tab.key === 'terms' ? '?tab=terms' : ''}`);
              }}
              className={clsx(
                'pb-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 翻译设置内容 */}
      {activeTab === 'preferences' && (
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-8">
          {(settingsIsError || loadTimedOut) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {loadTimedOut
                  ? '加载超时，已使用本地默认设置。请检查网络后重试。'
                  : settingsError instanceof Error
                    ? settingsError.message
                    : '无法加载远程设置，已使用本地默认值'}
              </p>
              <Button size="small" onClick={() => refetchSettings()}>
                重试
              </Button>
            </div>
          )}
          <div className="glass-card p-5">
            <SectionTitle icon={Globe} title="翻译偏好" />
            <SettingRow label="默认翻译引擎" desc="多模态引擎质量更高但速度较慢">
              <Select
                value={settings.default_engine}
                onChange={(v) => updateField('default_engine', v)}
                size="small"
                style={{ width: 180 }}
                options={ENGINE_OPTIONS}
              />
            </SettingRow>
            <SettingRow label="默认目标语言" desc="新作品将默认翻译为该语言">
              <Select
                value={settings.default_target_lang}
                onChange={(v) => updateField('default_target_lang', v)}
                size="small"
                style={{ width: 140 }}
                options={LANG_OPTIONS}
              />
            </SettingRow>
            <SettingRow label="翻译风格" desc="选择简体或繁体中文输出">
              <Select
                value={settings.translation_style}
                onChange={(v) => updateField('translation_style', v)}
                size="small"
                style={{ width: 140 }}
                options={STYLE_OPTIONS}
              />
            </SettingRow>
            <SettingRow label="上传后自动预处理" desc="上传图片后自动进行倾斜校正和裁剪">
              <Switch
                checked={settings.auto_preprocess}
                onChange={(v) => updateField('auto_preprocess', v)}
              />
            </SettingRow>
          </div>

          <div className="glass-card p-5">
            <SectionTitle icon={Download} title="导出默认值" />
            <SettingRow label="默认导出格式" desc="导出时将默认选择该格式">
              <Select
                value={settings.default_export_format}
                onChange={(v) => updateField('default_export_format', v)}
                size="small"
                style={{ width: 160 }}
                options={FORMAT_OPTIONS}
              />
            </SettingRow>
            <SettingRow
              label="默认导出质量"
              desc={
                ['cbz', 'pdf'].includes(settings.default_export_format)
                  ? '仅图片格式可调节质量'
                  : `当前：${settings.default_export_quality}%`
              }
            >
              <Slider
                min={10}
                max={100}
                step={5}
                value={settings.default_export_quality}
                onChange={(v) => updateField('default_export_quality', v)}
                disabled={['cbz', 'pdf'].includes(settings.default_export_format)}
                style={{ width: 160 }}
                tooltip={{ formatter: (v) => `${v}%` }}
              />
            </SettingRow>
          </div>

          <div className="glass-card p-5">
            <SectionTitle icon={Type} title="默认字体样式" />
            <SettingRow label="默认字体" desc="应用于新文字区域的默认字体">
              <Select
                value={settings.default_font_family}
                onChange={(v) => updateField('default_font_family', v)}
                size="small"
                style={{ width: 140 }}
                options={FONT_FAMILY_OPTIONS}
              />
            </SettingRow>
            <SettingRow label="默认字号" desc={`当前：${settings.default_font_size}px`}>
              <Slider
                min={10}
                max={36}
                step={1}
                value={settings.default_font_size}
                onChange={(v) => updateField('default_font_size', v)}
                style={{ width: 160 }}
                tooltip={{ formatter: (v) => `${v}px` }}
              />
            </SettingRow>
            <SettingRow label="默认文字颜色">
              <div className="flex items-center gap-1.5">
                {FONT_COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    onClick={() => updateField('default_font_color', color)}
                    className={clsx(
                      'w-6 h-6 rounded-full border-2 transition-all',
                      settings.default_font_color === color
                        ? 'border-primary-500 scale-110 shadow-md'
                        : 'border-transparent hover:scale-105'
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </SettingRow>
          </div>

          <div className="glass-card p-5">
            <SectionTitle icon={Monitor} title="显示与通知" />
            <SettingRow label="界面主题">
              <Select
                value={settings.theme}
                onChange={(v) => updateField('theme', v)}
                size="small"
                style={{ width: 140 }}
                options={THEME_OPTIONS}
              />
            </SettingRow>
            <SettingRow label="通知推送" desc="接收任务完成、导出完成等通知">
              <Switch
                checked={settings.notifications_enabled}
                onChange={(v) => updateField('notifications_enabled', v)}
              />
            </SettingRow>
            <SettingRow label="自动保存阅读进度" desc="每5秒自动保存当前阅读位置">
              <Switch
                checked={settings.auto_save_progress}
                onChange={(v) => updateField('auto_save_progress', v)}
              />
            </SettingRow>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-4 mt-2">
            <span className="text-xs text-slate-400">配置更改会自动保存</span>
            <Button
              size="small"
              type="text"
              icon={<ArrowUp size={14} />}
              onClick={() => {
                const container = document.querySelector('.overflow-y-auto');
                if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              返回顶部
            </Button>
          </div>
          <div className="h-8" />
        </div>
      )}

      {/* 术语库内容 - P0 性能优化: 懒加载 */}
      {activeTab === 'terms' && <TermsPanel />}
    </div>
  );
}
