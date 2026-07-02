'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Modal, message, QRCode } from 'antd';
import { Monitor, Smartphone, X } from 'lucide-react';

interface ContinueOnPCProps {
  /** 触发显示的按钮文本 */
  triggerText?: string;
  /** PC端目标URL */
  targetUrl: string;
  /** 触发按钮额外className */
  className?: string;
}

/** 移动端 -> PC 接续引导组件
 * 在移动端检测到复杂操作时，生成PC端链接和二维码
 */
export const ContinueOnPC: React.FC<ContinueOnPCProps> = ({
  triggerText = '在电脑上继续',
  targetUrl,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const fullUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${targetUrl}`
    : targetUrl;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopySuccess(true);
      message.success('链接已复制');
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(() => {
      message.info(`请手动复制: ${fullUrl}`);
    });
  }, [fullUrl]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={className || 'flex items-center gap-2 px-3 py-2 text-xs text-primary-500 bg-primary-50 dark:bg-primary-900/20 rounded-lg'}
      >
        <Monitor size={14} />
        {triggerText}
      </button>

      <Modal
        title={null}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        closeIcon={<X size={18} className="text-slate-400" />}
        centered
        width={320}
      >
        <div className="flex flex-col items-center py-4">
          <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center mb-4">
            <Monitor size={32} className="text-primary-500" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
            在电脑上继续
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4">
            此操作在手机上可能不方便。使用下方二维码或链接在电脑上继续。
          </p>

          {/* 二维码 */}
          <div className="bg-white p-3 rounded-xl mb-4">
            <QRCode value={fullUrl} size={160} bordered={false} />
          </div>

          {/* 链接复制 */}
          <div className="w-full flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg p-2 mb-3">
            <input
              type="text"
              readOnly
              value={fullUrl}
              className="flex-1 bg-transparent text-xs text-slate-600 dark:text-slate-400 truncate outline-none"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-1 text-xs font-medium bg-primary-500 text-white rounded-md hover:bg-primary-600 transition-colors"
            >
              {copySuccess ? '已复制' : '复制'}
            </button>
          </div>

          <p className="text-xs text-slate-400 text-center">
            扫码或复制链接在电脑浏览器中打开
          </p>
        </div>
      </Modal>
    </>
  );
};
