"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Typography, Button, Card, Tag, Select, App, Empty } from "antd";
import {
  CrownOutlined, CheckCircleOutlined,
  GiftOutlined, LoadingOutlined, ReloadOutlined
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { paymentApi } from "@/services/payment";
import { ErrorDisplay } from "@/components/ui/ErrorDisplay";

const { Title, Text, Paragraph } = Typography;

interface PlanData {
  id: string;
  name: string;
  price: number;
  daily_pages: number;
  max_projects: number;
  features: string[];
  is_current: boolean;
}

interface QuotaData {
  plan: string;
  daily_pages_used: number;
  daily_pages_limit: number | string;
  daily_pages_remaining: number | string;
  active_projects: number;
  projects_limit: number | string;
  can_create_project: boolean;
  can_upload: boolean;
}

const MONTHS_OPTIONS = [
  { value: 1, label: "1个月 - ¥29" },
  { value: 3, label: "3个月 - ¥79 (省¥8)" },
  { value: 12, label: "12个月 - ¥299 (省¥49)" },
];

export default function PlansPage() {
  const { message: msg } = App.useApp();
  const router = useRouter();
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [downgrading, setDowngrading] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [plansRes, quotaRes] = await Promise.allSettled([
        paymentApi.getPlans(),
        paymentApi.getQuota(),
      ]);
      if (plansRes.status === 'fulfilled') {
        const plansData = (plansRes.value?.data as any)?.data;
        setPlans(plansData?.plans || (Array.isArray(plansData) ? plansData : []));
      }
      if (quotaRes.status === 'fulfilled') {
        const quotaData = (quotaRes.value?.data as any)?.data;
        setQuota(quotaData || null);
      }
      if (plansRes.status === 'rejected' && quotaRes.status === 'rejected') {
        const errMsg = (plansRes.reason as Error)?.message || '加载方案信息失败，请稍后重试';
        setLoadError(errMsg);
      }
    } catch (err: any) {
      setLoadError(err?.message || '加载方案信息失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpgrade = async () => {
    try {
      setUpgrading(true);
      const res = await paymentApi.upgrade(selectedMonths);
      const order = (res.data as any)?.data;
      if (!order?.pay_url) {
        msg.error("创建订单失败");
        return;
      }
      // 打开支付页面（真实支付宝 / 沙箱模拟页）
      const payWin = window.open(order.pay_url, "_blank", "width=720,height=640");
      msg.info(order.mode === "sandbox" ? "沙箱模式：请在弹出页确认支付" : "请在新窗口完成支付");

      // 轮询订单状态，支付成功后刷新
      const orderId = order.order_id as string;
      let tries = 0;
      const timer = setInterval(async () => {
        tries += 1;
        try {
          const st = await paymentApi.getOrder(orderId);
          const status = (st.data as any)?.data?.status;
          if (status === "paid") {
            clearInterval(timer);
            msg.success("支付成功，专业版已开通！");
            try { payWin?.close(); } catch {}
            setTimeout(() => window.location.reload(), 1200);
          }
        } catch {
          /* 忽略单次轮询失败 */
        }
        if (tries >= 60) {
          clearInterval(timer); // 最多轮询 5 分钟（60×5s）
        }
      }, 5000);
    } catch (e: any) {
      const errMsg = (e as any)?.response?.data?.detail || (e as any)?.message || "升级失败";
      msg.error(errMsg);
    } finally {
      setUpgrading(false);
    }
  };

  const handleDowngrade = async () => {
    try {
      setDowngrading(true);
      const res = await paymentApi.downgrade();
      const data = (res.data as any)?.data;
      msg.success(data?.message || "已降级为免费版");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      const errMsg = (e as any)?.response?.data?.detail || (e as any)?.message || "降级失败";
      msg.error(errMsg);
    } finally {
      setDowngrading(false);
    }
  };

  const currentPlan = quota?.plan || "free";
  const isPremium = currentPlan === "premium";

  if (loadError && !loading) {
    return (
      <ErrorDisplay
        message="加载方案信息失败"
        detail={loadError}
        onRetry={fetchData}
        fullScreen={false}
        className="min-h-[60vh]"
      />
    );
  }

  return (
    <div className="plans-page max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <Title level={2}>
          <CrownOutlined className="text-yellow-500 mr-2" />
          升级方案
        </Title>
        <Paragraph type="secondary" className="max-w-lg mx-auto">
          选择适合您的方案，解锁更强大的漫画翻译功能
        </Paragraph>
        {loading && (
          <div className="mt-4">
            <LoadingOutlined spin /> <Text type="secondary">加载方案信息...</Text>
          </div>
        )}
        {loadError && !loading && (
          <div className="mt-4">
            <Text type="warning">{loadError}</Text>
            <Button type="link" icon={<ReloadOutlined />} onClick={fetchData}>重试</Button>
          </div>
        )}
      </div>

      {/* 当前用量 */}
      {quota && (
        <Card className="mb-6 shadow-sm" size="small">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <Text type="secondary" className="text-xs">当前方案</Text>
              <p className="text-lg font-bold text-primary-600">
                {PLAN_NAMES[currentPlan] || currentPlan}
              </p>
            </div>
            <div>
              <Text type="secondary" className="text-xs">今日用量</Text>
              <p className="text-lg font-bold">
                {quota.daily_pages_used} / {quota.daily_pages_limit}
              </p>
            </div>
            <div>
              <Text type="secondary" className="text-xs">活跃项目</Text>
              <p className="text-lg font-bold">
                {quota.active_projects} / {quota.projects_limit}
              </p>
            </div>
            <div>
              <Text type="secondary" className="text-xs">剩余页数</Text>
              <p className={`text-lg font-bold ${typeof quota.daily_pages_remaining === 'number' && quota.daily_pages_remaining < 3 ? 'text-red-500' : 'text-green-600'}`}>
                {quota.daily_pages_remaining}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* 免费版 */}
        <Card
          className={`shadow-sm ${isPremium ? "" : "border-green-400 ring-2 ring-green-200"}`}
          title={
            <div className="flex items-center gap-2">
              <GiftOutlined className="text-green-500" />
              <Text strong className="text-lg">免费版</Text>
              {!isPremium && <Tag color="green" className="ml-auto">当前方案</Tag>}
            </div>
          }
        >
          <div className="text-center py-4">
            <Text className="text-3xl font-bold">¥0</Text>
            <Text type="secondary"> 永久免费</Text>
          </div>
          <div className="space-y-2 mb-6">
            {["基础翻译引擎", "单页/批量导出", "最多 10 个作品", "日处理 10 页", "双语阅读器", "基础画质增强", "回收站功能", "带水印导出"].map((f) => (
              <div key={f} className="flex items-center gap-2">
                <CheckCircleOutlined className="text-green-500" />
                <Text className="text-sm">{f}</Text>
              </div>
            ))}
            {["多模态翻译引擎", "角色语气引擎", "无限处理量", "角色分声 TTS", "API 开放平台", "团队协作", "无水印导出", "动态漫画"].map((f) => (
              <div key={f} className="flex items-center gap-2 opacity-50">
                <Text className="text-sm line-through">{f}</Text>
              </div>
            ))}
          </div>
          {isPremium ? (
            <Button block size="large" danger onClick={handleDowngrade} loading={downgrading}>
              {downgrading ? "降级中..." : "降级到免费版"}
            </Button>
          ) : (
            <Button block size="large" disabled>
              当前方案
            </Button>
          )}
        </Card>

        {/* 专业版 */}
        <Card
          className={`shadow-sm ${isPremium ? "border-yellow-400 ring-2 ring-yellow-200" : ""}`}
          title={
            <div className="flex items-center gap-2">
              <CrownOutlined className="text-yellow-500" />
              <Text strong className="text-lg">专业版</Text>
              <Tag color="gold" className="ml-auto">推荐</Tag>
              {isPremium && <Tag color="gold">当前方案</Tag>}
            </div>
          }
        >
          <div className="text-center py-4">
            <Text className="text-3xl font-bold">¥29</Text>
            <Text type="secondary"> /月</Text>
          </div>
          <div className="space-y-2 mb-6">
            {[
              "所有免费版功能", "多模态翻译引擎", "角色语气一致性引擎",
              "无限作品数量", "无限日处理量", "智能排版引擎 2.0",
              "超分辨率画质增强", "角色分声 TTS", "自定义字体上传",
              "API 开放平台", "无水印导出", "翻译质量评估报告",
              "有声剧场模式", "动态漫画生成", "团队协作基础", "优先客服支持",
            ].map((f) => (
              <div key={f} className="flex items-center gap-2">
                <CheckCircleOutlined className="text-green-500" />
                <Text className="text-sm">{f}</Text>
              </div>
            ))}
          </div>
          {isPremium ? (
            <Button block size="large" disabled className="bg-yellow-100 border-yellow-300 text-yellow-700">
              已是专业版
            </Button>
          ) : (
            <div className="space-y-3">
              <Select
                value={selectedMonths}
                onChange={setSelectedMonths}
                options={MONTHS_OPTIONS}
                className="w-full"
              />
              <Button
                type="primary"
                block
                size="large"
                loading={upgrading}
                onClick={handleUpgrade}
                className="bg-yellow-500 border-yellow-500 hover:bg-yellow-600"
              >
                {upgrading ? "处理中..." : `立即升级 - ¥${selectedMonths === 1 ? 29 : selectedMonths === 3 ? 79 : 299}`}
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* FAQ */}
      <Card title="常见问题" variant="borderless" className="shadow-sm">
        <div className="space-y-4">
          <div>
            <Text strong>升级后可以降级吗？</Text>
            <Paragraph type="secondary" className="text-sm mb-0">
              可以。降级后将在当前付费周期结束后生效。免费版的数据不会被删除。
            </Paragraph>
          </div>
          <div>
            <Text strong>支付方式？</Text>
            <Paragraph type="secondary" className="text-sm mb-0">
              支持微信支付和支付宝。支付成功后立即生效。
            </Paragraph>
          </div>
          <div>
            <Text strong>可以退款吗？</Text>
            <Paragraph type="secondary" className="text-sm mb-0">
              购买后 7 天内支持无理由退款。
            </Paragraph>
          </div>
        </div>
      </Card>
    </div>
  );
}

const PLAN_NAMES: Record<string, string> = {
  free: "免费版",
  premium: "专业版",
};
