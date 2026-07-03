'use client';

/**
 * React Query 集成 Hooks
 * 
 * 提供统一的数据获取、缓存、乐观更新模式。
 * 各页面可逐步从手动 useEffect+useState 迁移至此。
 */
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { projectApi } from '@/services/project';
import { pageApi } from '@/services/page';
import { presetApi } from '@/services/preset';
import { readerApi } from '@/services/reader';
import { trashApi } from '@/services/trash';
import { termApi } from '@/services/term';
import { fontApi, type FontData, type FontListParams } from '@/services/font';
import { characterApi, type CharacterData } from '@/services/character';
import { apiKeyApi, type ApiKeyData } from '@/services/api-keys';
import { qualityApi, type QualitySummary } from '@/services/quality';
import { collaborationApi, type CommentData, type PageLock } from '@/services/collaboration';
import { searchApi, learnApi, type SearchResult, type SearchParams, type LearningProgress, type UserAchievement } from '@/services/search';
import { paymentApi, type PlanInfo } from '@/services/payment';
import { useAuthStore } from '@/stores/authStore';
import type { TermEntry, TermListParams } from '@/services/term';
import type {
  ProjectData,
  ChapterData,
  PageData,
  StylePreset,
  TextRegion,
} from '@/types';

// ===== Query Key 工厂 =====
export const queryKeys = {
  projects: {
    all: ['projects'] as const,
    list: (params?: Record<string, unknown>) => ['projects', 'list', params] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
    chapters: (projectId: string) => ['projects', 'chapters', projectId] as const,
  },
  pages: {
    all: ['pages'] as const,
    list: (chapterId: string) => ['pages', 'list', chapterId] as const,
    detail: (pageId: string) => ['pages', 'detail', pageId] as const,
    regions: (pageId: string) => ['pages', 'regions', pageId] as const,
  },
  presets: {
    all: ['presets'] as const,
    byCategory: (category?: string) => ['presets', 'list', category] as const,
  },
  reader: {
    pages: (chapterId: string) => ['reader', 'pages', chapterId] as const,
    progress: (chapterId: string) => ['reader', 'progress', chapterId] as const,
  },
  trash: {
    all: ['trash'] as const,
    list: (params?: Record<string, unknown>) => ['trash', 'list', params] as const,
  },
  terms: {
    all: ['terms'] as const,
    list: (params?: TermListParams) => ['terms', 'list', params] as const,
    detail: (termId: string) => ['terms', 'detail', termId] as const,
  },
  // ===== v3.0 新增 =====
  fonts: {
    all: ['fonts'] as const,
    list: (params?: FontListParams) => ['fonts', 'list', params] as const,
  },
  characters: {
    all: ['characters'] as const,
    list: (projectId: string) => ['characters', 'list', projectId] as const,
  },
  apiKeys: {
    all: ['api-keys'] as const,
    list: ['api-keys', 'list'] as const,
  },
  quality: {
    all: ['quality'] as const,
    page: (pageId: string) => ['quality', 'page', pageId] as const,
    project: (projectId: string) => ['quality', 'project', projectId] as const,
  },
  collaboration: {
    lock: (pageId: string) => ['collaboration', 'lock', pageId] as const,
    comments: (pageId: string) => ['collaboration', 'comments', pageId] as const,
    snapshots: (projectId: string) => ['collaboration', 'snapshots', projectId] as const,
  },
  search: {
    all: ['search'] as const,
    results: (params: SearchParams) => ['search', 'results', params] as const,
  },
  learn: {
    all: ['learn'] as const,
    progress: (lang?: string) => ['learn', 'progress', lang] as const,
    achievements: ['learn', 'achievements'] as const,
    stats: ['learn', 'stats'] as const,
  },
  payments: {
    plans: ['payments', 'plans'] as const,
    quota: ['payments', 'quota'] as const,
  },
};

// ===== 通用数据解包工具 =====
function extractData<T>(response: any): T {
  return response?.data?.data ?? response?.data ?? response;
}

// ===== 项目管理 Hooks =====

/** 获取项目列表 */
export function useProjects(params?: Record<string, unknown>) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  // FIX: P0-登录态数据加载 - 同时检查 isAuthenticated 和 accessToken
  // Zustand persist 的 merge 强制 isAuthenticated=false，onRehydrateStorage 异步设置 true
  // 在 merge 完成但 onRehydrateStorage 未执行的间隙，accessToken 已可用但 isAuthenticated 仍为 false
  // 增加 accessToken 检查确保 Query 在此间隙也能触发，避免"已登录但无数据"问题
  const hasAuth = isAuthenticated || !!accessToken;
  return useQuery({
    queryKey: queryKeys.projects.list(params),
    queryFn: async () => {
      const res = await projectApi.getList(params);
      const data = extractData<any>(res);
      return (data?.items || (Array.isArray(data) ? data : [])) as ProjectData[];
    },
    enabled: hasAuth,
    retry: false,
    staleTime: 30 * 1000,
  });
}

