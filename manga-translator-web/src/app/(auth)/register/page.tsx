'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Form, Input, Button, Checkbox, Alert } from 'antd';
import {
  MailOutlined,
  LockOutlined,
  UserOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { Languages, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { authApi } from '@/services/auth';
import { useAuthStore } from '@/stores/authStore';
import { setAuthCookie } from '@/lib/authCookie';

interface RegisterFormValues {
  email: string;
  nickname: string;
  password: string;
  confirmPassword: string;
  agreeTerms?: boolean;
}

function getPasswordStrength(password: string) {
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: '弱', color: 'text-red-500 bg-red-500' };
  if (score <= 3) return { score, label: '中等', color: 'text-yellow-500 bg-yellow-500' };
  return { score, label: '强', color: 'text-green-500 bg-green-500' };
}

export default function RegisterPage() {
  const router = useRouter();
  const loginStore = useAuthStore.getState().login;
  const [form] = Form.useForm<RegisterFormValues>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const password = Form.useWatch('password', form) || '';
  const passwordStrength = password ? getPasswordStrength(password) : null;

  const onFinish = async (values: RegisterFormValues) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setLoading(true);

    try {
      const res = await authApi.register({
        email: values.email.trim(),
        password: values.password,
        nickname: values.nickname.trim(),
      });

      const { user, tokens } = res.data.data;
      const { access_token, refresh_token } = tokens;
      loginStore(access_token, refresh_token, {
        user_id: user.user_id,
        email: user.email,
        nickname: user.nickname,
        avatar_url: user.avatar_url,
        plan_type: user.plan_type,
        created_at: new Date().toISOString(),
      });

      setAuthCookie(access_token);

      try {
        const existing = JSON.parse(localStorage.getItem('manga-auth') || '{}');
        localStorage.setItem('manga-auth', JSON.stringify({
          ...existing,
          state: {
            ...(existing.state || {}),
            accessToken: access_token,
            refreshToken: refresh_token,
            user: {
              user_id: user.user_id,
              email: user.email,
              nickname: user.nickname,
              avatar_url: user.avatar_url,
              plan_type: user.plan_type,
              created_at: new Date().toISOString(),
            },
          },
          version: existing.version || 0,
        }));
      } catch { /* ignore */ }

      requestAnimationFrame(() => {
        ['/pc', '/pc/upload', '/pc/fonts'].forEach((r) => router.prefetch(r));
      });

      setTimeout(() => router.push('/pc'), 0);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '注册失败，请重试';
      setError(msg);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="w-full max-w-md mx-4 py-8 animate-slide-up">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 via-primary-600 to-violet-600 mb-5 shadow-xl shadow-primary-500/30">
          <Sparkles size={28} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">创建账号</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
          开始你的漫画翻译之旅
        </p>
      </div>

      <div className="glass-panel p-6 sm:p-8">
        {error && (
          <Alert type="error" message={error} showIcon className="mb-5 rounded-lg" />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          requiredMark
          validateTrigger={['onSubmit', 'onBlur']}
          autoComplete="off"
        >
          <Form.Item
            name="email"
            label={<span className="text-slate-700 dark:text-slate-300 font-medium">邮箱地址</span>}
            rules={[
              { required: true, message: '请输入邮箱地址' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input
              prefix={<MailOutlined className="text-slate-400" />}
              placeholder="your@email.com"
              size="large"
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item
            name="nickname"
            label={<span className="text-slate-700 dark:text-slate-300 font-medium">昵称</span>}
            rules={[
              { required: true, message: '请输入昵称' },
              { min: 2, message: '昵称至少需要2个字符' },
            ]}
          >
            <Input
              prefix={<UserOutlined className="text-slate-400" />}
              placeholder="你的昵称"
              size="large"
              autoComplete="name"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={<span className="text-slate-700 dark:text-slate-300 font-medium">密码</span>}
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少需要6个字符' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-slate-400" />}
              placeholder="至少6个字符"
              size="large"
              autoComplete="new-password"
            />
          </Form.Item>

          {passwordStrength && (
            <div className="mb-4 -mt-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={clsx('h-full rounded-full transition-all duration-500 ease-out', passwordStrength.color)}
                    style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                  />
                </div>
                <span className={clsx('text-xs font-semibold', passwordStrength.color)}>
                  {passwordStrength.label}
                </span>
              </div>
            </div>
          )}

          <Form.Item
            name="confirmPassword"
            label={<span className="text-slate-700 dark:text-slate-300 font-medium">确认密码</span>}
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次密码输入不一致'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-slate-400" />}
              placeholder="再次输入密码"
              size="large"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item
            name="agreeTerms"
            valuePropName="checked"
            rules={[
              {
                validator: (_, value) =>
                  value ? Promise.resolve() : Promise.reject(new Error('请同意服务条款和隐私政策')),
              },
            ]}
          >
            <Checkbox>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                我已阅读并同意{' '}
                <a href="#" className="text-primary-600 hover:underline">服务条款</a>
                {' '}和{' '}
                <a href="#" className="text-primary-600 hover:underline">隐私政策</a>
              </span>
            </Checkbox>
          </Form.Item>

          <Form.Item className="mb-0">
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              disabled={loading}
              block
              size="large"
              icon={<ArrowRightOutlined />}
              iconPosition="end"
              className="!rounded-xl !h-11 !font-semibold !shadow-md !shadow-primary-500/25 hover:!shadow-lg hover:!shadow-primary-500/30"
            >
              创建账号
            </Button>
          </Form.Item>
        </Form>

        <div className="mt-6 text-center">
          <span className="text-sm text-slate-500 dark:text-slate-400">已有账号？</span>
          <Link
            href="/login"
            className="text-sm text-primary-600 hover:text-primary-500 dark:text-primary-400 font-semibold ml-1 transition-colors"
          >
            立即登录
          </Link>
        </div>
      </div>
    </div>
  );
}
