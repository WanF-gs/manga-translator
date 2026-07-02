'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Button, Progress, message } from 'antd';
import { Upload, Image, FileWarning, X, Camera, Loader2 } from 'lucide-react';
import clsx from 'clsx';

export interface UploadedImage {
  /** 本地预览 URL */
  previewUrl: string;
  /** 原始文件对象 */
  file: File;
  /** 上传后服务端返回的 ID（可选） */
  remoteId?: string;
  /** 上传进度 0-100 */
  progress: number;
  /** 上传状态 */
  status: 'pending' | 'uploading' | 'done' | 'error';
  /** 错误信息 */
  error?: string;
}

interface ImageUploaderProps {
  /** 已上传图片列表 */
  images: UploadedImage[];
  /** 图片列表变化回调 */
  onImagesChange: (images: UploadedImage[]) => void;
  /** 多选最大数量 */
  maxCount?: number;
  /** 接受的文件类型 */
  accept?: string;
  /** 单文件最大大小 (MB) */
  maxSizeMB?: number;
  /** 是否显示拍照按钮（移动端） */
  showCamera?: boolean;
  /** 是否显示拖拽区域 */
  showDropZone?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 每张图片的上传回调，返回服务端 ID (可选) */
  onUpload?: (file: File) => Promise<string | void>;
  /** 自定义类名 */
  className?: string;
  /** PC端还是移动端 */
  device?: 'pc' | 'mobile';
}

