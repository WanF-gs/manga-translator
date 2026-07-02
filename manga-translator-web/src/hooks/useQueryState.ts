/**
 * React Query 统一状态封装 Hook
 * 封装 loading/error/empty 三种状态 + 优化缓存策略
 */
'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

export interface QueryState<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isEmpty: boolean;
  refetch: () => void;
}

/**
 * 封装 useQuery，统一处理 loading/error/empty 三种状态
 * 同时设置合理的 staleTime 用于缓存
 */
export function useQueryState<T>(
  queryKey: string[],
  queryFn: () => Promise<T>,
  options?: {
    /** 是否启用查询 */
    enabled?: boolean;
    /** 数据过期时间（毫秒），默认 30s */
    staleTime?: number;
    /** 选择器，用于从原始数据中提取所需字段 */
    select?: (data: T) => T;
    /** 检查数据是否为空的函数 */
    isEmpty?: (data: T) => boolean;
  }
): QueryState<T> {
  const { enabled = true, staleTime = 30_000, select, isEmpty } = options || {};

  const query = useQuery<T, Error>({
    queryKey,
    queryFn,
    enabled,
    staleTime,
    select,
    retry: 1,
  });

  const result = useMemo(
    () => ({
      data: query.data,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error || null,
      isEmpty: query.data !== undefined ? (isEmpty ? isEmpty(query.data) : Array.isArray(query.data) ? (query.data as any[]).length === 0 : false) : false,
      refetch: () => query.refetch(),
    }),
    [query.data, query.isLoading, query.isError, query.error, query.refetch, isEmpty]
  );

  return result;
}

/**
 * 乐观更新 Mutation 封装
 */
export function useOptimisticMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: {
    /** 相关查询的 queryKey */
    queryKey: readonly unknown[];
    /** 乐观更新函数 */
    onOptimisticUpdate: (oldData: any, variables: TVariables) => any;
    /** 成功回调 */
    onSuccess?: (data: TData, variables: TVariables) => void;
    /** 失败回滚 */
    onError?: (error: Error, variables: TVariables) => void;
  }
) {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables, { previousData: unknown }>({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: options.queryKey });
      const previousData = queryClient.getQueryData(options.queryKey);
      queryClient.setQueryData(options.queryKey, options.onOptimisticUpdate(previousData, variables));
      return { previousData };
    },
    onSuccess: (data, variables) => {
      options.onSuccess?.(data, variables);
    },
    onError: (error, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(options.queryKey, context.previousData);
      }
      options.onError?.(error, variables);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: options.queryKey });
    },
  });
}

/**
 * 预取 Hook
 */
export function usePrefetch<T>(
  queryKey: string[],
  queryFn: () => Promise<T>,
  staleTime: number = 60_000
) {
  const queryClient = useQueryClient();

  const prefetch = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey,
      queryFn,
      staleTime,
    });
  }, [queryClient, queryKey, queryFn, staleTime]);

  return prefetch;
}
