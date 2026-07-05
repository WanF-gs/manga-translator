'use client';

import React, { useState, useMemo } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vs2015 as darkTheme, vs as lightTheme } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { Copy, Check } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';

interface CodeBlockProps {
  language?: string;
  children: string;
  showLineNumbers?: boolean;
  title?: string;
  className?: string;
}

export default function CodeBlock({
  language = 'bash',
  children,
  showLineNumbers = false,
  title,
  className = '',
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resolvedTheme = useThemeStore((state) => state.resolved);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = children;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 判断是否为深色主题
  const isDark = resolvedTheme === 'dark';

  // 自定义主题样式以匹配项目设计
  const customStyle = useMemo(() => {
    return {
      margin: 0,
      borderRadius: title || language ? '0' : '0.75rem',
      background: isDark ? 'transparent' : 'rgb(248 250 252)',
      padding: '1rem',
      fontSize: '0.8125rem',
    };
  }, [isDark, title, language]);

  return (
    <div className={`group relative rounded-xl overflow-hidden border border-slate-200/60 dark:border-slate-700/50 bg-slate-950 dark:bg-slate-900/95 shadow-lg transition-all duration-300 hover:shadow-xl hover:border-primary-300/50 dark:hover:border-primary-600/40 ${className}`}>
      {/* Header */}
      {(title || language) && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 dark:bg-slate-800/80 border-b border-slate-700/50 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            {/* 模拟窗口控制点 */}
            <div className="flex items-center gap-1.5 mr-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
            </div>
            {title && (
              <span className="text-xs text-slate-400 font-medium">{title}</span>
            )}
          </div>
          {language && (
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-800/80 px-2 py-0.5 rounded-md">
              {language}
            </span>
          )}
        </div>
      )}

      {/* Code Content */}
      <div className="relative">
        <SyntaxHighlighter
          language={language}
          style={isDark ? darkTheme : lightTheme}
          showLineNumbers={showLineNumbers}
          customStyle={customStyle}
          codeTagProps={{
            style: {
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: '0.8125rem',
            },
          }}
        >
          {children}
        </SyntaxHighlighter>

        {/* Copy Button */}
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700/90 text-slate-400 hover:text-white transition-all duration-200 opacity-0 group-hover:opacity-100 backdrop-blur-sm"
          title={copied ? "已复制" : "复制代码"}
          aria-label={copied ? "已复制到剪贴板" : "复制代码到剪贴板"}
        >
          {copied ? (
            <Check size={14} className="text-emerald-400" />
          ) : (
            <Copy size={14} />
          )}
        </button>

        {/* Copied Tooltip */}
        {copied && (
          <div className="absolute top-3 right-12 px-2.5 py-1 rounded-md bg-emerald-500 text-white text-xs font-medium animate-fade-in-up shadow-lg shadow-emerald-500/30">
            已复制!
          </div>
        )}
      </div>
    </div>
  );
}