const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'];
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'];

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  images,
  onImagesChange,
  maxCount = 50,
  accept = 'image/*',
  maxSizeMB = 50,
  showCamera = true,
  showDropZone = true,
  disabled = false,
  onUpload,
  className,
  device = 'pc',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // ===== 文件校验 =====
  const validateFile = useCallback(
    (file: File): string | null => {
      if (!SUPPORTED_FORMATS.includes(file.type) && file.type !== '') {
        return `不支持的格式: ${file.name}（支持 ${SUPPORTED_EXTENSIONS.join('、')}）`;
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        return `文件过大: ${file.name}（最大 ${maxSizeMB}MB）`;
      }
      if (images.length >= maxCount) {
        return `已达到最大数量 ${maxCount} 张`;
      }
      // 检查重复
      const dup = images.some((img) => img.file.name === file.name && img.file.size === file.size);
      if (dup) {
        return `文件重复: ${file.name}`;
      }
      return null;
    },
    [images, maxCount, maxSizeMB]
  );

  // ===== 处理文件添加 =====
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (disabled) return;
      const fileArray = Array.from(files);

      const newImages: UploadedImage[] = [];
      for (const file of fileArray) {
        const error = validateFile(file);
        if (error) {
          message.warning(error);
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        const newImg: UploadedImage = {
          previewUrl,
          file,
          progress: 0,
          status: 'pending',
        };
        newImages.push(newImg);
      }

      if (newImages.length === 0) return;

      const updated = [...images, ...newImages];
      onImagesChange(updated);

      // 如果提供了上传回调，则逐个上传
      if (onUpload) {
        for (const img of newImages) {
          updateImageProgress(img, 0, 'uploading');
          try {
            const remoteId = await onUpload(img.file);
            updateImageProgress(img, 100, 'done', remoteId || undefined);
          } catch (err: any) {
            updateImageProgress(img, 0, 'error', undefined, err?.message || '上传失败');
          }
        }
      } else {
        // 无上传回调时模拟进度完成
        for (const img of newImages) {
          updateImageProgress(img, 100, 'done');
        }
      }
    },
    [disabled, validateFile, images, onImagesChange, onUpload]
  );

  const updateImageProgress = (
    img: UploadedImage,
    progress: number,
    status: UploadedImage['status'],
    remoteId?: string,
    error?: string
  ) => {
    onImagesChange(
      images.map((i) =>
        i.previewUrl === img.previewUrl
          ? { ...i, progress, status, remoteId, error }
          : i
      )
    );
  };

  // ===== 事件处理 =====
  const handleClick = () => {
    if (!disabled) fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
    e.target.value = '';
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // ===== 删除图片 =====
  const handleRemove = useCallback(
    (index: number) => {
      const updated = images.filter((_, i) => i !== index);
      // 释放 Blob URL
      URL.revokeObjectURL(images[index]?.previewUrl);
      onImagesChange(updated);
    },
    [images, onImagesChange]
  );

  // ===== 渲染 =====
  const isPC = device === 'pc';
  const canAdd = images.length < maxCount && !disabled;

  return (
    <div className={clsx('space-y-3', className)}>
      {/* 上传区域 */}
      {showDropZone && canAdd && (
        <div
          onClick={handleClick}
          onDrop={handleDrop}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          className={clsx(
            'relative border-2 border-dashed rounded-xl p-6 cursor-pointer transition-all duration-200 text-center',
            isDragging
              ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 scale-[1.02]'
              : 'border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30 hover:border-primary-400 hover:bg-primary-50/30 dark:hover:bg-primary-900/10',
            isPC ? 'min-h-[160px] flex flex-col items-center justify-center gap-3' : 'py-8 px-4'
          )}
        >
          {isDragging ? (
            <>
              <Upload size={isPC ? 40 : 32} className="text-primary-500 animate-bounce" />
              <p className="text-primary-600 font-medium">释放文件以上传</p>
            </>
          ) : (
            <>
              <div
                className={clsx(
                  'rounded-full flex items-center justify-center',
                  isPC ? 'w-16 h-16 bg-primary-50 dark:bg-primary-900/30' : 'w-12 h-12 bg-primary-50 dark:bg-primary-900/30 mx-auto mb-2'
                )}
              >
                <Upload size={isPC ? 28 : 22} className="text-primary-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {isPC ? '拖拽图片到此处，或点击选择' : '点击选择图片'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  支持 JPG、PNG、WebP 格式，单文件最大 {maxSizeMB}MB，最多 {maxCount} 张
                </p>
              </div>
            </>
          )}

      {/* 文件输入（视觉隐藏但保留可访问性） */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple
        onChange={handleFileChange}
        className="sr-only"
        aria-label="选择文件上传"
      />
        </div>
      )}

      {/* 拍照按钮（移动端） */}
      {showCamera && canAdd && device === 'mobile' && (
        <>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            block
            size="large"
            icon={<Camera size={18} />}
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled}
            className="h-12 text-sm"
          >
            拍照上传
          </Button>
        </>
      )}

      {/* 图片预览列表 */}
      {images.length > 0 && (
        <div
          className={clsx(
            'gap-2',
            isPC ? 'grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8' : 'grid grid-cols-3'
          )}
        >
          {images.map((img, index) => (
            <div
              key={img.previewUrl}
              className="relative group aspect-[3/4] rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            >
              <img
                src={img.previewUrl}
                alt={`第${index + 1}张`}
                className={clsx(
                  'w-full h-full object-cover transition-opacity',
                  img.status === 'error' && 'opacity-50'
                )}
              />

              {/* 上传进度遮罩 */}
              {img.status === 'uploading' && (
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                  <Loader2 size={20} className="text-white animate-spin" />
                  <span className="text-white text-xs">{img.progress}%</span>
                </div>
              )}

              {/* 错误遮罩 */}
              {img.status === 'error' && (
                <div className="absolute inset-0 bg-red-500/20 flex flex-col items-center justify-center gap-1">
                  <FileWarning size={20} className="text-red-500" />
                  <span className="text-red-600 text-[10px] text-center px-1 line-clamp-2">
                    {img.error || '失败'}
                  </span>
                </div>
              )}

              {/* 完成标记 */}
              {img.status === 'done' && (
                <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <span className="text-white text-[10px]">✓</span>
                </div>
              )}

              {/* 删除按钮 */}
              {!disabled && (
                <button
                  onClick={() => handleRemove(index)}
                  className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                  title="删除"
                >
                  <X size={12} />
                </button>
              )}

              {/* 序号 */}
              <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/50 text-white text-[10px]">
                {index + 1}
              </div>
            </div>
          ))}

          {/* 继续添加按钮 */}
          {canAdd && showDropZone && (
            <button
              onClick={handleClick}
              disabled={disabled}
              className="aspect-[3/4] rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex flex-col items-center justify-center gap-1 text-slate-400 hover:border-primary-400 hover:text-primary-500 transition-colors bg-slate-50/50 dark:bg-slate-800/30"
            >
              <PlusIcon />
              <span className="text-[10px]">添加更多</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

export default ImageUploader;
