/**
 * HTTP请求封装
 * 基于axios的统一请求实例，包含拦截器、错误处理、Token刷新
 */

import axios, { AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from './auth';
import type { ApiResponse } from '@/types';
import { API_REQUEST_TIMEOUT_MS } from '@/constants';

// 创建axios实例
const request = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1',
  timeout: API_REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ===== Token 刷新锁（避免并发请求重复刷新） =====
let isRefreshing = false;
let pendingRequests: Array<{
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}> = [];

function addPendingRequest(resolve: (token: string) => void, reject: (error: Error) => void) {
  pendingRequests.push({ resolve, reject });
}

function resolvePendingRequests(token: string) {
  pendingRequests.forEach(({ resolve }) => resolve(token));
  pendingRequests = [];
}

function rejectPendingRequests(error: Error) {
  pendingRequests.forEach(({ reject }) => reject(error));
  pendingRequests = [];
}

/**
 * 直接从 localStorage 读取 Zustand persist 存储的 refreshToken
 * 用于绕过 Zustand 水合时序问题（页面跳转后 persist 水合可能尚未完成）
 */
function getRefreshTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('manga-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.state?.refreshToken || null;
  } catch {
    return null;
  }
}

/**
 * 刷新 Access Token
 * 返回新的 access_token，失败则清除状态
 */
async function refreshAccessToken(): Promise<string> {
  // 优先从 Zustand 读取（已水合），否则从 localStorage 直接读（绕过水合延迟）
  let refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) {
    refreshToken = getRefreshTokenFromStorage();
  }

  if (!refreshToken) {
    throw new Error('登录已过期，请重新登录');
  }

  const { logout, updateToken } = useAuthStore.getState();

  try {
    const res = await authApi.refreshToken(refreshToken);
    const newAccessToken = res.data.data.access_token;
    const newRefreshToken = res.data.data.refresh_token;

    // 更新 store（仅更新 accessToken，refreshToken 也更新）
    updateToken(newAccessToken);
    useAuthStore.setState({ refreshToken: newRefreshToken });

    // 同步更新 cookie，保持与中间件一致
    if (typeof document !== 'undefined') {
      document.cookie = `manga-token=${newAccessToken}; path=/; max-age=86400; SameSite=Lax`;
    }

    return newAccessToken;
  } catch {
    // 刷新失败，清除登录状态
    logout();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('登录已过期，请重新登录');
  }
}

/** 简易 JWT payload 解码 */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/** 判断 JWT 是否已过期（带 5s 缓存，避免每次请求重复 decode） */
let tokenExpiryCache: { token: string; expired: boolean; at: number } | null = null;
const TOKEN_CACHE_MS = 5000;

function isTokenExpired(token: string): boolean {
  const now = Date.now();
  if (tokenExpiryCache?.token === token && now - tokenExpiryCache.at < TOKEN_CACHE_MS) {
    return tokenExpiryCache.expired;
  }
  const payload = decodeJwtPayload(token);
  const expired = !payload || !payload.exp ? false : payload.exp * 1000 < now;
  tokenExpiryCache = { token, expired, at: now };
  return expired;
}

/** Token 预刷新窗口：过期前 5 分钟主动续期 */
const PRE_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** 判断 JWT 是否即将过期（5分钟内），需要主动续期 */
function isTokenExpiringSoon(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.exp) return false;
  return payload.exp * 1000 - Date.now() < PRE_REFRESH_BUFFER_MS;
}

/** 后台静默预刷新 token */
let preRefreshPromise: Promise<string> | null = null;

async function preRefreshToken(): Promise<string | null> {
  // 避免并发预刷新
  if (preRefreshPromise) return preRefreshPromise;
  
  const refreshToken = useAuthStore.getState().refreshToken || getRefreshTokenFromStorage();
  if (!refreshToken) return null;
  
  preRefreshPromise = (async () => {
    try {
      const res = await authApi.refreshToken(refreshToken);
      const newAccessToken = res.data.data.access_token;
      const newRefreshToken = res.data.data.refresh_token;
      
      useAuthStore.getState().updateToken(newAccessToken);
      useAuthStore.setState({ refreshToken: newRefreshToken });
      
      if (typeof document !== 'undefined') {
        document.cookie = `manga-token=${newAccessToken}; path=/; max-age=86400; SameSite=Lax`;
      }
      
      return newAccessToken;
    } catch {
      return null;
    } finally {
      preRefreshPromise = null;
    }
  })();
  
  return preRefreshPromise;
}

/** 无需认证的公开接口路径 */
const PUBLIC_PATH_PREFIXES = ['/auth/login', '/auth/register', '/auth/refresh'];

function isPublicRequest(url?: string): boolean {
  if (!url) return false;
  return PUBLIC_PATH_PREFIXES.some((p) => url.includes(p));
}

