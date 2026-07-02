/**
 * 类名合并工具
 * 使用 clsx + tailwind-merge 避免样式冲突
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
