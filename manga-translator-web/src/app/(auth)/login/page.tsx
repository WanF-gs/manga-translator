'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Form, Input, Button, Checkbox, Alert } from 'antd';
import { MailOutlined, LockOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { Languages, Sparkles } from 'lucide-react';
import { authApi } from '@/services/auth';
import { useAuthStore } from '@/stores/authStore';
import { setAuthCookie } from '@/lib/authCookie';

interface LoginFormValues {
  account: string;
  password: string;
  remember?: boolean;
}

export default function LoginPage() {
  const router = useRouter();
  const loginStore = useAuthStore((s) => s.login);
  const [form] = Form.useForm<LoginFormValues>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  const onFinish = async (values: LoginFormValues) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setLoading(true);

    try {
      const res = await authApi.login({
        account: values.account.trim(),
        password: values.password,
        remember_me: !!values.remember,
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

      const maxAge = values.remember ? 7 * 24 * 60 * 60 : 24 * 60 * 60;
      setAuthCookie(access_token, maxAge);

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

      // 登录成功后立即预热常用路由，减少首次点击等待
      ['/pc', '/pc/upload', '/pc/fonts', '/pc/settings'].forEach((r) => router.prefetch(r));

      const redirect = new URLSearchParams(window.location.search).get('redirect') || '/pc';
      setTimeout(() => router.push(redirect), 0);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '登录失败，请重试';
      setError(msg);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="w-full max-w-md mx-4 animate-slide-up">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 via-blue-500 to-violet-500 mb-5 shadow-lg shadow-primary-500/25 group-hover:shadow-xl group-hover:shadow-primary-500/35 transition-shadow">
          <Sparkles size={28} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">欢迎回来</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
          登录你的 Manga Translator 账号
        </p>
      </div>

      <div className="glass-panel p-6 sm:p-8 relative overflow-hidden">
        {/* 顶部渐变装饰条 */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary-400/60 to-transparent" />
        
        {error && (
          <Alert type="error" message={error} showIcon className="mb-5 rounded-xl" />
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
            name="account"
            label={<span className="text-slate-700 dark:text-slate-300 font-semibold text-[13px]">邮箱或手机号</span>}
            rules={[{ required: true, message: '请输入邮箱或手机号' }]}
          >
            <Input
              prefix={<MailOutlined className="text-slate-400" />}
              placeholder="邮箱或手机号"
              size="large"
              autoComplete="username"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={<span className="text-slate-700 dark:text-slate-300 font-semibold text-[13px]">密码</span>}
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少需要6个字符' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-slate-400" />}
              placeholder="输入密码"
              size="large"
              autoComplete="current-password"
            />
          </Form.Item>

          <div className="flex items-center justify-between mb-3">
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>记住我</Checkbox>
            </Form.Item>
            <Link
              href="/login?forgot=1"
              className="text-sm text-primary-600 hover:text-primary-500 dark:text-primary-400 font-medium transition-colors"
            >
              忘记密码？
            </Link>
          </div>

          <Form.Item className="mb-0 mt-4">
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
              登录
            </Button>
          </Form.Item>
        </Form>

        <div className="mt-6 text-center">
          <span className="text-sm text-slate-500 dark:text-slate-400">还没有账号？</span>
          <Link
            href="/register"
            className="text-sm text-primary-600 hover:text-primary-500 dark:text-primary-400 font-semibold ml-1 transition-colors"
          >
            立即注册
          </Link>
        </div>
      </div>

      <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-8">
        登录即表示同意{' '}
        <a href="#" className="underline hover:text-slate-600 dark:hover:text-slate-400 transition-colors">服务条款</a>
        {' '}和{' '}
        <a href="#" className="underline hover:text-slate-600 dark:hover:text-slate-400 transition-colors">隐私政策</a>
      </p>
    </div>
  );
}
