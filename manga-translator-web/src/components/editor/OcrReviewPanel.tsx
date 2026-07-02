"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  Tabs, Input, Button, Space, Tag, Tooltip, message, Spin,
  Typography, Empty, Popconfirm, Badge
} from "antd";
import {
  ReloadOutlined, CheckOutlined, EditOutlined,
  ExclamationCircleOutlined, ArrowRightOutlined,
  TranslationOutlined, SwapOutlined, EyeOutlined, EyeInvisibleOutlined
} from "@ant-design/icons";
import { pageApi } from "@/services/page";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface OcrRegion {
  region_id: string;
  page_id: string;
  type: string;
  original_text: string;
  translated_text?: string;
  translated_lang?: string;
  confidence: number;
  boundary: any;
  sort_order: number;
}

interface OcrReviewPanelProps {
  pageId: string;
  regions: OcrRegion[];
  onRegionUpdate?: (regionId: string, newText: string) => void;
  onReOcr?: (regionId: string) => Promise<string>;
  loading?: boolean;
  className?: string;
}

export default function OcrReviewPanel({
  pageId,
  regions,
  onRegionUpdate,
  onReOcr,
  loading = false,
  className = "",
}: OcrReviewPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [reOcrLoading, setReOcrLoading] = useState<Record<string, boolean>>({});
  const [saveLoading, setSaveLoading] = useState(false);
  const [showAllTranslations, setShowAllTranslations] = useState(true);

  const handleEdit = (region: OcrRegion) => {
    setEditingId(region.region_id);
    setEditText(region.original_text || "");
  };

  const handleSave = async (regionId: string) => {
    if (!editText.trim()) {
      message.warning("识别文本不能为空");
      return;
    }
    setSaveLoading(true);
    try {
      await pageApi.updateRegions(pageId, [{ region_id: regionId, original_text: editText }]);
      message.success("OCR文本已更新");
      onRegionUpdate?.(regionId, editText);
      setEditingId(null);
    } catch (e: any) {
      message.error("保存失败：" + (e?.message || "未知错误"));
    } finally {
      setSaveLoading(false);
    }
  };

  const handleReOcr = async (regionId: string) => {
    setReOcrLoading((prev) => ({ ...prev, [regionId]: true }));
    try {
      const result = await (onReOcr?.(regionId) || pageApi.reOcrRegion(pageId, regionId));
      message.success("重新识别完成");
      onRegionUpdate?.(regionId, result?.original_text || "");
    } catch (e: any) {
      message.error("重新识别失败：" + (e?.message || "未知错误"));
    } finally {
      setReOcrLoading((prev) => ({ ...prev, [regionId]: false }));
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "green";
    if (confidence >= 0.6) return "orange";
    return "red";
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
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <Spin tip="加载OCR结果..." />
      </div>
    );
  }

  if (!regions || regions.length === 0) {
    return (
      <div className={`${className}`}>
        <Empty
          description={
            <div>
              <Text type="secondary">暂无文字区域</Text>
              <br />
              <Text type="secondary" className="text-xs">
                请先执行"文字检测"步骤
              </Text>
            </div>
          }
        />
      </div>
    );
  }

  const sortedRegions = [...regions].sort((a, b) => a.sort_order - b.sort_order);
  const lowConfidenceCount = regions.filter((r) => r.confidence < 0.8).length;

  return (
    <div className={`ocr-review-panel ${className}`}>
      <div className="flex items-center justify-between mb-3 px-1">
        <Text strong className="text-sm">
          OCR 校对 ({regions.length} 个区域)
        </Text>
        <Space size={4}>
          {regions.some(r => r.translated_text) && (
            <Tooltip title={showAllTranslations ? "隐藏翻译对照" : "显示翻译对照"}>
              <Button
                size="small"
                type="text"
                icon={showAllTranslations ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                onClick={() => setShowAllTranslations(!showAllTranslations)}
              >
                {showAllTranslations ? "对照" : "原文"}
              </Button>
            </Tooltip>
          )}
          {lowConfidenceCount > 0 && (
            <Badge count={lowConfidenceCount} size="small" overflowCount={99}>
              <Tag color="warning" className="ml-2">
                <ExclamationCircleOutlined /> 低置信度
              </Tag>
            </Badge>
          )}
        </Space>
      </div>

      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
        {sortedRegions.map((region) => {
          const isEditing = editingId === region.region_id;
          const isReOcr = reOcrLoading[region.region_id];
          const confidenceColor = getConfidenceColor(region.confidence);

          return (
            <div
              key={region.region_id}
              className={`border rounded-lg p-3 transition-all ${
                isEditing
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <Space size={4}>
                  <Tag color="blue" className="text-xs">{getTypeLabel(region.type)}</Tag>
                  <Tag
                    color={confidenceColor}
                    className="text-xs"
                  >
                    置信度 {(region.confidence * 100).toFixed(0)}%
                  </Tag>
                </Space>
                <Space size={4}>
                  <Tooltip title="重新识别此区域">
                    <Button
                      size="small"
                      type="text"
                      icon={<ReloadOutlined spin={isReOcr} />}
                      onClick={() => handleReOcr(region.region_id)}
                      loading={isReOcr}
                      disabled={isEditing}
                    />
                  </Tooltip>
                  {!isEditing ? (
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => handleEdit(region)}
                    >
                      编辑
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      icon={<CheckOutlined />}
                      onClick={() => handleSave(region.region_id)}
                      loading={saveLoading}
                    >
                      确认
                    </Button>
                  )}
                </Space>
              </div>

              {/* Text Content */}
              {isEditing ? (
                <div className="space-y-2">
                  <TextArea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    placeholder="输入修正后的识别文本..."
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="font-mono text-sm"
                    autoFocus
                    onPressEnter={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        handleSave(region.region_id);
                      }
                    }}
                  />
                  {/* Show translation hint during edit */}
                  {region.translated_text && (
                    <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded text-sm">
                      <div className="flex items-center gap-1 mb-1">
                        <Tag color="green" className="text-[10px]">
                          <TranslationOutlined /> 翻译{region.translated_lang ? `(${region.translated_lang})` : ''}
                        </Tag>
                      </div>
                      <Text className="text-sm">{region.translated_text}</Text>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Original OCR text */}
                  <div className={`p-2 rounded font-mono text-sm ${
                    region.confidence < 0.8
                      ? "bg-yellow-100 dark:bg-yellow-900/30"
                      : showAllTranslations && region.translated_text
                        ? "bg-blue-50 dark:bg-blue-900/20"
                        : "bg-gray-50 dark:bg-gray-800"
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <Text type="secondary" className="text-[10px]">原文 (OCR)</Text>
                      {region.confidence < 0.6 && (
                        <Tag color="red" className="text-[10px] px-1">低置信度</Tag>
                      )}
                    </div>
                    <Paragraph
                      className="mb-0 text-sm"
                      style={{
                        textDecoration: region.confidence < 0.6 ? "underline wavy red" : "none",
                      }}
                    >
                      {region.original_text || (
                        <Text type="secondary" italic>
                          {region.confidence === 0
                            ? '识别失败：区域过小或对比度不足，请手动编辑或重新识别'
                            : '空文本（点击「编辑」添加）'}
                        </Text>
                      )}
                    </Paragraph>
                  </div>
                  {/* Translation comparison */}
                  {showAllTranslations && region.translated_text && (
                    <div className="p-2 rounded bg-green-50 dark:bg-green-900/20 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                          <TranslationOutlined className="text-green-600 text-[10px]" />
                          <Text type="secondary" className="text-[10px]">
                            翻译{region.translated_lang ? ` (${region.translated_lang})` : ''}
                          </Text>
                        </div>
                        <SwapOutlined className="text-green-400 text-[10px]" />
                      </div>
                      <Text className="text-sm">{region.translated_text}</Text>
                    </div>
                  )}
                </div>
              )}

              {/* Confidence warning */}
              {region.confidence < 0.6 && !isEditing && (
                <Text type="danger" className="text-xs mt-1 block">
                  <ExclamationCircleOutlined /> 置信度极低，建议人工校对
                </Text>
              )}
            </div>
          );
        })}
      </div>

      {/* Batch actions */}
      {lowConfidenceCount > 0 && (
        <div className="mt-3 p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
          <Text type="warning" className="text-xs">
            检测到 {lowConfidenceCount} 个低置信度区域(&lt;80%)，请仔细校对
          </Text>
        </div>
      )}

      {/* Keyboard hint */}
      <div className="mt-2 text-center">
        <Text type="secondary" className="text-xs">
          按 Ctrl+Enter 快速确认编辑
        </Text>
      </div>
    </div>
  );
}
