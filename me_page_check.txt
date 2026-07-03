'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { message, Modal } from 'antd';
import {
  User,
  Crown,
  Settings,
  HelpCircle,
  MessageCircle,
  LogOut,
  ChevronRight,
  Shield,
  Palette,
  Bell,
  Globe,
  Sun,
  Moon,
  Monitor,
  Mail,
  Info,
  Check,
  X,
  Database,
  FileText,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore, type ThemeMode } from '@/stores/themeStore';
import { useRouter } from 'next/navigation';
import { paymentApi } from '@/services/payment';
import { authApi } from '@/services/auth';
import { App } from 'antd';

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: '浅色模式', icon: <Sun size={16} /> },
  { value: 'dark', label: '深色模式', icon: <Moon size={16} /> },
  { value: 'system', label: '跟随系统', icon: <Monitor size={16} /> },
];

export default function MobileMePage() {
  const { user, logout, isAuthenticated, setUser } = useAuthStore();
  const { mode, setMode } = useThemeStore();
  const router = useRouter();
  const { message: msg } = App.useApp();
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [upgrading, setUpgrading] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState(1);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleThemeSelect = (newMode: ThemeMode) => {
    setMode(newMode);
    setShowThemePicker(false);
    message.success(`已切换为${THEME_OPTIONS.find(o => o.value === newMode)?.label}`);
  };

  const handleUpgrade = () => {
    setSelectedMonths(1);
    setShowMembershipModal(true);
  };

  const handleConfirmUpgrade = async () => {
    try {
      setUpgrading(true);
      const res = await paymentApi.upgrade(selectedMonths);
      const order = (res.data as any)?.data;
      if (!order?.pay_url) {
        msg.error('创建订单失败');
        return;
      }

      const payWin = window.open(order.pay_url, '_blank', 'width=720,height=640');
      msg.info(order.mode === 'sandbox' ? '沙箱模式：请在弹出页确认支付' : '请在新窗口完成支付');

      const orderId = order.order_id as string;
      let tries = 0;
      const timer = setInterval(async () => {
        tries += 1;
        try {
          const st = await paymentApi.getOrder(orderId);
          const status = (st.data as any)?.data?.status;
          if (status === 'paid') {
            clearInterval(timer);
            msg.success('支付成功，高级版已开通！');
            try { payWin?.close(); } catch {}
            try {
              const profileRes = await authApi.getProfile();
              const profile = (profileRes.data as any)?.data;
              if (profile) setUser(profile);
            } catch {}
            setShowMembershipModal(false);
          }
        } catch {
          /* 忽略单次轮询失败 */
        }
        if (tries >= 60) {
          clearInterval(timer);
        }
      }, 5000);
    } catch (e: any) {
      const errMsg = (e as any)?.response?.data?.detail || (e as any)?.message || '升级失败';
      msg.error(errMsg);
    } finally {
      setUpgrading(false);
    }
  };

  const handleNotificationSettings = () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then((permission) => {
          message.info(permission === 'granted' ? '通知已开启' : '通知权限被拒绝');
        });
      } else {
        message.info(`通知权限状态: ${Notification.permission}`);
      }
    } else {
      message.info('当前浏览器不支持通知');
    }
  };

  const handleFeedbackSubmit = () => {
    if (feedbackRating === 0) {
      message.warning('请先选择评分');
      return;
    }
    message.success('感谢您的反馈！');
    setShowFeedbackModal(false);
    setFeedbackText('');
    setFeedbackRating(0);
  };

  // 会员权益对比数据（与 PC 端 /pc/plans 保持一致）
  const membershipPlans = [
    { feature: '基础翻译引擎', free: '✅', premium: '✅', freeOk: true, premiumOk: true },
    { feature: '单页/批量导出', free: '✅', premium: '✅', freeOk: true, premiumOk: true },
    { feature: '双语阅读器', free: '✅', premium: '✅', freeOk: true, premiumOk: true },
    { feature: '回收站功能', free: '✅', premium: '✅', freeOk: true, premiumOk: true },
    { feature: '作品数量上限', free: '10个', premium: '无限制', freeOk: true, premiumOk: true },
    { feature: '每日处理页数', free: '10页', premium: '无限制', freeOk: true, premiumOk: true },
    { feature: '多模态翻译引擎', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: '角色语气一致性', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: '超分辨率画质增强', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: '角色分声 TTS', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: '自定义字体上传', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: 'API 开放平台', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: '无水印导出', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: '有声剧场模式', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: '动态漫画生成', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: '团队协作基础', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
    { feature: '优先客服支持', free: '❌', premium: '✅', freeOk: false, premiumOk: true },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-4">
      {/* 用户信息卡片 */}
      <div className="bg-white dark:bg-slate-900 px-4 py-6 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-purple-400 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
            {user?.nickname?.charAt(0) || '漫'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">
              {user?.nickname || '漫画爱好者'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
              {user?.email || user?.phone || '未绑定联系方式'}
            </p>
            <div className="mt-1.5 flex items-center gap-1">
              <span
                className={user?.plan_type === 'premium'
                  ? 'px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                  : 'px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                }
              >
                {user?.plan_type === 'premium' ? '高级版' : '免费版'}
              </span>
            </div>
          </div>
          <ChevronRight size={20} className="text-slate-400" />
        </div>

        {/* 升级入口 */}
        {user?.plan_type !== 'premium' && (
          <button
            onClick={handleUpgrade}
            className="mt-4 w-full p-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Crown size={20} className="text-white" />
              <span className="text-sm font-bold text-white">升级高级版</span>
            </div>
            <ChevronRight size={18} className="text-white/80" />
          </button>
        )}
      </div>

      {/* 菜单列表 */}
      <div className="mt-4 px-4 space-y-3">
        {/* 设置 */}
        <div className="rounded-xl bg-white dark:bg-slate-900 overflow-hidden shadow-sm border border-slate-100 dark:border-slate-800">
          <Link href="/pc/settings">
            <MenuItem icon={<Settings size={20} />} label="偏好设置" />
          </Link>
          <div>
            <button
              onClick={() => setShowThemePicker(!showThemePicker)}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800"
            >
              <span className="text-slate-400"><Palette size={20} /></span>
              <span className="flex-1 text-left">主题设置</span>
              <span className="text-xs text-slate-400 mr-1">
                {THEME_OPTIONS.find(o => o.value === mode)?.label}
              </span>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
            {showThemePicker && (
              <div className="px-4 py-2 space-y-1 border-b border-slate-100 dark:border-slate-800">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleThemeSelect(opt.value)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      mode === opt.value
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400 font-medium'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {opt.icon}
                    {opt.label}
                    {mode === opt.value && <span className="ml-auto text-primary-500">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleNotificationSettings}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800"
          >
            <span className="text-slate-400"><Bell size={20} /></span>
            <span className="flex-1 text-left">通知管理</span>
            <ChevronRight size={16} className="text-slate-300" />
          </button>
          <MenuItem icon={<Globe size={20} />} label="语言设置" last />
        </div>

        {/* 数据用量 */}
        <div className="rounded-xl bg-white dark:bg-slate-900 overflow-hidden shadow-sm border border-slate-100 dark:border-slate-800 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Database size={18} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">数据用量</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-primary-600 dark:text-primary-400">
                {(user as any)?.project_count || 0}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">作品数</div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-accent-500">
                {(user as any)?.storage_used_mb ? `${(user as any).storage_used_mb}MB` : '0MB'}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">已用存储</div>
            </div>
          </div>
        </div>

        {/* 其他 */}
        <div className="rounded-xl bg-white dark:bg-slate-900 overflow-hidden shadow-sm border border-slate-100 dark:border-slate-800">
          <button
            onClick={() => setShowMembershipModal(true)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800"
          >
            <span className="text-slate-400"><Crown size={20} /></span>
            <span className="flex-1 text-left">会员计划</span>
            <ChevronRight size={16} className="text-slate-300" />
          </button>
          <button
            onClick={() => setShowPrivacyModal(true)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800"
          >
            <span className="text-slate-400"><Shield size={20} /></span>
            <span className="flex-1 text-left">隐私政策</span>
            <ChevronRight size={16} className="text-slate-300" />
          </button>
          <button
            onClick={() => setShowHelpModal(true)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800"
          >
            <span className="text-slate-400"><HelpCircle size={20} /></span>
            <span className="flex-1 text-left">帮助中心</span>
            <ChevronRight size={16} className="text-slate-300" />
          </button>
          <button
            onClick={() => setShowFeedbackModal(true)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <span className="text-slate-400"><MessageCircle size={20} /></span>
            <span className="flex-1 text-left">意见反馈</span>
            <ChevronRight size={16} className="text-slate-300" />
          </button>
        </div>

        {/* 退出登录 */}
        {isAuthenticated && (
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-white dark:bg-slate-900 shadow-sm border border-slate-100 dark:border-slate-800 text-red-500 font-medium text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <LogOut size={18} />
            退出登录
          </button>
        )}
      </div>

      {/* 版本信息 */}
      <div className="mt-8 text-center text-xs text-slate-400">
        Manga Translator v0.1.0
      </div>

      {/* ===== 会员权益对比 Modal ===== */}
      <Modal
        title="会员权益对比"
        open={showMembershipModal}
        onCancel={() => setShowMembershipModal(false)}
        footer={null}
        centered
        width={360}
      >
        <div className="py-2">
          <div className="flex justify-between items-center mb-3 px-2">
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-900 dark:text-white">免费版</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">¥0</span>
              </div>
            </div>
            <div className="flex-1 text-right">
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-sm font-bold text-purple-600 dark:text-purple-400">高级版</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">¥29/月</span>
              </div>
            </div>
          </div>
          <div className="space-y-1 max-h-[40vh] overflow-y-auto">
            {membershipPlans.map((plan, idx) => (
              <div key={idx} className="flex items-center py-2 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">
                <span className="flex-1 text-xs text-slate-600 dark:text-slate-400">{plan.feature}</span>
                <span className="w-12 text-center text-xs">{plan.free}</span>
                <span className="w-12 text-center text-xs font-medium text-purple-600 dark:text-purple-400">{plan.premium}</span>
              </div>
            ))}
          </div>

          {user?.plan_type !== 'premium' && (
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                {[
                  { value: 1, label: '1个月', price: 29 },
                  { value: 3, label: '3个月', price: 79, badge: '省¥8' },
                  { value: 12, label: '12个月', price: 299, badge: '省¥49' },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSelectedMonths(option.value)}
                    disabled={upgrading}
                    className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      selectedMonths === option.value
                        ? 'border-purple-500 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-purple-300'
                    }`}
                  >
                    <div>{option.label}</div>
                    <div className="font-bold">¥{option.price}</div>
                    {option.badge && <div className="text-[10px] text-amber-500">{option.badge}</div>}
                  </button>
                ))}
              </div>
              <button
                onClick={handleConfirmUpgrade}
                disabled={upgrading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white font-bold text-sm disabled:opacity-60"
              >
                {upgrading ? '处理中...' : `立即升级 - ¥${selectedMonths === 1 ? 29 : selectedMonths === 3 ? 79 : 299}`}
              </button>
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-[10px] text-amber-700 dark:text-amber-400 text-center">
                <Info size={12} className="inline mr-1" />
                支付成功后立即生效，支持微信/支付宝
              </div>
            </div>
          )}

          {user?.plan_type === 'premium' && (
            <div className="mt-4 p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-xs text-purple-700 dark:text-purple-400 text-center">
              <Crown size={14} className="inline mr-1" />
              您已是高级版用户
            </div>
          )}
        </div>
      </Modal>

      {/* ===== 隐私政策 Modal ===== */}
      <Modal
        title="隐私政策"
        open={showPrivacyModal}
        onCancel={() => setShowPrivacyModal(false)}
        footer={null}
        centered
        width={360}
      >
        <div className="py-2 text-sm text-slate-600 dark:text-slate-400 space-y-3 max-h-96 overflow-y-auto">
          <section>
            <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-1">数据收集与使用</h4>
            <p className="text-xs leading-relaxed">
              我们仅收集您主动上传的漫画图片和必要的账号信息（邮箱/手机号、昵称）。所有上传的漫画内容仅用于翻译处理，不会用于其他目的。
            </p>
          </section>
          <section>
            <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-1">数据存储与安全</h4>
            <p className="text-xs leading-relaxed">
              您的数据存储在加密的云服务器上。处理过程中的临时文件将在7天后自动删除。已完成的作品将保留在您的账号中，直到您主动删除。
            </p>
          </section>
          <section>
            <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-1">数据分享</h4>
            <p className="text-xs leading-relaxed">
              我们不会将您的漫画内容分享给任何第三方。您的上传内容不会用于AI模型训练。所有内容默认仅您本人可见。
            </p>
          </section>
          <section>
            <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-1">Cookie 使用</h4>
            <p className="text-xs leading-relaxed">
              我们使用必要的 Cookie 来维持您的登录状态和主题偏好。不会使用跟踪型 Cookie 或广告 Cookie。
            </p>
          </section>
          <section>
            <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-1">联系我们</h4>
            <p className="text-xs leading-relaxed">
              如有隐私相关问题，请联系：<a href="mailto:privacy@manga-translator.app" className="text-primary-500">privacy@manga-translator.app</a>
            </p>
          </section>
        </div>
      </Modal>

      {/* ===== 帮助中心 Modal ===== */}
      <Modal
        title="帮助中心"
        open={showHelpModal}
        onCancel={() => setShowHelpModal(false)}
        footer={null}
        centered
        width={360}
      >
        <div className="py-2 max-h-96 overflow-y-auto">
          <div className="space-y-4">
            {[
              { q: '如何开始翻译漫画？', a: '在首页点击「上传漫画」或「快速翻译」，选择漫画文件并设置源语言和目标语言，然后点击「一键翻译」即可。' },
              { q: '支持哪些文件格式？', a: '支持 JPG、PNG、WebP 图片格式，以及 CBZ、ZIP、RAR、7Z 压缩包和 PDF 文件导入。' },
              { q: '翻译质量如何保证？', a: '系统提供基础翻译引擎和高级多模态引擎。你可以在编辑器中手动校对翻译结果，或使用术语库确保专有名词翻译准确。' },
              { q: '如何导出翻译后的漫画？', a: '在编辑器中点击「导出」按钮，可以选择导出当前页、当前章节或全部页面。支持 JPG/PNG/WebP/CBZ/PDF 格式及双语对照导出。' },
              { q: '移动端和电脑端数据同步吗？', a: '是的，所有数据云端实时同步。你在电脑端编辑的内容，在移动端可立即查看和继续阅读。' },
              { q: '如何联系技术支持？', a: '请发送邮件至 ' },
            ].map((item, idx) => (
              <details key={idx} className="group">
                <summary className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                  {item.q}
                </summary>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed pl-1">
                  {item.a}
                  {idx === 5 && <a href="mailto:support@manga-translator.app" className="text-primary-500">support@manga-translator.app</a>}
                </p>
              </details>
            ))}
          </div>
        </div>
      </Modal>

      {/* ===== 意见反馈 Modal ===== */}
      <Modal
        title="意见反馈"
        open={showFeedbackModal}
        onCancel={() => { setShowFeedbackModal(false); setFeedbackText(''); setFeedbackRating(0); }}
        footer={
          <div className="flex gap-2">
            <button
              onClick={() => { window.location.href = 'mailto:feedback@manga-translator.app'; }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Mail size={14} />
              通过邮件反馈
            </button>
            <button
              onClick={handleFeedbackSubmit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary-500 text-white hover:bg-primary-600"
            >
              提交反馈
            </button>
          </div>
        }
        centered
        width={360}
      >
        <div className="py-2 space-y-3">
          {/* 评分 */}
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 block">整体评分</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setFeedbackRating(star)}
                  className={`w-10 h-10 rounded-lg text-lg transition-colors ${
                    star <= feedbackRating
                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-500'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-300'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          {/* 文字反馈 */}
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">您的建议（可选）</label>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="说说您的使用体验或建议..."
              className="w-full h-24 text-sm p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 resize-none focus:outline-none focus:border-primary-400 dark:focus:border-primary-500"
              maxLength={500}
            />
            <p className="text-[10px] text-slate-400 text-right mt-0.5">{feedbackText.length}/500</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 菜单项 */
function MenuItem({
  icon,
  label,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  last?: boolean;
}) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
        !last ? 'border-b border-slate-100 dark:border-slate-800' : ''
      }`}
    >
      <span className="text-slate-400">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <ChevronRight size={16} className="text-slate-300" />
    </button>
  );
}
