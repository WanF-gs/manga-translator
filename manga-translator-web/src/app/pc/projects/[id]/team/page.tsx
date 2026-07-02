'use client';
/**
 * C13 fix: Standalone team management page (not just an editor panel).
 * Route: /pc/projects/{id}/team
 */
import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Table, Button, Select, Tag, Card, Input, Modal, Space, Descriptions, Empty, Skeleton } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeft, UserPlus, Shield, Users, Trash2, Edit3, Eye, EyeOff, CheckCircle2, Settings, Clock,
} from 'lucide-react';
import { projectApi } from '@/services/project';
import { collaborationApi } from '@/services/collaboration';
import type { ProjectData } from '@/types';

interface MemberData {
  member_id: string;
  user_id: string;
  user_name: string;
  role: string;
  permissions: string[];
  joined_at: string | null;
}

const ROLES = ['viewer', 'reviewer', 'translator', 'editor', 'owner'] as const;
const ROLE_LABELS: Record<string, string> = {
  owner: '创建者', editor: '编辑者', translator: '翻译者', reviewer: '校对者', viewer: '查看者',
};
const ROLE_COLORS: Record<string, string> = {
  owner: 'gold', editor: 'blue', translator: 'green', reviewer: 'purple', viewer: 'default',
};
const ROLE_ICONS: Record<string, React.ReactNode> = {
  owner: <Shield size={12} />,
  editor: <Edit3 size={12} />,
  translator: <CheckCircle2 size={12} />,
  reviewer: <Eye size={12} />,
  viewer: <EyeOff size={12} />,
};

