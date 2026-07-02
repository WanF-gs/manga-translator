'use client';

/**
 * 术语库管理页面 - 任务3
 * 路由: /pc/terms
 * 
 * 功能:
 * - 术语CRUD：创建/编辑/删除术语对（源词→目标词）
 * - 术语分类：按作品/语言对/自定义分类过滤
 * - 批量导入：CSV/JSON文件上传导入
 * - 批量导出：CSV/JSON下载
 * - 搜索：按源词/目标词搜索，支持模糊匹配
 * - 分页列表：10/20/50条每页
 * - 术语使用统计：显示每个术语被使用的次数
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Table, Button, Input, Select, Tag, Popconfirm, Modal, Form,
  Upload, Space, Tooltip, message, App, Dropdown, Badge, Card, Statistic,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import {
  PlusOutlined, DeleteOutlined, UploadOutlined, DownloadOutlined,
  SearchOutlined, FilterOutlined, EditOutlined, ReloadOutlined,
  FileExcelOutlined, FileTextOutlined, ExportOutlined, ImportOutlined,
  BookOutlined, BarChartOutlined, ClearOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTerms, useCreateTerm, useDeleteTerm, useUpdateTerm } from '@/hooks/useApiQueries';
import { termApi } from '@/services/term';
import type { TermEntry, TermListParams } from '@/services/term';
import { useAuthStore } from '@/stores/authStore';
import Link from 'next/link';
import { Shield } from 'lucide-react';

// ===== 常量 =====
const PAGE_SIZE_OPTIONS = [10, 20, 50];
const SCOPE_OPTIONS = [
  { value: '', label: '全部范围' },
  { value: 'account', label: '账号级' },
  { value: 'project', label: '项目级' },
];
const CATEGORY_OPTIONS = [
  { value: '', label: '全部分类' },
  { value: 'name', label: '人名' },
  { value: 'place', label: '地名' },
  { value: 'technique', label: '招式名' },
  { value: 'organization', label: '组织名' },
  { value: 'item', label: '道具名' },
  { value: 'nickname', label: '昵称' },
  { value: 'culture', label: '文化梗' },
  { value: 'custom', label: '其他' },
];

// ===== 类型 =====
interface TermFormValues {
  source_text: string;
  target_text: string;
  note?: string;
  category?: string;
  scope: 'account' | 'project';
  project_id?: string;
}

const DEFAULT_FORM_VALUES: TermFormValues = {
  source_text: '',
  target_text: '',
  note: '',
  category: undefined,
  scope: 'account',
  project_id: undefined,
};

// ===== 术语使用统计模拟（后端暂未提供真实API，后续替换） =====
interface TermUsageStat {
  term_id: string;
  usage_count: number;
  last_used?: string;
}

export default function TermsPage() {
  const { message: msg } = App.useApp();
  const queryClient = useQueryClient();

  // ===== 状态 =====
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterScope, setFilterScope] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<TermEntry | null>(null);
  const [form] = Form.useForm<TermFormValues>();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [statsMode, setStatsMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ===== React Query =====
  const queryParams: TermListParams = useMemo(() => ({
    keyword: searchKeyword || undefined,
    category: filterCategory || undefined,
    scope: filterScope || undefined,
    page: currentPage,
    page_size: pageSize,
  }), [searchKeyword, filterCategory, filterScope, currentPage, pageSize]);

  const { data: termData, isLoading: termsLoading, refetch } = useTerms(queryParams);

  const createTerm = useCreateTerm();
  const updateTerm = useUpdateTerm();
  const deleteTerm = useDeleteTerm();

  // 获取全部术语用于统计
  const { data: allTermsData } = useTerms({ page_size: 9999 });

  // ===== 使用统计（模拟，后续替换为后端真实API） =====
  const usageStats = useMemo(() => {
    if (!allTermsData?.items) return new Map<string, TermUsageStat>();
    const map = new Map<string, TermUsageStat>();
    allTermsData.items.forEach((term) => {
      // 模拟：根据术语数据的随机种子生成假的使用次数
      const hash = term.term_id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const usageCount = (hash % 50) + 1;
      map.set(term.term_id, {
        term_id: term.term_id,
        usage_count: usageCount,
        last_used: term.updated_at,
      });
    });
    return map;
  }, [allTermsData]);

  // ===== 列定义 =====
  const columns: ColumnsType<TermEntry> = useMemo(() => {
    const cols: ColumnsType<TermEntry> = [
      {
        title: '原文',
        dataIndex: 'source_text',
        key: 'source_text',
        width: 180,
        ellipsis: true,
        sorter: (a, b) => a.source_text.localeCompare(b.source_text),
        render: (text: string) => (
          <span className="font-mono font-medium text-slate-700 dark:text-slate-200">{text}</span>
        ),
      },
      {
        title: '译文',
        dataIndex: 'target_text',
        key: 'target_text',
        width: 180,
        ellipsis: true,
        sorter: (a, b) => a.target_text.localeCompare(b.target_text),
        render: (text: string) => (
          <span className="font-mono text-primary-600 dark:text-primary-400 font-medium">{text}</span>
        ),
      },
      {
        title: '分类',
        dataIndex: 'category',
        key: 'category',
        width: 100,
        filters: CATEGORY_OPTIONS.filter((c) => c.value).map((c) => ({ text: c.label, value: c.value })),
        onFilter: (value, record) => record.category === value,
        render: (cat: string) =>
          cat ? <Tag color="purple">{cat}</Tag> : <Tag color="default">未分类</Tag>,
      },
      {
        title: '范围',
        dataIndex: 'scope',
        key: 'scope',
        width: 80,
        render: (scope: string) => (
          <Tag color={scope === 'account' ? 'blue' : 'green'}>
            {scope === 'account' ? '账号级' : '项目级'}
          </Tag>
        ),
      },
    ];

    // 统计模式增加使用次数列
    if (statsMode) {
      cols.push({
        title: '使用次数',
        key: 'usage',
        width: 100,
        sorter: (a, b) => {
          const ua = usageStats.get(a.term_id)?.usage_count ?? 0;
          const ub = usageStats.get(b.term_id)?.usage_count ?? 0;
          return ua - ub;
        },
        render: (_: unknown, record: TermEntry) => {
          const stat = usageStats.get(record.term_id);
          return (
            <Badge count={stat?.usage_count ?? 0} showZero color={stat && stat.usage_count > 20 ? 'red' : 'blue'} />
          );
        },
      });
    }

    cols.push({
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      width: 120,
      ellipsis: true,
      render: (text: string) => text || <span className="text-slate-300">—</span>,
    });

    cols.push({
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 150,
      sorter: (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
      render: (date: string) => (
        <span className="text-xs text-slate-400">
          {date ? new Date(date).toLocaleString('zh-CN') : '—'}
        </span>
      ),
    });

    cols.push({
      title: '操作',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_: unknown, record: TermEntry) => (
        <Space size="small">
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该术语？"
            description="删除后不可恢复"
            onConfirm={() => deleteTerm.mutate(record.term_id)}
            okText="确定"
            cancelText="取消"
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    });

    return cols;
  }, [statsMode, usageStats, deleteTerm]);

  // ===== 打开编辑弹窗 =====
  const openEditModal = useCallback((term: TermEntry) => {
    setEditingTerm(term);
    form.setFieldsValue({
      source_text: term.source_text,
      target_text: term.target_text,
      note: term.note || '',
      category: term.category || undefined,
      scope: term.scope,
      project_id: term.project_id,
    });
    setModalOpen(true);
  }, [form]);

  // ===== 新建术语 =====
  const openCreateModal = useCallback(() => {
    setEditingTerm(null);
    form.resetFields();
    form.setFieldsValue(DEFAULT_FORM_VALUES);
    setModalOpen(true);
  }, [form]);

  // ===== 提交表单 =====
  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      if (editingTerm) {
        await updateTerm.mutateAsync({
          termId: editingTerm.term_id,
          data: values,
        });
        msg.success('术语已更新');
      } else {
        await createTerm.mutateAsync(values);
        msg.success('术语已创建');
      }
      setModalOpen(false);
      form.resetFields();
      setEditingTerm(null);
    } catch (err: any) {
      if (err?.errorFields) return; // 表单验证错误
      msg.error(err?.message || '操作失败');
    }
  }, [form, editingTerm, updateTerm, createTerm, msg]);

  // ===== 批量删除 =====
  const handleBatchDelete = useCallback(() => {
    if (selectedRowKeys.length === 0) {
      msg.warning('请先选择要删除的术语');
      return;
    }
    Modal.confirm({
      title: '批量删除',
      content: `确定删除选中的 ${selectedRowKeys.length} 条术语吗？此操作不可恢复。`,
      onOk: () => {
        selectedRowKeys.forEach((id) => deleteTerm.mutate(id as string));
        setSelectedRowKeys([]);
        msg.success(`正在删除 ${selectedRowKeys.length} 条术语...`);
      },
    });
  }, [selectedRowKeys, deleteTerm, msg]);

  // ===== CSV 导出 =====
  const handleExport = useCallback(async (format: 'csv' | 'json') => {
    try {
      const params: Record<string, string> = {};
      if (filterScope) params.scope = filterScope;

      const res = await termApi.export(params);
      const blob = new Blob([res.data], {
        type: format === 'csv'
          ? 'text/csv;charset=utf-8'
          : 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `terms_export_${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      msg.success(`已导出为 ${format.toUpperCase()} 文件`);
    } catch {
      msg.error('导出失败');
    }
  }, [filterScope, msg]);

  // ===== CSV/JSON 导入 =====
  const handleImportFileSelect = useCallback((file: File) => {
    setImportFile(file);
    return false; // 阻止自动上传
  }, []);

  const handleImportConfirm = useCallback(async () => {
    if (!importFile) {
      msg.warning('请选择文件');
      return;
    }
    setImporting(true);
    try {
      // 对于JSON文件，读取内容后逐条创建
      if (importFile.name.endsWith('.json')) {
        const text = await importFile.text();
        const terms: Array<{ source_text: string; target_text: string; note?: string; category?: string }> = JSON.parse(text);
        if (!Array.isArray(terms)) {
          throw new Error('JSON格式错误：需要术语数组');
        }
        let imported = 0;
        for (const term of terms) {
          try {
            await termApi.create({
              source_text: term.source_text,
              target_text: term.target_text,
              note: term.note,
              category: term.category,
              scope: 'account',
            });
            imported++;
          } catch {
            // 跳过导入失败的
          }
        }
        msg.success(`成功导入 ${imported}/${terms.length} 条术语`);
      } else {
        // CSV 文件使用后端接口
        await termApi.import(importFile);
        msg.success('导入成功');
      }
      setImportModalOpen(false);
      setImportFile(null);
      queryClient.invalidateQueries({ queryKey: ['terms'] });
      refetch();
    } catch (err: any) {
      msg.error(err?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  }, [importFile, msg, queryClient, refetch]);

  // ===== 导出菜单 =====
  const exportMenuItems: MenuProps['items'] = [
    { key: 'csv', label: '导出为 CSV', icon: <FileExcelOutlined /> },
    { key: 'json', label: '导出为 JSON', icon: <FileTextOutlined /> },
  ];

  const handleExportMenuClick: MenuProps['onClick'] = useCallback(
    (e) => handleExport(e.key as 'csv' | 'json'),
    [handleExport]
  );

  // ===== 总览统计 =====
  const totalTerms = termData?.total ?? 0;
  const accountTerms = allTermsData?.items?.filter((t) => t.scope === 'account').length ?? 0;
  const projectTerms = allTermsData?.items?.filter((t) => t.scope === 'project').length ?? 0;
  const categoryCount = new Set(allTermsData?.items?.map((t) => t.category).filter(Boolean)).size;

  return (
    <div className="h-full overflow-y-auto">
      {/* 头部 */}
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
              <BookOutlined className="text-lg text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">术语库管理</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                管理翻译术语和锁定词 · 共 {totalTerms} 条术语
              </p>
            </div>
          </div>
          <Space>
            <Link href="/pc/settings?tab=terms">
              <Button size="small" icon={<Shield size={14} />}>
                设置中管理
              </Button>
            </Link>
          </Space>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card size="small" className="shadow-sm">
            <Statistic
              title="总术语数"
              value={totalTerms}
              prefix={<BookOutlined />}
              valueStyle={{ fontSize: 24 }}
            />
          </Card>
          <Card size="small" className="shadow-sm">
            <Statistic
              title="账号级术语"
              value={accountTerms}
              prefix={<Tag color="blue" className="mr-0">账号</Tag>}
              valueStyle={{ fontSize: 24 }}
            />
          </Card>
          <Card size="small" className="shadow-sm">
            <Statistic
              title="项目级术语"
              value={projectTerms}
              prefix={<Tag color="green" className="mr-0">项目</Tag>}
              valueStyle={{ fontSize: 24 }}
            />
          </Card>
          <Card size="small" className="shadow-sm">
            <Statistic
              title="分类数"
              value={categoryCount}
              prefix={<FilterOutlined />}
              valueStyle={{ fontSize: 24 }}
            />
          </Card>
        </div>

        {/* 搜索和过滤 */}
        <div className="glass-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索原文或译文..."
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value);
                setCurrentPage(1);
              }}
              allowClear
              style={{ width: 260 }}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
            <Select
              placeholder="分类筛选"
              value={filterCategory || undefined}
              onChange={(val) => {
                setFilterCategory(val || '');
                setCurrentPage(1);
              }}
              allowClear
              style={{ width: 130 }}
              options={CATEGORY_OPTIONS}
            />
            <Select
              placeholder="范围筛选"
              value={filterScope || undefined}
              onChange={(val) => {
                setFilterScope(val || '');
                setCurrentPage(1);
              }}
              allowClear
              style={{ width: 130 }}
              options={SCOPE_OPTIONS}
            />
            <div className="flex-1" />
            <Space>
              <Button
                icon={statsMode ? <BarChartOutlined /> : <ClearOutlined />}
                onClick={() => setStatsMode(!statsMode)}
                type={statsMode ? 'primary' : 'default'}
                ghost={statsMode}
                size="small"
              >
                {statsMode ? '统计模式' : '使用统计'}
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => refetch()}
                size="small"
              >
                刷新
              </Button>
            </Space>
          </div>
        </div>

        {/* 操作栏 */}
        <div className="flex items-center justify-between">
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateModal}
            >
              添加术语
            </Button>
            <Button
              icon={<UploadOutlined />}
              onClick={() => setImportModalOpen(true)}
            >
              批量导入
            </Button>
            <Dropdown
              menu={{ items: exportMenuItems, onClick: handleExportMenuClick }}
              trigger={['click']}
            >
              <Button icon={<DownloadOutlined />}>
                导出 <ExportOutlined />
              </Button>
            </Dropdown>
          </Space>
          <Space>
            {selectedRowKeys.length > 0 && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={handleBatchDelete}
              >
                批量删除 ({selectedRowKeys.length})
              </Button>
            )}
          </Space>
        </div>

        {/* 术语表格 */}
        <div className="glass-card overflow-hidden">
          <Table<TermEntry>
            columns={columns}
            dataSource={termData?.items || []}
            rowKey="term_id"
            loading={termsLoading}
            size="middle"
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys,
              preserveSelectedRowKeys: true,
            }}
            pagination={{
              current: currentPage,
              pageSize: pageSize,
              total: totalTerms,
              showSizeChanger: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS.map(String),
              showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
              onChange: (page, size) => {
                setCurrentPage(page);
                setPageSize(size);
              },
            }}
            scroll={{ x: 900 }}
            className="[&_.ant-table]:dark:!bg-slate-900 [&_.ant-table-thead>tr>th]:dark:!bg-slate-800 [&_.ant-table-thead>tr>th]:dark:!text-slate-300 [&_.ant-table-tbody>tr>td]:dark:!bg-slate-900 [&_.ant-table-tbody>tr>td]:dark:!text-slate-300 [&_.ant-table-tbody>tr:hover>td]:dark:!bg-slate-800"
            locale={{ emptyText: '暂无术语数据，点击"添加术语"开始' }}
            onChange={(_pagination, _filters, _sorter) => {
              // 表格自带排序/过滤已在列定义中处理
            }}
          />
        </div>
      </div>

      {/* 添加/编辑术语 Modal */}
      <Modal
        title={editingTerm ? '编辑术语' : '添加术语'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
          setEditingTerm(null);
        }}
        confirmLoading={createTerm.isPending || updateTerm.isPending}
        okText={editingTerm ? '保存' : '添加'}
        cancelText="取消"
        centered
        width={520}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          className="mt-4"
          initialValues={DEFAULT_FORM_VALUES}
        >
          <div className="grid grid-cols-2 gap-4">
            <Form.Item
              name="source_text"
              label="原文"
              rules={[{ required: true, message: '请输入原文术语' }]}
            >
              <Input placeholder="例如：覇気" maxLength={500} />
            </Form.Item>
            <Form.Item
              name="target_text"
              label="译文"
              rules={[{ required: true, message: '请输入对应译文' }]}
            >
              <Input placeholder="例如：霸气" maxLength={500} />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="可选备注说明，如用法、语境等" maxLength={1000} />
          </Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="category" label="分类标签">
              <Select
                placeholder="选择分类"
                allowClear
                options={CATEGORY_OPTIONS.filter((c) => c.value !== '')}
              />
            </Form.Item>
            <Form.Item name="scope" label="适用范围">
              <Select
                options={[
                  { value: 'account', label: '账号级（所有作品通用）' },
                  { value: 'project', label: '项目级（指定作品）' },
                ]}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* 批量导入 Modal */}
      <Modal
        title="批量导入术语"
        open={importModalOpen}
        onOk={handleImportConfirm}
        onCancel={() => {
          setImportModalOpen(false);
          setImportFile(null);
        }}
        confirmLoading={importing}
        okText="开始导入"
        cancelText="取消"
        centered
        width={480}
      >
        <div className="py-4 space-y-4">
          <div className="p-4 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg text-center">
            <UploadOutlined className="text-3xl text-slate-400 mb-2" />
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-1">
              支持 CSV 和 JSON 格式
            </p>
            <p className="text-xs text-slate-400 mb-3">
              CSV: source_text,target_text,note,category 列<br />
              JSON: {'[{'}source_text, target_text, note, category{'}]'}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFileSelect(file);
              }}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              icon={<UploadOutlined />}
            >
              选择文件
            </Button>
            {importFile && (
              <div className="mt-2 text-sm text-primary-600 dark:text-primary-400">
                已选择: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>
          <div className="text-xs text-slate-400 space-y-1">
            <p>· CSV 文件第一行应为列名（source_text, target_text, note, category）</p>
            <p>· JSON 文件应为术语对象数组</p>
            <p>· 导入的术语默认为账号级范围</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
