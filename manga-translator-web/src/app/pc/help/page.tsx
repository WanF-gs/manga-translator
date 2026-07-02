"use client";

import React, { useState, useEffect } from "react";
import {
  Collapse, Input, Typography, Space, Tag, List, Button, Divider,
  Table, Empty, Tooltip, Card,
} from "antd";
import {
  SearchOutlined, KeyOutlined,
  QuestionCircleOutlined, BulbOutlined
} from "@ant-design/icons";

const { Text, Title, Paragraph, Link } = Typography;
const { Panel } = Collapse;

const FAQ_DATA = [
  {
    question: "如何开始翻译一部漫画？",
    answer: "点击「新建项目」，上传漫画图片（支持 JPG/PNG/CBZ/ZIP 等格式）。选择源语言和目标语言后，点击「一键翻译」即可自动完成全流程。",
  },
  {
    question: "翻译质量不满意怎么办？",
    answer: "进入「专业编辑模式」，可以手动修改选区、校对译文、调整字体样式。也可以使用校对工作台批量校对，或提交反馈帮助我们改进。",
  },
  {
    question: "支持哪些语言之间的翻译？",
    answer: "当前支持日语(ja)、中文(zh)、英语(en)、韩语(ko)之间的相互翻译。未来将支持更多语言。",
  },
  {
    question: "免费版有什么限制？",
    answer: "免费版每天可处理 10 页漫画，最多保留 10 个作品项目。升级专业版（¥29/月）可享受无限处理量和全部高级功能。",
  },
  {
    question: "如何导出翻译好的漫画？",
    answer: "翻译完成后，点击「导出」按钮。支持单页导出（JPG/PNG/WebP）、批量打包（CBZ漫画包）、PDF单行本、双语对照模式等多种格式。",
  },
  {
    question: "手机上可以使用吗？",
    answer: "支持！直接通过手机浏览器访问即可。移动端提供快速翻译、在线阅读、夜间模式等功能。推荐使用 PWA 模式加成到主屏幕以获得更好体验。",
  },
  {
    question: "我的数据安全吗？如何删除数据？",
    answer: "所有数据存储在云端，仅您本人可见。删除作品后，数据会进入回收站保留30天，之后自动永久清理。您也可以手动永久删除。",
  },
  {
    question: "上传的字体文件有什么要求？",
    answer: "支持 TTF/OTF 格式，单个文件不超过 20MB。上传后可全端同步使用。请确保您拥有字体的合法使用权。",
  },
];

const SHORTCUTS = [
  { keys: "Tab", description: "跳转下一个文字区域" },
  { keys: "Shift + Tab", description: "跳转上一个文字区域" },
  { keys: "Ctrl + Z", description: "撤销" },
  { keys: "Ctrl + Y", description: "重做" },
  { keys: "Ctrl + S", description: "保存当前进度" },
  { keys: "Ctrl + F", description: "搜索文本" },
  { keys: "Ctrl + H", description: "替换文本" },
  { keys: "Delete", description: "删除选中区域" },
  { keys: "H", description: "隐藏/显示选区线" },
  { keys: "Space + 拖拽", description: "平移画布" },
  { keys: "Enter", description: "确认编辑并进入下一句" },
  { keys: "Esc", description: "取消编辑/关闭弹窗" },
  { keys: "+ / -", description: "缩放画布" },
  { keys: "0", description: "重置画布缩放" },
];

const FEATURES = [
  {
    title: "文字检测",
    description: "AI 自动识别漫画中的对话气泡、内心独白、旁白、拟声词等各类文字区域",
  },
  {
    title: "OCR 识别",
    description: "多语言光学字符识别，支持日文竖排、弧形文本等特殊排版",
  },
  {
    title: "智能翻译",
    description: "基于多模态大模型的语境感知翻译，保留角色语气与文化梗",
  },
  {
    title: "背景修复",
    description: "智能擦除原文并修复背景纹理，支持网点纸、排线、渐变等复杂背景",
  },
  {
    title: "排版回填",
    description: "AI 自适应排版引擎，自动匹配气泡大小、优化字体与间距",
  },
  {
    title: "多格式导出",
    description: "支持 CBZ/ZIP/PDF/JPG/PNG/WebP 等多种格式导出",
  },
];

export default function HelpCenterPage() {
  const [searchText, setSearchText] = useState("");

  const filteredFAQ = FAQ_DATA.filter(
    (faq) =>
      faq.question.includes(searchText) || faq.answer.includes(searchText)
  );

  return (
    <div className="help-center max-w-4xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="text-5xl mb-4">📖</div>
        <Title level={2}>帮助中心</Title>
        <Paragraph type="secondary" className="max-w-lg mx-auto">
          了解如何使用漫画翻译系统的各项功能，查找常见问题解答
        </Paragraph>
        <Input
          size="large"
          placeholder="搜索帮助内容..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          className="max-w-md mx-auto mt-4"
        />
      </div>

      {/* Features Overview */}
      <Card title={<><BulbOutlined /> 功能介绍</>} variant="borderless" className="shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
              <Title level={5} className="mb-1">{f.title}</Title>
              <Text type="secondary" className="text-sm">{f.description}</Text>
            </div>
          ))}
        </div>
      </Card>

      {/* FAQ */}
      <Card title={<><QuestionCircleOutlined /> 常见问题</>} variant="borderless" className="shadow-sm">
        {filteredFAQ.length === 0 ? (
          <Empty description="未找到相关问题" />
        ) : (
          <Collapse
            size="small"
            items={filteredFAQ.map((faq, i) => ({
              key: String(i),
              label: <Text strong>{faq.question}</Text>,
              children: <Paragraph className="text-gray-600">{faq.answer}</Paragraph>,
            }))}
          />
        )}
      </Card>

      {/* Keyboard Shortcuts */}
      <Card title={<><KeyOutlined /> 快捷键一览</>} variant="borderless" className="shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800">
              <Tag color="blue" className="font-mono text-xs m-0">{s.keys}</Tag>
              <Text className="text-sm">{s.description}</Text>
            </div>
          ))}
        </div>
      </Card>

      {/* Contact */}
      <div className="text-center py-4">
        <Text type="secondary">
          还有问题？请通过反馈面板联系我们，或发送邮件至 support@manga-translator.com
        </Text>
      </div>
    </div>
  );
}
