'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Upload, message } from 'antd';
import type { UploadFile, RcFile } from 'antd/es/upload/interface';
import { Upload as UploadIcon, FileImage, X, Check } from 'lucide-react';
import clsx from 'clsx';

interface FileDropZoneProps {
  /** 文件选中回调 */
  onFiles: (files: File[]) => void;
  /** 允许的文件类型（MIME） */
  accept?: string;
  /** 单文件最大大小（字节），默认 50MB */
  maxSize?: number;
  /** 最大文件数，默认 undefined=不限制 */
  maxCount?: number;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否支持多选 */
  multiple?: boolean;
  /** 已选文件列表（受控模式） */
  fileList?: UploadFile[];
  /** 文件列表变更 */
  onFileListChange?: (files: UploadFile[]) => void;
}

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024; // 50MB

/** 拖拽文件上传区域 */
export const FileDropZone: React.FC<FileDropZoneProps> = ({
  onFiles,
  accept = 'image/*',
  maxSize = DEFAULT_MAX_SIZE,
  maxCount,
  disabled = false,
  multiple = false,
  fileList: externalFileList,
  onFileListChange,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [internalFileList, setInternalFileList] = useState<UploadFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileList = externalFileList ?? internalFileList;
  const setFileList = onFileListChange ?? setInternalFileList;

  const validateFile = useCallback(
    (file: File): string | null => {
      // 检查类型
      if (accept !== '*/*' && accept !== '*') {
        const acceptTypes = accept.split(',').map((t) => t.trim());
        const isAccepted = acceptTypes.some((type) => {
          if (type.endsWith('/*')) {
            return file.type.startsWith(type.replace('/*', '/'));
          }
          return file.type === type || file.name.endsWith(type.replace('.', ''));
        });
        if (!isAccepted) {
          return `不支持的文件类型: ${file.name}`;
        }
      }
      // 检查大小
      if (file.size > maxSize) {
        const sizeMB = (maxSize / 1024 / 1024).toFixed(0);
        return `文件大小不能超过 ${sizeMB}MB: ${file.name}`;
      }
      return null;
    },
    [accept, maxSize]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (disabled) return;

      const validFiles: File[] = [];
      const newUploadFiles: UploadFile[] = [];

      for (const file of files) {
        const error = validateFile(file);
        if (error) {
          message.warning(error);
          continue;
        }
        validFiles.push(file);

        const uploadFile: UploadFile = {
          uid: `${Date.now()}-${Math.random()}`,
          name: file.name,
          size: file.size,
          type: file.type,
          originFileObj: file as RcFile,
          status: 'done',
          percent: 100,
        };
        newUploadFiles.push(uploadFile);
      }

      if (validFiles.length > 0) {
        const updatedList = multiple
          ? [...fileList, ...newUploadFiles].slice(0, maxCount ?? Infinity)
          : newUploadFiles.slice(0, maxCount ?? Infinity);
        setFileList(updatedList);
        onFiles(updatedList.map((f) => f.originFileObj as File));
      }
    },
    [disabled, fileList, maxCount, multiple, onFiles, setFileList, validateFile]
  );

  const removeFile = useCallback(
    (uid: string) => {
      const updated = fileList.filter((f) => f.uid !== uid);
      setFileList(updated);
      onFiles(updated.map((f) => f.originFileObj as File));
    },
    [fileList, onFiles, setFileList]
  );

  // 拖拽事件
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  };

  // 点击选择
  const handleClick = () => {
    if (!disabled) fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) addFiles(files);
    // 清空 input 以允许重新选择相同文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="w-full">
      {/* 拖拽区域 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={clsx(
          'border-2 border-dashed rounded-xl p-8 transition-all duration-200 cursor-pointer',
          'flex flex-col items-center justify-center gap-3',
          isDragOver && !disabled
            ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 scale-[1.02]'
            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-primary-300 dark:hover:border-primary-600',
          disabled && 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-slate-900/50'
        )}
      >
        <div
          className={clsx(
            'w-14 h-14 rounded-2xl flex items-center justify-center transition-colors',
            isDragOver
              ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-500'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
          )}
        >
          {isDragOver ? <UploadIcon size={26} /> : <FileImage size={26} />}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {isDragOver ? '释放以上传文件' : '拖拽文件到此处或点击选择'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            支持 {accept.replace('image/', '').replace(',', '、')} 格式，最大 {formatFileSize(maxSize)}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileInputChange}
          className="sr-only"
          aria-label="选择文件上传"
          disabled={disabled}
        />
      </div>

      {/* 文件列表 */}
      {fileList.length > 0 && (
        <div className="mt-3 space-y-2">
          {fileList.map((file) => (
            <div
              key={file.uid}
              className="flex items-center gap-3 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <FileImage size={16} className="text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 dark:text-slate-300 truncate">
                  {file.name}
                </p>
                {file.size && (
                  <p className="text-xs text-slate-400">{formatFileSize(file.size)}</p>
                )}
              </div>
              <Check size={14} className="text-green-500 flex-shrink-0" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(file.uid);
                }}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
