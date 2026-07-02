'use client';

import React from 'react';
import { Modal } from 'antd';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  /** 是否显示 */
  open: boolean;
  /** 标题 */
  title: string;
  /** 内容 */
  content: React.ReactNode;
  /** 确认按钮文本 */
  confirmText?: string;
  /** 取消按钮文本 */
  cancelText?: string;
  /** 是否为危险操作（确认按钮变红） */
  danger?: boolean;
  /** 确认回调 */
  onConfirm: () => void | Promise<void>;
  /** 取消回调 */
  onCancel?: () => void;
  /** 是否处于加载中 */
  confirmLoading?: boolean;
}

/** 通用确认弹窗（基于 Ant Design Modal） */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  content,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
  confirmLoading = false,
}) => {
  return (
    <Modal
      open={open}
      title={
        <div className="flex items-center gap-2">
          {danger && <AlertTriangle size={18} className="text-red-500" />}
          <span>{title}</span>
        </div>
      }
      onOk={onConfirm}
      onCancel={onCancel}
      okText={confirmText}
      cancelText={cancelText}
      okButtonProps={{
        danger,
        loading: confirmLoading,
      }}
      centered
      destroyOnHidden
      width={420}
    >
      <div className="text-sm text-slate-600 dark:text-slate-400 mt-2">
        {content}
      </div>
    </Modal>
  );
};
