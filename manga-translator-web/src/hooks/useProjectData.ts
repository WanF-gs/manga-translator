"use client";

import { useCallback, useMemo, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useProjectDetail,
  useChapters,
  usePages,
  usePageDetail,
} from "./useApiQueries";

/**
 * Unified project data hook - integrates React Query hooks
 * for project data loading. Used by PC Editor page to replace
 * manual useState+useEffect+fetch patterns.
 */
export function useProjectData(projectId: string) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read current chapter/page from URL params
  const currentChapterId = searchParams.get("chapter") || undefined;
  const currentPageId = searchParams.get("page") || undefined;

  // React Query hooks (auto-cached, auto-refetch, staleTime 30s)
  const projectQuery = useProjectDetail(projectId);
  const chaptersQuery = useChapters(projectId);
  const pagesQuery = usePages(currentChapterId || "");
  const pageDetailQuery = usePageDetail(currentPageId || "");

  const project = projectQuery.data;
  const chapters = chaptersQuery.data || [];
  const pages = pagesQuery.data || [];
  const currentPage = pageDetailQuery.data;

  const isLoading = projectQuery.isLoading || chaptersQuery.isLoading;
  const isPageLoading = pagesQuery.isLoading || pageDetailQuery.isLoading;
  const error = projectQuery.error || chaptersQuery.error || pagesQuery.error;

  // Navigation helpers
  const navigateToChapter = useCallback(
    (chapterId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("chapter", chapterId);
      params.delete("page");
      router.push(`?${params.toString()}`);
    },
    [searchParams, router]
  );

  const navigateToPage = useCallback(
    (pageId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", pageId);
      router.push(`?${params.toString()}`);
    },
    [searchParams, router]
  );

  const currentChapter = useMemo(
    () => chapters.find((c: any) => c.chapter_id === currentChapterId),
    [chapters, currentChapterId]
  );

  const pageIndex = useMemo(
    () => pages.findIndex((p: any) => p.page_id === currentPageId),
    [pages, currentPageId]
  );

  const hasNext = pageIndex < pages.length - 1;
  const hasPrev = pageIndex > 0;

  const goNextPage = useCallback(() => {
    if (hasNext) {
      navigateToPage(pages[pageIndex + 1].page_id);
    }
  }, [hasNext, pageIndex, pages, navigateToPage]);

  const goPrevPage = useCallback(() => {
    if (hasPrev) {
      navigateToPage(pages[pageIndex - 1].page_id);
    }
  }, [hasPrev, pageIndex, pages, navigateToPage]);

  // 进入编辑器时自动选中首章，避免 currentPageId 为空导致一键翻译静默失败
  useEffect(() => {
    if (isLoading || currentChapterId || chapters.length === 0) return;
    navigateToChapter(chapters[0].chapter_id);
  }, [isLoading, currentChapterId, chapters, navigateToChapter]);

  // 章节加载后自动选中首页
  useEffect(() => {
    if (!currentChapterId || isPageLoading || currentPageId || pages.length === 0) return;
    navigateToPage(pages[0].page_id);
  }, [currentChapterId, isPageLoading, currentPageId, pages, navigateToPage]);

  // Refetch helpers
  const refetchAll = useCallback(() => {
    projectQuery.refetch();
    chaptersQuery.refetch();
    if (currentChapterId) pagesQuery.refetch();
    if (currentPageId) pageDetailQuery.refetch();
  }, [projectQuery, chaptersQuery, pagesQuery, pageDetailQuery, currentChapterId, currentPageId]);

  return {
    // Data
    project,
    chapters,
    pages,
    currentPage,
    currentChapter,
    currentChapterId,
    currentPageId,

    // Loading states
    isLoading,
    isPageLoading,
    error,

    // Pagination
    pageIndex,
    hasNext,
    hasPrev,
    totalPages: pages.length,

    // Navigation
    navigateToChapter,
    navigateToPage,
    goNextPage,
    goPrevPage,

    // Refetch
    refetchAll,
  };
}

/**
 * Keyboard shortcuts hook - registers/unregisters global key handlers.
 */
export function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Don't fire when focused on input/textarea
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        // Allow Ctrl+S and Escape in inputs
        if (!(e.key === "s" && (e.ctrlKey || e.metaKey)) && e.key !== "Escape") {
          return;
        }
      }

      let key = e.key;
      if (e.ctrlKey || e.metaKey) key = `Ctrl+${key}`;
      if (e.shiftKey) key = `Shift+${key}`;

      const action = shortcuts[key];
      if (action) {
        e.preventDefault();
        action();
      }
    },
    [shortcuts]
  );

  return handler;
}
