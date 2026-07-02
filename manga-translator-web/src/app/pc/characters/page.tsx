'use client';

import React, { useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, App, Popconfirm, Space, Card, Slider, Descriptions, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  Users, Plus, Trash2, Edit3, Sparkles, Wand2,
  Volume2, Type, UserPlus, Smile, Zap, Heart, Star,
  Moon, Coffee, Ghost, Feather, CloudLightning
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { characterApi, type CharacterData, type ToneType } from '@/services/character';

const TONE_OPTIONS: { value: ToneType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'tsundere', label: '傲娇', icon: <Smile size={14} />, color: '#f59e0b' },
  { value: 'hotblooded', label: '热血', icon: <Zap size={14} />, color: '#ef4444' },
  { value: 'calm', label: '冷静', icon: <Moon size={14} />, color: '#3b82f6' },
  { value: 'cold', label: '冷酷', icon: <Ghost size={14} />, color: '#6366f1' },
  { value: 'loli', label: '萝莉', icon: <Heart size={14} />, color: '#ec4899' },
  { value: 'genki', label: '元气', icon: <Star size={14} />, color: '#10b981' },
  { value: 'lazy', label: '慵懒', icon: <Coffee size={14} />, color: '#8b5cf6' },
  { value: 'chuunibyou', label: '中二', icon: <Wand2 size={14} />, color: '#f97316' },
  { value: 'natural', label: '天然', icon: <Feather size={14} />, color: '#06b6d4' },
  { value: 'bellyblack', label: '腹黑', icon: <CloudLightning size={14} />, color: '#7c3aed' },
  { value: 'custom', label: '自定义', icon: <Edit3 size={14} />, color: '#94a3b8' },
];

const TONE_COLORS: Record<string, string> = Object.fromEntries(
  TONE_OPTIONS.map((t) => [t.value, t.color])
);

const GENDER_OPTIONS = [
  { value: 'male', label: '♂ 男' },
  { value: 'female', label: '♀ 女' },
  { value: 'unknown', label: '未知' },
];