/** 获取项目详情 */
export function useProjectDetail(projectId: string, options?: Partial<UseQueryOptions<ProjectData>>) {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: async () => {
      const res = await projectApi.getDetail(projectId);
      return extractData<ProjectData>(res.data || res);
    },
    enabled: !!projectId,
    staleTime: 60 * 1000,
    ...options,
  });
}

/** 获取章节列表 */
export function useChapters(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projects.chapters(projectId),
    queryFn: async () => {
      const res = await projectApi.getChapters(projectId);
      const data = extractData<any>(res);
      return (Array.isArray(data) ? data : data?.items || []) as ChapterData[];
    },
    enabled: !!projectId,
    staleTime: 60 * 1000,
  });
}

// ===== 页面管理 Hooks =====

/** 获取页面列表 */
export function usePages(chapterId: string) {
  return useQuery({
    queryKey: queryKeys.pages.list(chapterId),
    queryFn: async () => {
      const res = await pageApi.getList(chapterId);
      const data = extractData<any>(res);
      return (Array.isArray(data) ? data : data?.items || []) as PageData[];
    },
    enabled: !!chapterId,
    staleTime: 30 * 1000,
  });
}

/** 获取页面详情（含区域数据） */
export function usePageDetail(pageId: string) {
  return useQuery({
    queryKey: queryKeys.pages.detail(pageId),
    queryFn: async () => {
      const res = await pageApi.getDetail(pageId);
      return extractData<any>(res) as PageData & { regions?: TextRegion[] };
    },
    enabled: !!pageId && pageId !== "undefined" && pageId !== "null" && pageId.length >= 32,
    staleTime: 10 * 1000,
  });
}

// ===== 样式预设 Hooks =====

/** 获取样式预设 */
export function usePresets(category?: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasAuth = isAuthenticated || !!accessToken;
  return useQuery({
    queryKey: queryKeys.presets.byCategory(category),
    queryFn: async () => {
      const res = await presetApi.getList(category);
      return extractData<StylePreset[]>(res) || [];
    },
    enabled: hasAuth,
    staleTime: 5 * 60 * 1000,
  });
}

// ===== 阅读器 Hooks =====

/** 获取阅读器页面 */
export function useReaderPages(chapterId: string) {
  return useQuery({
    queryKey: queryKeys.reader.pages(chapterId),
    queryFn: async () => {
      const res = await readerApi.getPages(chapterId);
      return extractData<any[]>(res) || [];
    },
    enabled: !!chapterId,
    staleTime: 30 * 1000,
  });
}

/** 获取阅读进度 */
export function useReaderProgress(chapterId: string) {
  return useQuery({
    queryKey: queryKeys.reader.progress(chapterId),
    queryFn: async () => {
      const res = await readerApi.getProgress(chapterId);
      return extractData<any>(res) || null;
    },
    enabled: !!chapterId,
    staleTime: 5 * 1000,
  });
}

// ===== 回收站 Hooks =====

/** 获取回收站列表 */
export function useTrash(params?: Record<string, unknown>) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasAuth = isAuthenticated || !!accessToken;
  return useQuery({
    queryKey: queryKeys.trash.list(params),
    queryFn: async () => {
      const res = await trashApi.getList(params);
      const data = extractData<any>(res);
      return (data?.items || (Array.isArray(data) ? data : [])) as any[];
    },
    enabled: hasAuth,
    staleTime: 30 * 1000,
  });
}

// ===== 术语库 Hooks =====

/** 获取术语列表 */
export function useTerms(params?: TermListParams) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasAuth = isAuthenticated || !!accessToken;
  return useQuery({
    queryKey: queryKeys.terms.list(params),
    queryFn: async () => {
      const res = await termApi.getList(params);
      const data = extractData<any>(res);
      return {
        items: (data?.items || (Array.isArray(data) ? data : [])) as TermEntry[],
        total: data?.total || 0,
        page: data?.page || 1,
        page_size: data?.page_size || 20,
      };
    },
    enabled: hasAuth,
    staleTime: 60 * 1000,
  });
}

/** 删除术语 mutation（乐观更新） */
export function useDeleteTerm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (termId: string) => termApi.delete(termId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.terms.all });
    },
  });
}

/** 创建术语 mutation */
export function useCreateTerm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof termApi.create>[0]) => termApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.terms.all });
    },
  });
}

/** 更新术语 mutation */
export function useUpdateTerm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ termId, data }: { termId: string; data: Partial<TermEntry> }) =>
      termApi.update(termId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.terms.all });
    },
  });
}

// ===== v3.0 字体管理 Hooks =====

