"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  Tabs, Table, Button, Input, Space, Tag, Typography,
  Select, message, Popconfirm, Tooltip, Card, Badge,
  Segmented, Modal, Empty,
} from "antd";
import {
  SearchOutlined, ReloadOutlined, CheckOutlined,
  ArrowLeftOutlined, ArrowRightOutlined,
  EditOutlined, FilterOutlined, SortAscendingOutlined,
  ReplaceOutlined, DownloadOutlined
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import request from "@/services/request";

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

interface RegionEntry {
  region_id: string;
  page_id: string;
  page_number: number;
  type: string;
  original_text: string;
  translated_text: string;
  confidence: number;
  chapter_name?: string;
  is_locked?: boolean;
}

interface ReviewPageProps {
  projectId: string;
  projectName: string;
}

// Real API hook — replaces simulated data with actual review endpoints
function useReviewData(projectId: string) {
  const [regions, setRegions] = useState<RegionEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadRegions();
  }, [projectId]);

  const loadRegions = async () => {
    setLoading(true);
    try {
      const res = await request.get<{ code: number; data: { regions: RegionEntry[] } }>(
        `/projects/${projectId}/review/pages`
      );
      if (res.data?.code === 0 && res.data?.data?.regions) {
        setRegions(res.data.data.regions);
      } else {
        setRegions([]);
      }
    } catch {
      setRegions([]);
    }
    setLoading(false);
  };

  return { regions, setRegions, loading, reload: loadRegions };
}

