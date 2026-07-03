'use client';

import React, { useState, useMemo } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Tag, App, Popconfirm, Space, Card, Typography, Alert, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Key, Plus, Trash2, Copy, Shield, EyeOff } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiKeyApi, type ApiKeyData } from '@/services/api-keys';

const { Text, Paragraph } = Typography;

export default function ApiKeysPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [form] = Form.useForm();

  // P1-B1 fix: add error handling + retry:false to prevent 500 cascade
  const { data: keys, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      try {
        const res = await apiKeyApi.getList();
        return (res?.data?.data?.items || []) as ApiKeyData[];
      } catch {
        return [] as ApiKeyData[];
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (values: { name: string; rate_limit?: number }) =>
      apiKeyApi.create(values),
    onSuccess: (res) => {
      const data = res.data?.data;
      if (data?.api_key) {
        setNewKey(data.api_key);
      }
      message.success('API Key 创建成功');
      setCreateOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || '创建失败，请确认后端服务已启动';
      message.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (keyId: string) => apiKeyApi.delete(keyId),
    onSuccess: () => {
      message.success('API Key 已禁用');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制到剪贴板');
    } catch {
      message.info('请手动复制');
    }
  };

  const formatTime = (d?: string) => d ? new Date(d).toLocaleString('zh-CN') : '从未使用';

  const columns = useMemo<ColumnsType<ApiKeyData>>(() => [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
            <Key size={18} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">{name}</p>
            <code className="text-xs text-slate-400">{record.key_prefix}...</code>
          </div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? '启用' : '禁用'}</Tag>
      ),
    },
    {
      title: '速率限制',
      dataIndex: 'rate_limit',
      key: 'rate_limit',
      width: 100,
      render: (v: number) => `${v}/min`,
    },
    {
      title: '累计调用',
      dataIndex: 'total_calls',
      key: 'total_calls',
      width: 90,
      render: (v: number) => v?.toLocaleString() || '0',
    },
    {
      title: '最后使用',
      dataIndex: 'last_used_at',
      key: 'last_used_at',
      width: 150,
      render: (d: string) => (
        <span className="text-xs text-slate-400">{formatTime(d)}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: ApiKeyData) => (
        <Popconfirm
          title="确认禁用该 API Key？禁用后将拒绝所有请求"
          onConfirm={() => deleteMutation.mutate(record.api_key_id)}
        >
          <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
        </Popconfirm>
      ),
    },
  ], [deleteMutation.mutate]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
              <Key size={22} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">API 密钥管理</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                创建和管理 API 密钥，对接外部工具和自动化工作流
              </p>
            </div>
          </div>
          <Button
            type="primary"
            icon={<Plus size={16} />}
            onClick={() => setCreateOpen(true)}
            loading={isLoading}
            disabled={!isError && !keys?.length ? false : false}
          >
            创建 API Key
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* 后端不可用提示 */}
        {isError && (
          <Alert
            type="warning"
            showIcon
            message="后端服务未连接"
            description={(queryError as any)?.message || '无法连接到服务器，请确认后端服务已启动。创建和管理 API Key 功能暂时不可用。'}
            className="mb-4"
          />
        )}

        {/* API 使用指南 */}
        <Card className="mb-6" title={
          <span className="flex items-center gap-2"><Shield size={16} className="text-primary-500" />API 使用指南</span>
        }>
          <Paragraph className="text-sm text-slate-600 dark:text-slate-400 mb-3">
            在请求头中携带 <Text code>X-API-Key: msk_xxx</Text> 或 <Text code>Authorization: Bearer msk_xxx</Text> 进行鉴权。
            基础 URL：<Text code>http://localhost:8080/api/v1/external</Text>（部署后替换为实际域名）。
          </Paragraph>

          <div className="space-y-4">
            {[
              {
                method: 'POST', path: '/detect', name: '文本区域检测',
                desc: '传入图片 URL 或 Base64，返回文字区域坐标与类型。需要 detect 权限。',
                body: `{\n  "image_url": "https://example.com/page.png",\n  "language": "ja"\n}`,
              },
              {
                method: 'POST', path: '/ocr', name: 'OCR 文字识别',
                desc: '传入图片 URL + 区域坐标列表，返回每个区域识别出的文字与置信度。需要 ocr 权限。',
                body: `{\n  "image_url": "https://example.com/page.png",\n  "regions": [{"bbox": [10, 20, 200, 60], "type": "speech"}],\n  "lang": "ja"\n}`,
              },
              {
                method: 'POST', path: '/translate', name: '文本翻译',
                desc: '传入待翻译文本 + 源语言/目标语言，返回译文。需要 translate 权限。',
                body: `{\n  "text": "こんにちは世界",\n  "source_lang": "ja",\n  "target_lang": "zh-CN"\n}`,
              },
            ].map((ep) => (
              <div key={ep.path} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Tag color="blue">{ep.method}</Tag>
                  <Text code className="text-xs">{`/api/v1/external${ep.path}`}</Text>
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{ep.name}</span>
                </div>
                <Paragraph className="!text-xs text-slate-500 dark:text-slate-400 !mb-2">{ep.desc}</Paragraph>
                <pre className="text-xs bg-slate-950 text-green-400 p-2 rounded overflow-x-auto !mb-0">{`curl -X ${ep.method} http://localhost:8080/api/v1/external${ep.path} \\
  -H "X-API-Key: msk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${ep.body}'`}</pre>
              </div>
            ))}
          </div>

          <Paragraph className="text-xs text-slate-400 mt-3 !mb-0">
            统一响应格式：<Text code>{'{"code":0,"message":"success","data":{...}}'}</Text>
          </Paragraph>
        </Card>

        <Table
          columns={columns}
          dataSource={isError ? [] : (Array.isArray(keys) ? keys : [])}
          rowKey="api_key_id"
          loading={isLoading}
          pagination={false}
          locale={{ emptyText: isError ? `加载失败: ${(queryError as any)?.message || '后端不可用'}` : '暂无 API Key，点击右上角创建' }}
        />
      </div>

      {/* 创建弹窗 */}
      <Modal
        title="创建 API Key"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        onOk={() => form.validateFields().then((v) => createMutation.mutate({
          name: v.name,
          rate_limit: v.rate_limit_per_minute ?? 60,
        }))}
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item name="name" label="密钥名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：自动化流水线、CI/CD集成" prefix={<Key size={14} />} />
          </Form.Item>
          <Form.Item
            name="rate_limit_per_minute"
            label="每分钟速率限制"
            tooltip="限制该密钥每分钟可发起的 API 请求数量"
            initialValue={60}
          >
            {/* P2-B2 fix: addonAfter deprecated → Space.Compact */}
            <Space.Compact style={{ width: '100%' }}>
              <InputNumber min={1} max={600} style={{ width: '100%' }} />
              <Button disabled>请求/分钟</Button>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>

      {/* 新 Key 展示弹窗 */}
      <Modal
        title="API Key 已创建"
        open={!!newKey}
        onCancel={() => setNewKey(null)}
        footer={[
          <Button key="done" type="primary" onClick={() => setNewKey(null)}>
            我已安全保存
          </Button>,
        ]}
        closable={false}
      >
        <div className="py-4 space-y-4">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-1">
              <EyeOff size={14} /> 此密钥仅显示一次，请立即复制保存
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white dark:bg-slate-800 p-2 rounded border break-all">
                {newKey}
              </code>
              <Button
                icon={<Copy size={14} />}
                onClick={() => newKey && copyToClipboard(newKey)}
                size="small"
              />
            </div>
          </div>
          <div className="text-xs text-slate-500 space-y-1">
            <p>使用方式：</p>
            <code className="block bg-slate-100 dark:bg-slate-800 p-2 rounded">
              {`curl -H "Authorization: Bearer ${newKey?.slice(0, 10) || 'msk_'}..." -H "Content-Type: application/json" -X GET "http://localhost:8080/api/v1/projects"`}
            </code>
          </div>
        </div>
      </Modal>
    </div>
  );
}
