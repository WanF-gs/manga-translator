'use client';

import React from 'react';
import { Alert, Button } from 'antd';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 全局错误边界 — 修复 UX-R00-TXT-001（控制台错误用户不可见）
 * 捕获渲染错误并以友好方式展示
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
              <AlertTriangle size={32} className="text-amber-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              页面渲染出错
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              {this.state.error?.message || '发生了未知错误，请尝试刷新页面'}
            </p>
            <Alert
              type="error"
              showIcon
              message="错误详情"
              description={this.state.error?.message || '未知错误'}
              className="mb-4 text-left"
            />
            <Button
              type="primary"
              icon={<RefreshCw size={16} />}
              onClick={this.handleRetry}
            >
              重试
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