export default function TeamPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const projectId = params.id!;

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newMemberId, setNewMemberId] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<string>('viewer');

  // Load project info
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const res = await projectApi.get(projectId);
      return (res.data as any)?.data as ProjectData;
    },
  });

  // Load members
  const { data: membersData, isLoading, refetch } = useQuery({
    queryKey: ['team', 'members', projectId],
    queryFn: async () => {
      try {
        const res = await collaborationApi.getMembers(projectId);
        return (res.data as any)?.data?.members || [] as MemberData[];
      } catch {
        // Fallback: show owner as sole member
        return [{
          member_id: 'owner', user_id: 'current', user_name: '项目创建者',
          role: 'owner', permissions: ['all'], joined_at: project?.created_at || null,
        }] as MemberData[];
      }
    },
    enabled: true,
  });

  const members = membersData || [];

  // Add member
  const addMutation = useMutation({
    mutationFn: (data: { user_id: string; role: string }) =>
      collaborationApi.addMember(projectId, data),
    onSuccess: () => {
      message.success('成员已添加');
      queryClient.invalidateQueries({ queryKey: ['team', 'members', projectId] });
      setAddModalOpen(false);
      setNewMemberId('');
      setNewMemberRole('viewer');
    },
    onError: (e: Error) => message.error(e.message || '添加失败'),
  });

  // Update role
  const updateRoleMutation = useMutation({
    mutationFn: (data: { user_id: string; role: string }) =>
      collaborationApi.updateMemberRole(projectId, data.user_id, data.role),
    onSuccess: () => {
      message.success('角色已更新');
      queryClient.invalidateQueries({ queryKey: ['team', 'members', projectId] });
    },
    onError: (e: Error) => message.error(e.message || '更新失败'),
  });

  // Remove member
  const removeMutation = useMutation({
    mutationFn: (userId: string) => collaborationApi.removeMember(projectId, userId),
    onSuccess: () => {
      message.success('成员已移除');
      queryClient.invalidateQueries({ queryKey: ['team', 'members', projectId] });
    },
    onError: (e: Error) => message.error(e.message || '移除失败'),
  });

  const columns: ColumnsType<MemberData> = [
    {
      title: '成员', dataIndex: 'user_name', key: 'user_name', width: 160,
      render: (name: string, record: MemberData) => (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
            <span className="text-xs font-medium text-primary-600">{name?.charAt(0) || '?'}</span>
          </div>
          <div>
            <p className="text-sm font-medium">{name || record.user_id?.slice(0, 8)}</p>
            <p className="text-[10px] text-slate-400">{record.user_id?.slice(0, 12)}...</p>
          </div>
        </div>
      ),
    },
    {
      title: '角色', dataIndex: 'role', key: 'role', width: 200,
      render: (role: string, record: MemberData) => (
        <Space>
          {role === 'owner' ? (
            <Tag color={ROLE_COLORS[role]} className="flex items-center gap-1">
              {ROLE_ICONS[role]} {ROLE_LABELS[role]}
            </Tag>
          ) : (
            <Select size="small" value={role} style={{ width: 110 }}
              onChange={(newRole: string) => updateRoleMutation.mutate({ user_id: record.user_id, role: newRole })}
              options={ROLES.filter(r => r !== 'owner').map(r => ({ value: r, label: ROLE_LABELS[r] }))}
            />
          )}
        </Space>
      ),
    },
    {
      title: '权限', dataIndex: 'permissions', key: 'permissions',
      render: (permissions: string[]) => (
        <Space size={2} wrap>
          {permissions?.map(p => <Tag key={p} className="text-[10px] px-1.5 py-0">{p}</Tag>)}
        </Space>
      ),
    },
    {
      title: '加入时间', dataIndex: 'joined_at', key: 'joined_at', width: 150,
      render: (d: string) => d ? (
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <Clock size={10} /> {new Date(d).toLocaleDateString('zh-CN')}
        </span>
      ) : <span className="text-xs text-slate-400">-</span>,
    },
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, record: MemberData) =>
        record.role !== 'owner' ? (
          <Button size="small" danger type="text" icon={<Trash2 size={14} />}
            onClick={() => removeMutation.mutate(record.user_id)}
            loading={removeMutation.isPending} />
        ) : null,
    },
  ];

  if (isLoading) {
    return <div className="max-w-4xl mx-auto p-6"><Skeleton active paragraph={{ rows: 6 }} /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/pc/projects/${projectId}`}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <ArrowLeft size={18} className="text-slate-500" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Users size={18} className="text-primary-500" />
              团队管理
            </h1>
            <p className="text-xs text-slate-500">{project?.name || '未命名项目'} · {members.length} 位成员</p>
          </div>
        </div>
        <Button type="primary" icon={<UserPlus size={14} />} onClick={() => setAddModalOpen(true)}>
          添加成员
        </Button>
      </div>

      {/* Member Table */}
      <Card>
        {members.length === 0 ? (
          <Empty description="暂无团队成员" image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Button type="primary" onClick={() => setAddModalOpen(true)}>添加第一位成员</Button>
          </Empty>
        ) : (
          <Table
            columns={columns}
            dataSource={members}
            rowKey="member_id"
            pagination={false}
            size="middle"
          />
        )}
      </Card>

      {/* Roles Legend */}
      <Card className="mt-4" size="small" title={<span className="text-sm font-medium flex items-center gap-2"><Settings size={14} /> 角色说明</span>}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(ROLE_LABELS).map(([role, label]) => (
            <div key={role} className="flex items-start gap-2">
              <Tag color={ROLE_COLORS[role]} className="mt-0.5">{ROLE_ICONS[role]} {label}</Tag>
              <span className="text-xs text-slate-400">
                {role === 'owner' && '完全控制权限'}
                {role === 'editor' && '编辑、翻译、校对'}
                {role === 'translator' && '翻译文字内容'}
                {role === 'reviewer' && '校对翻译结果'}
                {role === 'viewer' && '仅查看，不可编辑'}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Add Member Modal */}
      <Modal
        title="添加团队成员"
        open={addModalOpen}
        onOk={() => addMutation.mutate({ user_id: newMemberId, role: newMemberRole })}
        onCancel={() => setAddModalOpen(false)}
        confirmLoading={addMutation.isPending}
        okText="添加"
        cancelText="取消"
      >
        <div className="space-y-4 mt-4">
          <div>
            <label className="text-sm font-medium block mb-1">用户 ID</label>
            <Input placeholder="输入用户ID" value={newMemberId}
              onChange={e => setNewMemberId(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">角色</label>
            <Select value={newMemberRole} onChange={setNewMemberRole} className="w-full"
              options={ROLES.filter(r => r !== 'owner').map(r => ({ value: r, label: ROLE_LABELS[r] }))} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