/** 从 cookie 读取 token（与 middleware 鉴权方式保持一致，避免 Zustand 水合时序问题） */
function getTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)manga-token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ===== 请求拦截器 =====
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // 优先从 cookie 读取 token（登录后立即可用，不依赖 Zustand 水合）
    const cookieToken = getTokenFromCookie();
    const storeToken = useAuthStore.getState().accessToken;
    // cookie 和 store 都有就选最新写入的（cookie 是登录时同时写入的，更可靠）
    const token = cookieToken || storeToken;

    if (token) {
      // 主动预刷新：如果 token 5分钟内将过期，后台静默续期，不阻塞当前请求
      if (!isRefreshing && isTokenExpiringSoon(token) && !isPublicRequest(config.url)) {
        preRefreshToken().catch(() => {});
      }
      
      // 防御性检查：如果 token 已完全过期，不发给后端，直接清除状态
      if (isTokenExpired(token)) {
        // 对于后台轮询等非关键请求，静默丢弃而非报错
        const isBackgroundPolling = config.headers?.['X-Background-Poll'] === 'true';
        if (isBackgroundPolling) {
          return Promise.reject({ __silent: true, message: 'token expired' });
        }
        useAuthStore.getState().logout();
        return Promise.reject(new Error('登录已过期，请重新登录'));
      }
      config.headers.Authorization = `Bearer ${token}`;
    } else if (!isPublicRequest(config.url)) {
      // 无 token 访问受保护接口 → 直接拒绝，不发出 401 请求
      return Promise.reject(new Error('未登录'));
    }

    // 添加设备类型标识
    if (typeof window !== 'undefined') {
      config.headers['X-Device-Type'] = window.innerWidth < 768 ? 'mobile' : 'pc';
    }

    // FormData 不能手动设置 Content-Type，必须由浏览器自动追加 multipart boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    // 添加请求追踪ID
    config.headers['X-Request-ID'] = crypto.randomUUID?.() || Date.now().toString();

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ===== 响应拦截器 =====
request.interceptors.response.use(
  (response: AxiosResponse) => {
    const { code, message: msg } = response.data;

    // 业务成功
    if (code === 0) {
      return response;
    }

    // Token过期，尝试刷新
    if (code === 2002) {
      // 避免重复刷新
      if (!isRefreshing) {
        isRefreshing = true;

        return refreshAccessToken()
          .then((newToken) => {
            resolvePendingRequests(newToken);
            // 用新 token 重试当前请求
            if (response.config) {
              response.config.headers.Authorization = `Bearer ${newToken}`;
              return request(response.config);
            }
            return response;
          })
          .catch((err) => {
            rejectPendingRequests(err);
            return Promise.reject(err);
          })
          .finally(() => {
            isRefreshing = false;
          });
      }

      // 已有刷新进行中，等待结果
      return new Promise<AxiosResponse>((resolve, reject) => {
        addPendingRequest(
          (token: string) => {
            if (response.config) {
              response.config.headers.Authorization = `Bearer ${token}`;
              resolve(request(response.config));
            } else {
              resolve(response);
            }
          },
          (error: Error) => reject(error)
        );
      });
    }

    // 其他业务错误
    const error = new Error(msg || '请求失败');
    (error as any).code = code;
    return Promise.reject(error);
  },
  async (error: AxiosError) => {
    // 静默丢弃后台轮询的 token 过期错误，不产生控制台噪音
    if ((error as any)?.__silent) {
      return Promise.reject(error);
    }

    // 网络错误或HTTP错误
    if (!error.response) {
      // 保留请求拦截器抛出的错误消息（如"未登录"、"登录已过期"），不做覆盖
      if (error.message === '未登录' || error.message === '登录已过期，请重新登录') {
        return Promise.reject(error);
      }
      // CanceledError - 用户主动取消，静默处理
      if (error.name === 'CanceledError' || (error as any).code === 'ERR_CANCELED') {
        return Promise.reject(error);
      }
      // 超时
      if (error.code === 'ECONNABORTED') {
        return Promise.reject(new Error('请求超时，后端服务响应较慢，请稍后重试'));
      }
      // 网络错误（无法连接、DNS 解析失败等）
      return Promise.reject(new Error('无法连接后端服务，请确认 Docker 后端已启动（端口 8080），或稍后再试'));
    }

    const { status, config } = error.response;

    // 401 未授权 - 尝试刷新 Token
    if (status === 401 && config) {
      // 跳过刷新接口本身
      if (config.url?.includes('/auth/refresh')) {
        useAuthStore.getState().logout();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(new Error('登录已过期'));
      }

      if (!isRefreshing) {
        isRefreshing = true;

        try {
          const newToken = await refreshAccessToken();
          resolvePendingRequests(newToken);
          // 重试当前请求
          config.headers.Authorization = `Bearer ${newToken}`;
          return request(config);
        } catch (err) {
          rejectPendingRequests(err as Error);
          return Promise.reject(err);
        } finally {
          isRefreshing = false;
        }
      }

      // 已有刷新进行中
      return new Promise((resolve, reject) => {
        addPendingRequest(
          (token: string) => {
            config.headers.Authorization = `Bearer ${token}`;
            resolve(request(config));
          },
          (err: Error) => reject(err)
        );
      });
    }

    // 其他 HTTP 错误 → 提取后端错误消息
    let errorMsg = '请求失败';
    switch (status) {
      case 403:
        errorMsg = '权限不足，无法执行此操作';
        break;
      case 404:
        errorMsg = '请求的资源不存在';
        break;
      case 413:
        errorMsg = '文件大小超出限制（图片≤50MB，压缩包≤500MB）';
        break;
      case 429:
        errorMsg = '请求过于频繁，请稍后重试';
        break;
      case 500:
      case 502:
      case 503:
        errorMsg = '服务器繁忙，请稍后重试';
        break;
    }
    // 尝试使用后端返回的错误消息
    const backendMsg = (error.response?.data as any)?.message;
    return Promise.reject(new Error(backendMsg || errorMsg));
  }
);

export default request;