export default function BatchProofreadPanel({
  projectId,
  projectName,
}: ReviewPageProps) {
  const router = useRouter();
  const { regions, setRegions, loading, reload } = useReviewData(projectId);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [batchLoading, setBatchLoading] = useState(false);

  // Filtered regions
  const filteredRegions = regions.filter((r) => {
    if (filterStatus === "unreviewed" && r.translated_text) return false;
    if (filterStatus === "low_confidence" && r.confidence >= 0.7) return false;
    if (filterType !== "all" && r.type !== filterType) return false;
    if (searchQuery && !r.original_text?.includes(searchQuery) && !r.translated_text?.includes(searchQuery)) return false;
    return true;
  });

  const currentRegion = filteredRegions[currentIndex] || null;
  const totalCount = filteredRegions.length;

  const handleEdit = () => {
    if (currentRegion) {
      setEditedText(currentRegion.translated_text || "");
      setEditMode(true);
    }
  };

  const handleSave = async () => {
    if (!currentRegion) return;
    setBatchLoading(true);
    try {
      // Real API: PUT /api/v1/projects/{pid}/review/regions/{rid}
      await request.put(
        `/projects/${projectId}/review/regions/${currentRegion.region_id}`,
        { translated_text: editedText }
      );
      setRegions((prev) =>
        prev.map((r) =>
          r.region_id === currentRegion.region_id
            ? { ...r, translated_text: editedText }
            : r
        )
      );
      message.success("译文已保存");
      setEditMode(false);
    } catch {
      message.error("保存失败");
    }
    setBatchLoading(false);
  };

  const handleNext = () => {
    if (currentIndex < totalCount - 1) {
      setEditMode(false);
      setCurrentIndex((i) => i + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setEditMode(false);
      setCurrentIndex((i) => i - 1);
    }
  };

  const handleBatchReplace = async () => {
    if (!searchQuery || !replaceText) {
      message.warning("请输入搜索关键词和替换文本");
      return;
    }
    setBatchLoading(true);
    try {
      // Real API: POST /api/v1/projects/{pid}/review/batch-replace
      const res = await request.post<{ code: number; data: { replaced_count: number } }>(
        `/projects/${projectId}/review/batch-replace`,
        { search_pattern: searchQuery, replacement: replaceText }
      );
      const count = res.data?.data?.replaced_count || 0;

      setRegions((prev) =>
        prev.map((r) => ({
          ...r,
          translated_text: (r.translated_text || "").replace(
            new RegExp(searchQuery, "g"),
            replaceText
          ),
        }))
      );
      message.success(`已替换 ${count} 处匹配`);
      setShowReplaceDialog(false);
    } catch {
      message.error("批量替换失败，请检查后端服务是否可用");
    }
    setBatchLoading(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      switch (e.key) {
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) handlePrev();
          else handleNext();
          break;
        case "Enter":
          if (!editMode) {
            e.preventDefault();
            handleEdit();
          }
          break;
        case "Escape":
          if (editMode) {
            setEditMode(false);
          }
          break;
        case "h":
        case "H":
          // Toggle selection visibility handled in parent
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIndex, editMode, totalCount]);

  const getTypeColor = (type: string) => {
    const map: Record<string, string> = {
      speech: "blue",
      thought: "purple",
      narration: "cyan",
      onomatopoeia: "orange",
      effect: "red",
    };
    return map[type] || "default";
  };

  const getTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      speech: "对话",
      thought: "内心独白",
      narration: "旁白",
      onomatopoeia: "拟声词",
      effect: "效果字",
    };
    return map[type] || type;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Text type="secondary">加载校对数据...</Text>
      </div>
    );
  }

  if (!regions.length) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Empty description="暂无可校对内容" />
        <Text type="secondary" className="text-sm mt-2">
          请先完成翻译后再进入校对工作台
        </Text>
      </div>
    );
  }

  return (
    <div className="batch-proofread-panel h-full flex flex-col">
      {/* Header Bar */}
      <div className="flex items-center justify-between p-3 border-b dark:border-gray-700 bg-white dark:bg-gray-900">
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            type="text"
            onClick={() => router.back()}
          >
            返回
          </Button>
          <Title level={5} className="mb-0">
            <Tag color="processing">校对工作台</Tag>
            {projectName}
          </Title>
        </Space>

        <Space>
          <Text type="secondary">
            进度：{currentIndex + 1} / {totalCount}
          </Text>
          <Input
            size="small"
            placeholder="搜索..."
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentIndex(0);
            }}
            style={{ width: 200 }}
            allowClear
          />
          <Select
            size="small"
            value={filterStatus}
            onChange={(v) => { setFilterStatus(v); setCurrentIndex(0); }}
            style={{ width: 100 }}
            options={[
              { label: "全部", value: "all" },
              { label: "待校对", value: "unreviewed" },
              { label: "低置信度", value: "low_confidence" },
            ]}
          />
          <Select
            size="small"
            value={filterType}
            onChange={(v) => { setFilterType(v); setCurrentIndex(0); }}
            style={{ width: 100 }}
            options={[
              { label: "全部类型", value: "all" },
              { label: "对话", value: "speech" },
              { label: "内心独白", value: "thought" },
              { label: "旁白", value: "narration" },
              { label: "拟声词", value: "onomatopoeia" },
              { label: "效果字", value: "effect" },
            ]}
          />
          <Button
            size="small"
            icon={<ReplaceOutlined />}
            onClick={() => setShowReplaceDialog(true)}
          >
            批量替换
          </Button>
          <Tooltip title="刷新数据 (Ctrl+R)">
            <Button size="small" icon={<ReloadOutlined />} onClick={reload} />
          </Tooltip>
        </Space>
      </div>

      {/* Dual-Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Original Text */}
        <div className="w-1/2 border-r dark:border-gray-700 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-800">
          <Text type="secondary" className="text-xs mb-2 block">
            原文 {currentRegion && `(#${currentRegion.page_number || "?"})`}
          </Text>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-4 min-h-[300px]">
            {currentRegion && (
              <div>
                <Space className="mb-2">
                  <Tag color={getTypeColor(currentRegion.type)}>
                    {getTypeLabel(currentRegion.type)}
                  </Tag>
                  {currentRegion.confidence < 0.7 && (
                    <Tag color="warning">低置信度 {(currentRegion.confidence * 100).toFixed(0)}%</Tag>
                  )}
                  {currentRegion.is_locked && <Tag color="red">已锁定</Tag>}
                </Space>
                <Paragraph className="text-lg whitespace-pre-wrap font-mono leading-relaxed">
                  {currentRegion.original_text}
                </Paragraph>
              </div>
            )}
          </div>
        </div>

        {/* Right: Translated Text (Editable) */}
        <div className="w-1/2 overflow-y-auto p-4 bg-blue-50 dark:bg-blue-900/10">
          <Text type="secondary" className="text-xs mb-2 block">
            译文
          </Text>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-4 min-h-[300px]">
            {currentRegion ? (
              editMode ? (
                <div>
                  <TextArea
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    autoSize={{ minRows: 4, maxRows: 10 }}
                    className="text-lg font-mono"
                    autoFocus
                    placeholder="输入修改后的译文..."
                  />
                  <div className="flex justify-end mt-3 gap-2">
                    <Button onClick={() => setEditMode(false)}>取消</Button>
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      onClick={handleSave}
                      loading={batchLoading}
                    >
                      确认并继续
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Paragraph
                    className="text-lg whitespace-pre-wrap font-mono leading-relaxed cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 p-2 rounded"
                    onClick={handleEdit}
                  >
                    {currentRegion.translated_text || (
                      <Text type="secondary" italic>
                        点击编辑译文...
                      </Text>
                    )}
                  </Paragraph>
                  <div className="flex justify-end mt-2">
                    <Button size="small" icon={<EditOutlined />} onClick={handleEdit}>
                      编辑
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <Empty description="无匹配结果" />
            )}
          </div>
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="flex items-center justify-between p-3 border-t dark:border-gray-700 bg-white dark:bg-gray-900">
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            disabled={currentIndex === 0}
            onClick={handlePrev}
          >
            上一个 (Shift+Tab)
          </Button>
          <Button
            icon={<ArrowRightOutlined />}
            disabled={currentIndex >= totalCount - 1}
            onClick={handleNext}
            type="primary"
          >
            下一个 (Tab)
          </Button>
        </Space>

        <Space>
          <Text type="secondary" className="text-xs">
            Tab=下一个 | Shift+Tab=上一个 | Enter=编辑 | Esc=取消编辑 | H=隐藏选区
          </Text>
        </Space>
      </div>

      {/* Batch Replace Modal */}
      <Modal
        title="批量替换"
        open={showReplaceDialog}
        onOk={handleBatchReplace}
        onCancel={() => setShowReplaceDialog(false)}
        confirmLoading={batchLoading}
        okText="执行替换"
        cancelText="取消"
      >
        <div className="space-y-3 py-2">
          <div>
            <Text className="text-xs text-gray-500">查找内容</Text>
            <Input
              placeholder="输入要查找的文本"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div>
            <Text className="text-xs text-gray-500">替换为</Text>
            <Input
              placeholder="输入替换后的文本"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
            />
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded text-sm">
            <Text type="warning">
              此操作将在全文范围内替换所有匹配的文本，建议先预览再执行。
            </Text>
          </div>
        </div>
      </Modal>
    </div>
  );
}