export default function CharactersPage() {
  const { message } = App.useApp();
  const params = useParams();
  const queryClient = useQueryClient();
  const projectId = (params?.id as string) || '';
  const [modalOpen, setModalOpen] = useState(false);
  const [editingChar, setEditingChar] = useState<CharacterData | null>(null);
  const [autoText, setAutoText] = useState('');
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [form] = Form.useForm();

  const { data: characters, isLoading } = useQuery({
    queryKey: ['characters', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const res = await characterApi.getList(projectId);
      return (res.data?.data || []) as CharacterData[];
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      if (editingChar) {
        return characterApi.update(editingChar.character_id, values);
      }
      return characterApi.create(projectId, values as any);
    },
    onSuccess: () => {
      message.success(editingChar ? '角色已更新' : '角色已创建');
      setModalOpen(false);
      setEditingChar(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['characters', projectId] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (charId: string) => characterApi.delete(charId),
    onSuccess: () => {
      message.success('角色已删除');
      queryClient.invalidateQueries({ queryKey: ['characters', projectId] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const handleAutoDetect = async () => {
    if (!autoText.trim()) {
      message.warning('请输入角色台词样例');
      return;
    }
    setAutoDetecting(true);
    try {
      const res = await characterApi.autoDetect({ text_sample: autoText });
      const result = res.data?.data;
      if (result) {
        form.setFieldsValue({ tone_type: result.suggested_tone });
        message.success(`检测到语气：${TONE_OPTIONS.find(t => t.value === result.suggested_tone)?.label} (置信度: ${(result.confidence * 100).toFixed(0)}%)`);
      }
    } catch (err: any) {
      message.error(err.message || '检测失败');
    } finally {
      setAutoDetecting(false);
    }
  };

  const handleEdit = (char: CharacterData) => {
    setEditingChar(char);
    const vals: any = { ...char };
    // Spread custom_tone_params into flat form fields for sliders
    if (char.custom_tone_params) {
      vals.formality = char.custom_tone_params.formality ?? 50;
      vals.emotion = char.custom_tone_params.emotion ?? 50;
      vals.sentence_length = char.custom_tone_params.sentence_length ?? 3;
    }
    form.setFieldsValue(vals);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditingChar(null);
    form.resetFields();
    form.setFieldsValue({ tone_type: 'natural', honorific_level: 3, gender: 'unknown', formality: 50, emotion: 50, sentence_length: 3 });
    setModalOpen(true);
  };

  const toneType = Form.useWatch('tone_type', form);

  const handleSave = () => {
    form.validateFields().then((values) => {
      // Build custom_tone_params when tone_type is 'custom'
      if (values.tone_type === 'custom') {
        values.custom_tone_params = {
          formality: values.formality ?? 50,
          emotion: values.emotion ?? 50,
          sentence_length: values.sentence_length ?? 3,
        };
      } else {
        values.custom_tone_params = undefined;
      }
      // Cleanup slider-only fields before submitting
      delete values.formality;
      delete values.emotion;
      delete values.sentence_length;
      saveMutation.mutate(values);
    });
  };

  const columns: ColumnsType<CharacterData> = [
    {
      title: '角色',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
            style={{ backgroundColor: TONE_COLORS[record.tone_type] || '#94a3b8' }}
          >
            {name?.charAt(0) || '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">{name}</p>
            {record.catchphrase && (
              <p className="text-xs text-slate-400 italic">"{record.catchphrase}"</p>
            )}
          </div>
        </div>
      ),
    },
    {
      title: '语气类型',
      dataIndex: 'tone_type',
      key: 'tone_type',
      width: 130,
      render: (tone: ToneType) => {
        const opt = TONE_OPTIONS.find((t) => t.value === tone);
        return (
          <Tag color={TONE_COLORS[tone]} icon={opt?.icon}>
            {opt?.label || tone}
          </Tag>
        );
      },
    },
    {
      title: '性别',
      dataIndex: 'gender',
      key: 'gender',
      width: 70,
      render: (g: string) => (
        <span className="text-xs">
          {g === 'male' ? '♂' : g === 'female' ? '♀' : '--'}
        </span>
      ),
    },
    {
      title: '敬语等级',
      dataIndex: 'honorific_level',
      key: 'honorific_level',
      width: 100,
      render: (level: number) => (
        <span className="text-xs">
          {'⭐'.repeat(level)}{'☆'.repeat(5 - level)}
        </span>
      ),
    },
    {
      title: '特性',
      key: 'features',
      width: 180,
      render: (_: unknown, record: CharacterData) => (
        <Space size={4} wrap>
          {record.voice_id && <Tag color="purple"><Volume2 size={10} /> 配音</Tag>}
          {record.font_id && <Tag color="blue"><Type size={10} /> 字体</Tag>}
          {record.visual_features && <Tag color="cyan"><Star size={10} /> 视觉</Tag>}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: CharacterData) => (
        <Space>
          <Button type="text" size="small" icon={<Edit3 size={14} />} onClick={() => handleEdit(record)} />
          <Popconfirm
            title="确认删除该角色？"
            onConfirm={() => deleteMutation.mutate(record.character_id)}
          >
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-pink-50 dark:bg-pink-900/30 flex items-center justify-center">
              <Users size={22} className="text-pink-600 dark:text-pink-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">角色管理</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                管理作品角色，配置语气类型，AI 自动识别角色性格
              </p>
            </div>
          </div>
          <Button
            type="primary"
            icon={<UserPlus size={16} />}
            onClick={handleCreate}
          >
            添加角色
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <Card className="mb-6" size="small">
          <div className="flex items-center gap-3">
            <Input.TextArea
              placeholder="输入角色的典型台词样例，AI 将自动分析角色语气...&#10;如：'哼，我才不是特地来帮你的呢！'"
              value={autoText}
              onChange={(e) => setAutoText(e.target.value)}
              rows={2}
              className="flex-1"
            />
            <Button
              type="dashed"
              icon={<Sparkles size={14} />}
              onClick={handleAutoDetect}
              loading={autoDetecting}
            >
              AI 检测语气
            </Button>
          </div>
        </Card>

        <Table
          columns={columns}
          dataSource={characters || []}
          rowKey="character_id"
          loading={isLoading}
          pagination={false}
          locale={{ emptyText: '暂无角色，点击右上角添加第一个角色' }}
          expandable={{
            expandedRowRender: (record) => (
              <Descriptions size="small" column={2} bordered className="mt-2">
                {record.custom_tone_params && Object.keys(record.custom_tone_params).length > 0 && (
                  <Descriptions.Item label="自定义语气参数">
                    {JSON.stringify(record.custom_tone_params)}
                  </Descriptions.Item>
                )}
                {record.visual_features && (
                  <Descriptions.Item label="视觉特征">{record.visual_features}</Descriptions.Item>
                )}
                <Descriptions.Item label="创建时间">{new Date(record.created_at).toLocaleString('zh-CN')}</Descriptions.Item>
              </Descriptions>
            ),
          }}
        />
      </div>

      {/* 创建/编辑弹窗 */}
      <Modal
        title={editingChar ? '编辑角色' : '添加角色'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditingChar(null); form.resetFields(); }}
        onOk={handleSave}
        confirmLoading={saveMutation.isPending}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item name="name" label="角色名称" rules={[{ required: true }]}>
            <Input placeholder="如：桐谷和人、坂田银时" />
          </Form.Item>
          <Form.Item name="tone_type" label="语气类型" rules={[{ required: true }]}>
            <Select
              options={TONE_OPTIONS.map((t) => ({
                value: t.value,
                label: (
                  <span className="flex items-center gap-2">
                    <span style={{ color: t.color }}>{t.icon}</span>
                    {t.label}
                  </span>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item name="catchphrase" label="口头禅">
            <Input placeholder="如：烦死了烦死了" />
          </Form.Item>
          <div className="flex gap-4">
            <Form.Item name="gender" label="性别" className="flex-1">
              <Select options={GENDER_OPTIONS} />
            </Form.Item>
            <Form.Item name="honorific_level" label="敬语等级" className="flex-1">
              <Slider min={1} max={5} marks={{ 1: '低', 3: '中', 5: '高' }} />
            </Form.Item>
          </div>
          {/* §2.13 Custom tone sliders — only show when tone_type is 'custom' */}
          {toneType === 'custom' && (
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4 mb-4 border border-slate-200 dark:border-slate-700">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">自定义语气参数</p>
              <Form.Item name="formality" label="正式程度" className="mb-2">
                <Slider min={0} max={100} marks={{ 0: '口语', 50: '中性', 100: '正式' }} />
              </Form.Item>
              <Form.Item name="emotion" label="情感强度" className="mb-2">
                <Slider min={0} max={100} marks={{ 0: '平淡', 50: '适中', 100: '强烈' }} />
              </Form.Item>
              <Form.Item name="sentence_length" label="句子长度偏好">
                <Slider min={1} max={5} marks={{ 1: '短', 3: '中', 5: '长' }} step={1} />
              </Form.Item>
            </div>
          )}
          <Form.Item name="visual_features" label="视觉特征">
            <Input placeholder="如：黑色长发、眼镜、制服" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
