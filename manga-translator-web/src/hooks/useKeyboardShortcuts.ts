'use client';

/**
 * 通用键盘快捷键 Hook
 * 支持注册/注销快捷键，供编辑器、阅读器等页面复用
 */
import { useEffect, useCallback, useRef } from 'react';

export interface ShortcutBinding {
  /** 按键组合描述，如 'ctrl+s', 'ctrl+z', 'delete', 'ArrowLeft' */
  key: string;
  /** 是否同时需要 ctrl/meta 键 */
  ctrl?: boolean;
  /** 是否同时需要 shift 键 */
  shift?: boolean;
  /** 是否同时需要 alt 键 */
  alt?: boolean;
  /** 快捷键处理函数 */
  handler: (e: KeyboardEvent) => void;
  /** 是否阻止默认行为 */
  preventDefault?: boolean;
  /** 描述（用于快捷键帮助提示） */
  description?: string;
}

interface UseKeyboardShortcutsOptions {
  /** 快捷键绑定列表 */
  shortcuts: ShortcutBinding[];
  /** 是否启用快捷键（默认 true） */
  enabled?: boolean;
  /** 忽略的 target 标签（默认不响应这些元素内的按键） */
  ignoreTags?: string[];
}

const DEFAULT_IGNORE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

/**
 * 解析按键字符串为规范化格式
 */
function normalizeKey(key: string): {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
} {
  const parts = key.toLowerCase().split('+');
  const result = { code: '', ctrl: false, shift: false, alt: false };

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === 'ctrl' || trimmed === 'meta' || trimmed === 'cmd') {
      result.ctrl = true;
    } else if (trimmed === 'shift') {
      result.shift = true;
    } else if (trimmed === 'alt') {
      result.alt = true;
    } else {
      result.code = trimmed;
    }
  }

  return result;
}

/**
 * 检查事件是否匹配指定按键
 */
function eventMatches(
  e: KeyboardEvent,
  binding: ShortcutBinding,
  ignoreTags: string[]
): boolean {
  // 忽略输入框内的按键
  const target = e.target as HTMLElement;
  if (target && ignoreTags.includes(target.tagName)) return false;
  if (target && target.isContentEditable) return false;

  const normalized = normalizeKey(binding.key);

  // 检查修饰键
  const ctrlPressed = e.ctrlKey || e.metaKey;
  if (normalized.ctrl !== (binding.ctrl ?? ctrlPressed)) return false;
  if (normalized.shift !== (binding.shift ?? e.shiftKey)) return false;
  if (normalized.alt !== (binding.alt ?? e.altKey)) return false;

  // 如果没有在 binding 中显式指定，使用规范化结果
  if (binding.ctrl != null && normalized.ctrl !== binding.ctrl) return false;

  // 检查实际按键
  const keyCode = e.key.toLowerCase();
  const codeCode = e.code?.toLowerCase() || '';

  return (
    keyCode === normalized.code ||
    codeCode === normalized.code ||
    codeCode === `key${normalized.code}` ||
    codeCode === `digit${normalized.code}`
  );
}

export function useKeyboardShortcuts({
  shortcuts,
  enabled = true,
  ignoreTags = DEFAULT_IGNORE_TAGS,
}: UseKeyboardShortcutsOptions) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      for (const binding of shortcutsRef.current) {
        if (eventMatches(e, binding, ignoreTags)) {
          if (binding.preventDefault !== false) {
            e.preventDefault();
            e.stopPropagation();
          }
          binding.handler(e);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, ignoreTags]);

  /** 获取所有快捷键的描述列表（用于帮助面板） */
  const getShortcutDescriptions = useCallback(() => {
    return shortcuts
      .filter((s) => s.description)
      .map((s) => ({
        key: s.key,
        description: s.description!,
      }));
  }, [shortcuts]);

  return { getShortcutDescriptions };
}