/** 获取字体列表 */
export function useFonts(params?: FontListParams) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasAuth = isAuthenticated || !!accessToken;
  return useQuery({
    queryKey: queryKeys.fonts.list(params),
    queryFn: async () => {
      const res = await fontApi.getList(params);
      const data = extractData<any>(res);
      return (data?.items || (Array.isArray(data) ? data : [])) as FontData[];
    },
    enabled: hasAuth,
    staleTime: 30_000,
  });
}

// ===== v3.0 角色管理 Hooks =====

/** 获取角色列表 */
export function useCharacters(projectId: string) {
  return useQuery({
    queryKey: queryKeys.characters.list(projectId),
    queryFn: async () => {
      const res = await characterApi.getList(projectId);
      return (extractData<any>(res) || []) as CharacterData[];
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ===== v3.0 API Key Hooks =====

/** 获取 API Key 列表 */
export function useApiKeys() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasAuth = isAuthenticated || !!accessToken;
  return useQuery({
    queryKey: queryKeys.apiKeys.list,
    queryFn: async () => {
      const res = await apiKeyApi.getList();
      return (extractData<any>(res) || []) as ApiKeyData[];
    },
    enabled: hasAuth,
    staleTime: 30_000,
  });
}

// ===== v3.0 质量评估 Hooks =====

/** 获取项目质量总览 */
export function useQualitySummary(projectId: string) {
  return useQuery({
    queryKey: queryKeys.quality.project(projectId),
    queryFn: async () => {
      const res = await qualityApi.getProjectSummary(projectId);
      return extractData<QualitySummary>(res);
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

// ===== v3.0 协作 Hooks =====

/** 获取页面锁状态 */
export function usePageLock(pageId: string) {
  return useQuery({
    queryKey: queryKeys.collaboration.lock(pageId),
    queryFn: async () => {
      const res = await collaborationApi.getPageLock(pageId);
      return extractData<PageLock | null>(res);
    },
    enabled: !!pageId,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

/** 获取页面评论 */
export function useComments(pageId: string) {
  return useQuery({
    queryKey: queryKeys.collaboration.comments(pageId),
    queryFn: async () => {
      const res = await collaborationApi.getComments(pageId);
      return (extractData<any>(res) || []) as CommentData[];
    },
    enabled: !!pageId,
    staleTime: 10_000,
  });
}

// ===== v3.0 搜索 & 学习 Hooks =====

/** 跨作品搜索 */
export function useSearch(params: SearchParams) {
  return useQuery({
    queryKey: queryKeys.search.results(params),
    queryFn: async () => {
      const res = await searchApi.search(params);
      const data = extractData<any>(res);
      return {
        items: (data?.items || []) as SearchResult[],
        total: (data?.total || 0) as number,
      };
    },
    enabled: !!params.q,
    staleTime: 60_000,
  });
}

/** 获取学习进度 */
export function useLearningProgress(language?: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasAuth = isAuthenticated || !!accessToken;
  return useQuery({
    queryKey: queryKeys.learn.progress(language),
    queryFn: async () => {
      const res = await learnApi.getProgress(language);
      return (extractData<any>(res) || []) as LearningProgress[];
    },
    enabled: hasAuth,
    staleTime: 30_000,
  });
}

/** 获取成就 */
export function useAchievements() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasAuth = isAuthenticated || !!accessToken;
  return useQuery({
    queryKey: queryKeys.learn.achievements,
    queryFn: async () => {
      const res = await learnApi.getAchievements();
      return (extractData<any>(res) || []) as UserAchievement[];
    },
    enabled: hasAuth,
    staleTime: 5 * 60_000,
  });
}

// ===== v3.0 付费 Hooks =====

/** 获取方案列表 */
export function usePlans() {
  return useQuery({
    queryKey: queryKeys.payments.plans,
    queryFn: async () => {
      const res = await paymentApi.getPlans();
      return (extractData<any>(res) || []) as PlanInfo[];
    },
    staleTime: 10 * 60_000,
  });
}

/** 获取用户配额 */
export function useUserQuota() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasAuth = isAuthenticated || !!accessToken;
  return useQuery({
    queryKey: queryKeys.payments.quota,
    queryFn: async () => {
      const res = await paymentApi.getQuota();
      return extractData<any>(res);
    },
    enabled: hasAuth,
    staleTime: 30_000,
  });
}

// ===== 通用 Mutation Hooks =====

/** 创建通用的乐观更新 mutation */
export function useGenericMutation<TData = unknown, TVariables = void>({
  mutationFn,
  onSuccess,
  invalidateKeys,
}: {
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData, variables: TVariables) => void;
  invalidateKeys?: (readonly string[])[];
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      if (invalidateKeys) {
        invalidateKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      }
      onSuccess?.(data, variables);
    },
  });
}
