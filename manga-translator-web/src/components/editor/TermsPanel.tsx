"use client";

import React, { useState, useCallback } from "react";
import {
  Table, Button, Space, Tag, Modal, Input, Select, Upload,
  message, Popconfirm, Typography, Tooltip, Dropdown, Badge
} from "antd";
import {
  PlusOutlined, DeleteOutlined, UploadOutlined, DownloadOutlined,
  SearchOutlined, FilterOutlined, LockOutlined, UnlockOutlined
} from "@ant-design/icons";
import { termApi } from "@/services/term";
import type { ColumnsType } from "antd/es/table";

const { Text, Title } = Typography;

interface TermEntry {
  term_id: string;
  source_text: string;
  target_text: string;
  note?: string;
  category?: string;
  scope: "account" | "project";
  created_at?: string;
  updated_at?: string;
}

interface TermsPanelProps {
  projectId?: string;
  readOnly?: boolean;
  onTermSelect?: (term: TermEntry) => void;
  selectedTerms?: string[];
  className?: string;
}

const CATEGORIES = ["人名", "地名", "招式名", "组织名", "道具名", "昵称", "文化梗", "其他"];

export default function TermsPanel({
  projectId,
  readOnly = false,
  onTermSelect,
  selectedTerms = [],
  className = "",
}: TermsPanelProps) {
  const [terms, setTerms] = useState<TermEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTerm, setEditingTerm] = useState<TermEntry | null>(null);
  const [searchText, setSearchText] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  // Form state
  const [formSource, setFormSource] = useState("");
  const [formTarget, setFormTarget] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formScope, setFormScope] = useState<"account" | "project">("project");
  const [formSubmitting, setFormSubmitting] = useState(false);

  const loadTerms = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page_size: 100 };
      if (searchText) params.source_text = searchText;
      if (filterCategory) params.category = filterCategory;
      if (projectId) params.project_id = projectId;
      const result = await termApi.getList(params);
      setTerms(result?.items || []);
    } catch (e: any) {
      message.error("加载术语失败：" + (e?.message || ""));
    } finally {
      setLoading(false);
    }
  }, [searchText, filterCategory, projectId]);

  React.useEffect(() => {
    loadTerms();
  }, [loadTerms]);

  const handleSubmit = async () => {
    if (!formSource.trim() || !formTarget.trim()) {
      message.warning("原文和译文不能为空");
      return;
    }
    setFormSubmitting(true);
    try {
      if (editingTerm) {
        await termApi.update(editingTerm.term_id, {
          source_text: formSource,
          target_text: formTarget,
          note: formNote,
          category: formCategory,
        });
        message.success("术语已更新");
      } else {
        await termApi.create({
          source_text: formSource,
          target_text: formTarget,
          note: formNote,
          category: formCategory,
          scope: formScope,
          project_id: projectId,
        });
        message.success("术语已添加");
      }
      setModalVisible(false);
      resetForm();
      loadTerms();
    } catch (e: any) {
      message.error("操作失败：" + (e?.message || ""));
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDelete = async (termId: string) => {
    try {
      await termApi.delete(termId);
      message.success("术语已删除");
      loadTerms();
    } catch (e: any) {
      message.error("删除失败：" + (e?.message || ""));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先选择要删除的术语");
      return;
    }
    for (const termId of selectedRowKeys) {
      try {
        await termApi.delete(termId);
      } catch {}
    }
    message.success(`已删除 ${selectedRowKeys.length} 个术语`);
    setSelectedRowKeys([]);
    loadTerms();
  };

  const handleImport = async (file: File) => {
    try {
      await termApi.import(file);
      message.success("术语导入成功");
      loadTerms();
    } catch (e: any) {
      message.error("导入失败：" + (e?.message || ""));
    }
    return false; // Prevent default upload
  };

  const handleExport = async () => {
    try {
      const params: any = {};
      if (projectId) params.project_id = projectId;
      await termApi.export(params);
      message.success("术语导出中...");
    } catch (e: any) {
      message.error("导出失败：" + (e?.message || ""));
    }
  };

  const resetForm = () => {
    setFormSource("");
    setFormTarget("");
    setFormNote("");
    setFormCategory("");
    setFormScope("project");
    setEditingTerm(null);
  };

  const openEdit = (term: TermEntry) => {
    setEditingTerm(term);
    setFormSource(term.source_text);
    setFormTarget(term.target_text);
    setFormNote(term.note || "");
    setFormCategory(term.category || "");
    setFormScope(term.scope);
    setModalVisible(true);
  };

  const columns: ColumnsType<TermEntry> = [
    {
      title: "原文",
      dataIndex: "source_text",
      key: "source_text",
      render: (text: string) => <Text strong className="font-mono">{text}</Text>,
    },
    {
      title: "译文",
      dataIndex: "target_text",
      key: "target_text",
      render: (text: string) => <Text className="font-mono text-blue-600">{text}</Text>,
    },
    {
      title: "分类",
      dataIndex: "category",
      key: "category",
      width: 100,
      render: (cat: string) =>
        cat ? <Tag color="purple">{cat}</Tag> : <Tag color="default">未分类</Tag>,
    },
    {
      title: "范围",
      dataIndex: "scope",
      key: "scope",
      width: 80,
      render: (scope: string) => (
        <Tag color={scope === "account" ? "blue" : "green"}>
          {scope === "account" ? "账号级" : "作品级"}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      render: (_, record) => (
        <Space size="small">
          {!readOnly && (
            <>
              <Button
                size="small"
                type="link"
                onClick={() => openEdit(record)}
              >
                编辑
              </Button>
              <Popconfirm
                title="确定删除此术语？"
                onConfirm={() => handleDelete(record.term_id)}
              >
                <Button size="small" type="link" danger>
                  删除
                </Button>
              </Popconfirm>
            </>
          )}
          {onTermSelect && (
            <Button
              size="small"
              type={selectedTerms.includes(record.term_id) ? "primary" : "default"}
              ghost
              icon={selectedTerms.includes(record.term_id) ? <LockOutlined /> : <UnlockOutlined />}
              onClick={() => onTermSelect(record)}
            >
              {selectedTerms.includes(record.term_id) ? "已锁定" : "锁定"}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className={`terms-panel ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <Title level={5} className="mb-0">术语库</Title>
        <Space size="small">
          {!readOnly && (
            <>
              <Upload
                accept=".csv"
                showUploadList={false}
                beforeUpload={handleImport}
              >
                <Tooltip title="从CSV导入">
                  <Button size="small" icon={<UploadOutlined />}>
                    导入
                  </Button>
                </Tooltip>
              </Upload>
              <Tooltip title="导出为CSV">
                <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}>
                  导出
                </Button>
              </Tooltip>
            </>
          )}
        </Space>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-2 mb-3">
        <Input
          size="small"
          placeholder="搜索术语..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          className="flex-1"
        />
        <Select
          size="small"
          placeholder="分类筛选"
          value={filterCategory || undefined}
          onChange={setFilterCategory}
          allowClear
          style={{ width: 120 }}
          options={CATEGORIES.map((c) => ({ label: c, value: c }))}
        />
      </div>

      {/* Toolbar */}
      {!readOnly && (
        <div className="flex justify-between mb-2">
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              resetForm();
              setModalVisible(true);
            }}
          >
            添加术语
          </Button>
          {selectedRowKeys.length > 0 && (
            <Popconfirm
              title={`确定删除选中的 ${selectedRowKeys.length} 个术语？`}
              onConfirm={handleBatchDelete}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          )}
        </div>
      )}

      {/* Table */}
      <Table
        columns={columns}
        dataSource={terms}
        rowKey="term_id"
        size="small"
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        rowSelection={
          readOnly
            ? undefined
            : {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }
        }
        scroll={{ y: 400 }}
        locale={{
          emptyText: (
            <div className="py-4">
              <Text type="secondary">暂无术语</Text>
              <br />
              {!readOnly && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    resetForm();
                    setModalVisible(true);
                  }}
                >
                  添加第一个术语
                </Button>
              )}
            </div>
          ),
        }}
      />

      {/* Add/Edit Modal */}
      <Modal
        title={editingTerm ? "编辑术语" : "添加术语"}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => {
          setModalVisible(false);
          resetForm();
        }}
        confirmLoading={formSubmitting}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="space-y-3 py-2">
          <div>
            <Text className="text-xs text-gray-500">原文 *</Text>
            <Input
              placeholder="输入原文术语"
              value={formSource}
              onChange={(e) => setFormSource(e.target.value)}
              maxLength={500}
            />
          </div>
          <div>
            <Text className="text-xs text-gray-500">译文 *</Text>
            <Input
              placeholder="输入对应译文"
              value={formTarget}
              onChange={(e) => setFormTarget(e.target.value)}
              maxLength={500}
            />
          </div>
          <div>
            <Text className="text-xs text-gray-500">分类标签</Text>
            <Select
              placeholder="选择分类"
              value={formCategory || undefined}
              onChange={setFormCategory}
              allowClear
              style={{ width: "100%" }}
              options={CATEGORIES.map((c) => ({ label: c, value: c }))}
            />
          </div>
          <div>
            <Text className="text-xs text-gray-500">备注</Text>
            <Input.TextArea
              placeholder="备注说明..."
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              rows={2}
            />
          </div>
          {!editingTerm && (
            <div>
              <Text className="text-xs text-gray-500">适用范围</Text>
              <Select
                value={formScope}
                onChange={setFormScope}
                style={{ width: "100%" }}
                options={[
                  { label: "作品级（仅当前作品）", value: "project" },
                  { label: "账号级（所有作品通用）", value: "account" },
                ]}
              />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
