"use client";

import React, { useState, useEffect } from "react";
import { Modal, Button, Steps, Typography, Space, Result, Card, Tag } from "antd";
import {
  RocketOutlined, UploadOutlined, TranslationOutlined,
  CheckCircleOutlined, ArrowRightOutlined, BulbOutlined
} from "@ant-design/icons";
import { create } from "zustand";

const { Text, Title, Paragraph } = Typography;

interface OnboardingState {
  hasCompletedTutorial: boolean;
  dismissTutorial: () => void;
  resetTutorial: () => void;
}

const useOnboardingStore = create<OnboardingState>((set) => {
  const stored = typeof window !== "undefined" ? localStorage.getItem("onboarding_completed") : null;
  return {
    hasCompletedTutorial: stored === "true",
    dismissTutorial: () => {
      localStorage.setItem("onboarding_completed", "true");
      set({ hasCompletedTutorial: true });
    },
    resetTutorial: () => {
      localStorage.removeItem("onboarding_completed");
      set({ hasCompletedTutorial: false });
    },
  };
});

export { useOnboardingStore };

const steps = [
  {
    title: "认识功能",
    icon: <RocketOutlined />,
    content: (
      <div className="text-center py-4">
        <div className="text-6xl mb-4">🎌</div>
        <Title level={4}>欢迎使用漫画翻译系统</Title>
        <Paragraph className="text-gray-500 max-w-md mx-auto">
          上传你的漫画，AI 将自动完成：
          <br />
          文字检测 → OCR 识别 → 智能翻译 → 背景修复 → 排版回填
          <br />
          全程自动化，几分钟即可完成一整话翻译！
        </Paragraph>
        <Space wrap className="mt-2">
          <Tag color="blue">日漫翻译</Tag>
          <Tag color="green">韩漫翻译</Tag>
          <Tag color="purple">双语对照</Tag>
          <Tag color="orange">高清导出</Tag>
        </Space>
      </div>
    ),
  },
  {
    title: "上传漫画",
    icon: <UploadOutlined />,
    content: (
      <div className="text-center py-4">
        <div className="text-6xl mb-4">📤</div>
        <Title level={4}>上传你的第一部漫画</Title>
        <Paragraph className="text-gray-500 max-w-md mx-auto">
          支持多种格式：
          <br />
          <Tag>JPG</Tag> <Tag>PNG</Tag> <Tag>WebP</Tag> <Tag>CBZ</Tag> <Tag>ZIP</Tag>
          <br />
          点击"新建项目"，拖拽或选择文件即可开始
        </Paragraph>
        <div className="mt-3 text-left bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm">
          <Text type="secondary">💡 小提示：</Text>
          <ul className="list-disc pl-4 mt-1 text-gray-500 space-y-1">
            <li>单次最多上传 200 张图片</li>
            <li>支持压缩包自动解压</li>
            <li>竖版长图可自动分格</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    title: "一键翻译",
    icon: <TranslationOutlined />,
    content: (
      <div className="text-center py-4">
        <div className="text-6xl mb-4">✨</div>
        <Title level={4}>体验一键翻译</Title>
        <Paragraph className="text-gray-500 max-w-md mx-auto">
          选择源语言和目标语言后，点击"一键翻译"
          <br />
          系统会自动完成全部处理流程
          <br />
          翻译完成后可以预览、校对和导出
        </Paragraph>
        <div className="mt-3 text-left bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-sm">
          <Text className="text-blue-600">
            完成后可在校对工作台精细调整翻译结果
          </Text>
        </div>
      </div>
    ),
  },
];

interface OnboardingWizardProps {
  visible: boolean;
  onClose: () => void;
}

export default function OnboardingWizard({ visible, onClose }: OnboardingWizardProps) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (visible) setCurrent(0);
  }, [visible]);

  const next = () => {
    setCurrent((prev) => prev + 1);
  };

  const prev = () => {
    setCurrent((prev) => prev - 1);
  };

  const handleDone = () => {
    onClose();
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width={560}
      centered
      closable
      maskClosable={false}
      title={
        <div className="flex items-center gap-2">
          <BulbOutlined className="text-yellow-500" />
          <span>新手指引</span>
        </div>
      }
    >
      <Steps current={current} items={steps.map((s) => ({ title: s.title }))} className="mb-6" />

      <div className="min-h-[200px]">{steps[current]?.content}</div>

      <div className="flex justify-between mt-6">
        <div>
          {current > 0 ? (
            <Button onClick={prev}>上一步</Button>
          ) : (
            <Button type="link" onClick={handleDone}>
              跳过引导
            </Button>
          )}
        </div>
        <div>
          {current < steps.length - 1 ? (
            <Button type="primary" onClick={next} icon={<ArrowRightOutlined />}>
              下一步
            </Button>
          ) : (
            <Button type="primary" onClick={handleDone} icon={<CheckCircleOutlined />}>
              开始使用
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Empty state component for various pages
export function EmptyStateGuide({
  icon = "📚",
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  icon?: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="text-6xl mb-4">{icon}</div>
      <Title level={4} className="mb-2">{title}</Title>
      <Text type="secondary" className="mb-6 text-center max-w-md">
        {description}
      </Text>
      <Space>
        <Button type="primary" size="large" onClick={onAction}>
          {actionLabel}
        </Button>
        {secondaryLabel && onSecondary && (
          <Button size="large" onClick={onSecondary}>
            {secondaryLabel}
          </Button>
        )}
      </Space>
    </div>
  );
}
