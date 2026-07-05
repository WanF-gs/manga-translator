'use client';

import React, { useState, useMemo } from 'react';
import { Modal, Form, Input, InputNumber, App, Popconfirm, Button, Space } from 'antd';
import { AlertCircle } from 'lucide-react';
import { Key, Plus, Trash2, Copy, Shield, EyeOff } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiKeyApi, type ApiKeyData } from '@/services/api-keys';
import CodeBlock from '@/components/CodeBlock';

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

  return (
    <div className="h-full overflow-y-auto">
      {/* 顶部操作栏 - 使用玻璃态效果 */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 dark:shadow-amber-500/10">
                  <Key size={22} className="text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  API 密钥管理
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  创建和管理 API 密钥，对接外部工具和自动化工作流
                </p>
              </div>
            </div>
            <button
              onClick={() => setCreateOpen(true)}
              disabled={isLoading}
              className="btn-primary text-sm py-2.5 px-5"
            >
              <Plus size={16} />
              创建 API Key
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* 后端不可用提示 */}
        {isError && (
          <div className="glass-card p-4 mb-6 border-amber-200/50 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-900/10">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex-shrink-0">
                <AlertCircle size={18} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100 mb-1">后端服务未连接</h4>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {(queryError as any)?.message || '无法连接到服务器，请确认后端服务已启动。创建和管理 API Key 功能暂时不可用。'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* API 使用指南 - 使用玻璃态卡片 */}
        <div className="glass-card overflow-hidden">
          <div className="p-5 border-b border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Shield size={20} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  API 使用指南
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  快速接入外部 API
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              在请求头中携带 <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">X-API-Key: msk_xxx</code> 或 <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">Authorization: Bearer msk_xxx</code> 进行鉴权。
              基础 URL：<code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">http://localhost:8080/api/v1/external</code>（部署后替换为实际域名）。
            </p>

            <div className="space-y-3">
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
                <div key={ep.path} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 hover:border-primary-300 dark:hover:border-primary-600 transition-colors duration-300">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold">{ep.method}</span>
                    <code className="text-xs text-slate-600 dark:text-slate-300">{`/api/v1/external${ep.path}`}</code>
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{ep.name}</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{ep.desc}</p>
                  <CodeBlock language="bash" title={`${ep.method} ${ep.path}`}>
{`curl -X ${ep.method} http://localhost:8080/api/v1/external${ep.path} \\\n  -H "X-API-Key: msk_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${ep.body}'`}
                  </CodeBlock>
                </div>
              ))}
            </div>

            <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-900/10 dark:to-indigo-900/10 border border-blue-200/50 dark:border-blue-800/30">
              <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
                统一响应格式
              </p>
              <CodeBlock language="json" title="Response Format">
{`{
  "code": 0,
  "message": "success",
  "data": {
    // 业务数据
  }
}`}
              </CodeBlock>
            </div>
          </div>
        </div>

        {/* API Key 列表 - 使用自定义样式 */}
        <div className="glass-card overflow-hidden">
          <div className="p-5 border-b border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <Key size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    密钥列表
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {Array.isArray(keys) ? `共 ${keys.length} 个密钥` : '加载中...'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4 p-4">
                    <div className="skeleton w-10 h-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-4 w-1/3 rounded-lg" />
                      <div className="skeleton h-3 w-1/2 rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !Array.isArray(keys) || keys.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Key size={28} className="text-slate-400 dark:text-slate-500" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                  {isError ? `加载失败: ${(queryError as any)?.message || '后端不可用'}` : '暂无 API Key，点击右上角创建'}
                </p>
                {!isError && (
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="btn-primary inline-flex px-5 py-2.5 text-sm"
                  >
                    <Plus size={16} />
                    创建 API Key
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {keys.map((key: ApiKeyData, index: number) => (
                  <div
                    key={key.api_key_id}
                    className="group flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all duration-300"
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300">
                        <Key size={18} className="text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {key.name}
                          </h4>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            key.is_active
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {key.is_active ? '启用' : '禁用'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-xs">{key.key_prefix}...</code>
                          <span>·</span>
                          <span>{key.rate_limit}/min</span>
                          <span>·</span>
                          <span>调用 {key.total_calls?.toLocaleString() || 0} 次</span>
                          <span>·</span>
                          <span>最后使用 {formatTime(key.last_used_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <Popconfirm
                        title="确认禁用该 API Key？禁用后将拒绝所有请求"
                        onConfirm={() => deleteMutation.mutate(key.api_key_id)}
                      >
                        <button className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
                          <Trash2 size={16} />
                        </button>
                      </Popconfirm>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-500" />
              使用方式
            </p>
            <CodeBlock language="bash" title="cURL Example">
{`curl -H "Authorization: Bearer ${newKey || 'msk_YOUR_KEY'}" \\\n  -H "Content-Type: application/json" \\\n  -X GET "http://localhost:8080/api/v1/projects"`}
            </CodeBlock>
          </div>
        </div>
      </Modal>
    </div>
  );
}
