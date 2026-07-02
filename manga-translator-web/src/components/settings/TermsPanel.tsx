'use client';

/**
 * 术语库管理面板 (P0 性能优化: 从 settings 页面拆分为独立懒加载组件)
 * 
 * 该组件包含 antd Table 等重型依赖，仅在用户点击"术语库"标签时才加载，
 * 避免 settings 页面 6000+ 模块的全量编译。
 */
import React, { useState, useCallback } from 'react';
import { Form, Button, Input, Select, Upload, Tag, Popconfirm, Modal, App } from 'antd';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  UploadOutlined,
  DownloadOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useTerms, useCreateTerm, useDeleteTerm } from '@/hooks/useApiQueries';
import { termApi } from '@/services/term';
import type { TermEntry } from '@/services/term';

const SCOPE_OPTIONS = [
  { value: 'account', label: '账号级' },
  { value: 'project', label: '项目级' },
];

const CATEGORY_OPTIONS = [
  { value: 'name', label: '人名' },
  { value: 'place', label: '地名' },
  { value: 'term', label: '专有名词' },
  { value: 'custom', label: '自定义' },
];

export function TermsPanel() {
  const { message } = App.useApp();
  const [termSearch, setTermSearch] = useState('');
  const [termPage, setTermPage] = useState(1);
  const [createTermOpen, setCreateTermOpen] = useState(false);
  const [termForm] = Form.useForm();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const { data: termData, isLoading: termsLoading } = useTerms({
    keyword: termSearch || undefined,
    page: termPage,
    page_size: 20,
  });
  const createTerm = useCreateTerm();
  const deleteTerm = useDeleteTerm();

  // ===== 术语表列定义 =====
  const termColumns: ColumnsType<TermEntry> = [
    {
      title: '原文',
      dataIndex: 'source_text',
      key: 'source_text',
      width: 160,
      ellipsis: true,
    },
    {
      title: '译文',
      dataIndex: 'target_text',
      key: 'target_text',
      width: 160,
      ellipsis: true,
      render: (text: string) => (
        <span className="font-medium text-primary-600 dark:text-primary-400">{text}</span>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (cat: string) =>
        cat ? <Tag>{cat}</Tag> : <span className="text-slate-300">—</span>,
    },
    {
      title: '范围',
      dataIndex: 'scope',
      key: 'scope',
      width: 80,
      render: (scope: string) => (
        <Tag color={scope === 'project' ? 'blue' : 'default'}>
          {scope === 'project' ? '项目' : '账号'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: TermEntry) => (
        <Popconfirm
          title="确定删除该术语？"
          onConfirm={() => deleteTerm.mutate(record.term_id)}
          okText="确定"
          cancelText="取消"
        >
          <Button size="small" danger type="link">
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  // ===== CSV 导出处理 =====
  const handleExportCSV = useCallback(async () => {
    try {
      const res = await termApi.export();
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `terms_export_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch {
      message.error('导出失败');
    }
  }, []);

  // ===== CSV 导入处理 =====
  const handleImportCSV = useCallback(
    async (file: File) => {
      try {
        await termApi.import(file);
        message.success('导入成功');
      } catch {
        message.error('导入失败');
      }
      return false;
    },
    []
  );

  // ===== 新建术语 =====
  const handleCreateTerm = useCallback(async () => {
    try {
      const values = await termForm.validateFields();
      await createTerm.mutateAsync(values);
      message.success('术语已添加');
      setCreateTermOpen(false);
      termForm.resetFields();
    } catch {
      // 表单验证错误
    }
  }, [termForm, createTerm]);

  // ===== 批量删除 =====
  const handleBatchDelete = useCallback(() => {
    Modal.confirm({
      title: `确定批量删除 ${selectedRowKeys.length} 条术语？`,
      onOk: () => {
        selectedRowKeys.forEach((id) => deleteTerm.mutate(id as string));
        setSelectedRowKeys([]);
        message.success('已删除');
      },
    });
  }, [selectedRowKeys, deleteTerm]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="glass-card p-5">
        {/* 搜索与批量操作 */}
        <div className="flex items-center justify-between mb-4">
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索术语原文或译文..."
            value={termSearch}
            onChange={(e) => {
              setTermSearch(e.target.value);
              setTermPage(1);
            }}
            allowClear
            style={{ width: 280 }}
            className="dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
          />
          <div>
            {selectedRowKeys.length > 0 && (
              <Button danger onClick={handleBatchDelete}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            )}
          </div>
        </div>

        {/* 术语表格 */}
        <Table
          columns={termColumns}
          dataSource={termData?.items || []}
          rowKey="term_id"
          loading={termsLoading}
          size="middle"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          pagination={{
            current: termPage,
            pageSize: 20,
            total: termData?.total || 0,
            onChange: (page) => setTermPage(page),
            showTotal: (total) => `共 ${total} 条术语`,
          }}
          className="[&_.ant-table]:dark:!bg-slate-900 [&_.ant-table-thead>tr>th]:dark:!bg-slate-800 [&_.ant-table-thead>tr>th]:dark:!text-slate-300 [&_.ant-table-tbody>tr>td]:dark:!bg-slate-900 [&_.ant-table-tbody>tr>td]:dark:!text-slate-300 [&_.ant-table-tbody>tr:hover>td]:dark:!bg-slate-800"
          locale={{ emptyText: '暂无术语数据' }}
        />
      </div>

      {/* 顶部操作按钮区 */}
      <div className="flex items-center gap-2 mt-4">
        <Upload
          beforeUpload={(file) => {
            handleImportCSV(file);
            return false;
          }}
          showUploadList={false}
        >
          <Button icon={<UploadOutlined />}>导入CSV</Button>
        </Upload>
        <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
          导出CSV
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateTermOpen(true)}
        >
          添加术语
        </Button>
      </div>

      {/* 添加术语 Modal */}
      <Modal
        title="添加术语"
        open={createTermOpen}
        onOk={handleCreateTerm}
        onCancel={() => {
          setCreateTermOpen(false);
          termForm.resetFields();
        }}
        confirmLoading={createTerm.isPending}
        okText="添加"
        cancelText="取消"
        centered
      >
        <Form form={termForm} layout="vertical" className="mt-4">
          <Form.Item
            name="source_text"
            label="原文"
            rules={[{ required: true, message: '请输入原文' }]}
          >
            <Input placeholder="例如：覇気" />
          </Form.Item>
          <Form.Item
            name="target_text"
            label="译文"
            rules={[{ required: true, message: '请输入译文' }]}
          >
            <Input placeholder="例如：霸气" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="可选备注说明" />
          </Form.Item>
          <Form.Item name="category" label="分类标签">
            <Select placeholder="选择分类" allowClear options={CATEGORY_OPTIONS} />
          </Form.Item>
          <Form.Item name="scope" label="适用范围" initialValue="account">
            <Select options={SCOPE_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
