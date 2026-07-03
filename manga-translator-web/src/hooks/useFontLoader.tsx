/**
 * v3.0: 编辑器字体加载 Hook + Context
 * 
 * 对标 BalloonsTranslator 所见即所得：用户在 PropertyPanel 选字体 → Canvas 文字即时切换
 * 
 * 实现原理：
 * 1. 从字体列表 (fontApi.getList) 获取 font_family → file_url 映射
 * 2. 懒加载：只加载 Canvas 上当前可见区域的字体文件（避免一次加载 80MB 字体）
 * 3. FontFace 加载后注册到 document.fonts，CSS fontFamily 即可使用
 * 4. 已加载字体缓存，切换区域不重复下载
 */

'use client';

import React, { createContext, useContext, useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { fontApi, type FontData } from '@/services/font';
import { useQuery } from '@tanstack/react-query';

interface FontEntry {
  fontId: string;
  family: string;       // 字体族名（用于 CSS fontFamily）
  url: string;          // /api/v1/fonts/file/xxx
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

interface FontLoaderState {
  /** 字体列表原始数据 */
  fontList: FontData[];
  /** family → FontEntry 映射 */
  fontMap: Map<string, FontEntry>;
  /** 按 font_family 获取 CSS fontFamily 字符串（自动触发加载） */
  getFontFamily: (fontFamily?: string, fontId?: string) => string | undefined;
  /** 是否仍在加载字体列表 */
  loading: boolean;
  /** 预加载一组字体 */
  preloadFonts: (families: string[]) => void;
  /** P2: 项目级别全局默认字体 */
  defaultFontId: string | null;
  defaultFontFamily: string | null;
  setDefaultFont: (fontId: string | null, family: string | null) => void;
}

const FontLoaderContext = createContext<FontLoaderState | null>(null);

export function useFontLoaderContext() {
  const ctx = useContext(FontLoaderContext);
  if (!ctx) throw new Error('useFontLoaderContext must be used within FontLoaderProvider');
  return ctx;
}

export function FontLoaderProvider({ children }: { children: React.ReactNode }) {
  const fontMapRef = useRef<Map<string, FontEntry>>(new Map());
  const [, forceUpdate] = useState(0);

  // P2: 全局默认字体 — 从 localStorage 恢复，新区域自动继承
  const [defaultFontId, setDefaultFontId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('manga_default_font_id') || null;
  });
  const [defaultFontFamily, setDefaultFontFamily] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('manga_default_font_family') || null;
  });

  const setDefaultFont = useCallback((fontId: string | null, family: string | null) => {
    setDefaultFontId(fontId);
    setDefaultFontFamily(family);
    if (typeof window !== 'undefined') {
      if (fontId) localStorage.setItem('manga_default_font_id', fontId);
      else localStorage.removeItem('manga_default_font_id');
      if (family) localStorage.setItem('manga_default_font_family', family);
      else localStorage.removeItem('manga_default_font_family');
    }
  }, []);

  // 获取字体列表
  const { data: fontList, isLoading } = useQuery({
    queryKey: ['fonts', 'editor-loader'],
    queryFn: async () => {
      const res = await fontApi.getList({ is_active: true, page_size: 100 });
      return (res.data?.data?.items || []) as FontData[];
    },
    staleTime: 120_000,
    retry: 1,
  });

  // 构建 fontMap
  useEffect(() => {
    if (!fontList) return;
    const map = fontMapRef.current;
    for (const f of fontList) {
      const existing = map.get(f.name);
      if (existing && existing.url === f.file_url) continue;
      map.set(f.name, {
        fontId: f.font_id,
        family: f.name,
        url: f.file_url,
        loaded: false,
        loading: false,
        error: null,
      });
    }
    forceUpdate((n) => n + 1);
  }, [fontList]);

    // 加载单个字体文件（URL 中文件名含空格需 encodeURIComponent）
    const loadFont = useCallback((entry: FontEntry) => {
        if (entry.loaded || entry.loading) return;
        entry.loading = true;
        forceUpdate((n) => n + 1);

        const encodedUrl = entry.url.replace(/[^/]+$/, (name) => encodeURIComponent(name));
        const fontFace = new FontFace(entry.family, `url(${encodedUrl})`);
        fontFace.load().then((f) => {
            document.fonts.add(f);
            entry.loaded = true;
            entry.loading = false;
            forceUpdate((n) => n + 1);
        }).catch((err) => {
            entry.error = String(err);
            entry.loading = false;
            forceUpdate((n) => n + 1);
        });
    }, []);

  // 根据 font_family 或 font_id 查找并触发加载
  const getFontFamily = useCallback(
    (fontFamily?: string, fontId?: string): string | undefined => {
      const map = fontMapRef.current;
      let entry: FontEntry | undefined;

      // 优先 font_id 查找
      if (fontId) {
        for (const e of map.values()) {
          if (e.fontId === fontId) { entry = e; break; }
        }
      }

      // 其次 font_family 精确匹配
      if (!entry && fontFamily) {
        entry = map.get(fontFamily);
      }

      // 再次：font_family 模糊匹配（如 "内置漫画对话体" 匹配 "系统默认对话字体"）
      if (!entry && fontFamily && map.has('系统默认对话字体')) {
        entry = map.get('系统默认对话字体');
      }

      if (!entry) return undefined;

      // 触发懒加载
      if (!entry.loaded && !entry.loading) {
        loadFont(entry);
      }

      // 返回 CSS fontFamily 引用值: 即字体的 name
      return entry.family;
    },
    [loadFont]
  );

  // 预加载多个字体
  const preloadFonts = useCallback(
    (families: string[]) => {
      const map = fontMapRef.current;
      for (const fam of families) {
        const entry = map.get(fam);
        if (entry && !entry.loaded && !entry.loading) {
          loadFont(entry);
        }
      }
    },
    [loadFont]
  );

  const value = useMemo(
    () => ({
      fontList: fontList || [],
      fontMap: fontMapRef.current,
      getFontFamily,
      loading: isLoading,
      preloadFonts,
      defaultFontId,
      defaultFontFamily,
      setDefaultFont,
    }),
    [fontList, getFontFamily, isLoading, preloadFonts, defaultFontId, defaultFontFamily, setDefaultFont]
  );

  return (
    <FontLoaderContext.Provider value={value}>
      {children}
    </FontLoaderContext.Provider>
  );
}
