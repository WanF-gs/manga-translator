/**
 * 认证状态管理
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserData } from '@/types';
import { clearAuthCookie, setAuthCookie } from '@/lib/authCookie';
/** 简易 JWT payload 解码（无需引入额外依赖） */
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

/** 判断 JWT token 是否已过期 */
function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return true; // 无法解码 => 视为过期
  if (!payload.exp) return false; // 无 exp 字段 => 永不超时
  return payload.exp * 1000 < Date.now();
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserData | null;
  isAuthenticated: boolean;
  /** 标记 persist 水合是否已完成（用于组件侧判断是否可以信任 auth 状态） */
  _hydrated: boolean;

  login: (accessToken: string, refreshToken: string, user: UserData) => void;
  logout: () => void;
  setUser: (user: UserData) => void;
  updateToken: (accessToken: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set): AuthState => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      _hydrated: false,

      login: (accessToken, refreshToken, user) => {
        setAuthCookie(accessToken);
        set({
          accessToken,
          refreshToken,
          user,
          isAuthenticated: true,
        });
      },

      logout: () => {
        clearAuthCookie();
        set({          accessToken: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
        });
      },

      setUser: (user) => set({ user }),

      updateToken: (accessToken) => set({ accessToken }),
    }),
    {
      name: 'manga-auth',
      /**
       * 不持久化 isAuthenticated 和 _hydrated。
       * merge 在水合时过滤掉旧格式中的 isAuthenticated，
       * 确保在任何 React 组件能用它之前就是 false。
       * onRehydrateStorage 随后校验 token 有效性再设为 true。
       */
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
      merge: (persisted: unknown, current: AuthState) => {
        // 防御：旧 localStorage 可能仍有 isAuthenticated:true，强制剥离
        const { isAuthenticated: _ignored, _hydrated: _ignored2, ...rest } = (persisted || {}) as Partial<AuthState>;
        // DEV: 如果 localStorage 中有 accessToken，允许通过（开发模式绕过认证）
        if (rest.accessToken) {
          return { ...current, ...rest, isAuthenticated: true, _hydrated: true };
        }
        return { ...current, ...rest, isAuthenticated: false, _hydrated: true };
      },
      onRehydrateStorage: () => {
        // FIX: P0-登录态数据加载 - 返回安全网函数
        // 即使 token 有效但因某种原因 isTokenExpired 误判或回调未执行，
        // 在下一个微任务中兜底：只要有 accessToken 就设为已认证
        return (state) => {
          if (!state) {
            useAuthStore.setState({ _hydrated: true });
            return;
          }

          if (state.accessToken && !isTokenExpired(state.accessToken)) {
            setAuthCookie(state.accessToken);
            useAuthStore.setState({ isAuthenticated: true, _hydrated: true });          } else if (state.accessToken) {
            // token 过期 → 彻底清除
            useAuthStore.setState({
              accessToken: null,
              refreshToken: null,
              _hydrated: true,
            });
          } else {
            useAuthStore.setState({ _hydrated: true });
          }

          // 安全网 L1 (50ms): 如果 accessToken 存在但 isAuthenticated 未生效，强制修正
          setTimeout(() => {
            const currentState = useAuthStore.getState();
            if (currentState.accessToken && !currentState.isAuthenticated) {
              console.warn('[authStore] 安全网L1: accessToken存在但isAuthenticated=false，强制修正');
              useAuthStore.setState({ isAuthenticated: true });
            }
            if (!currentState._hydrated) {
              console.warn('[authStore] 安全网L1: _hydrated仍为false，强制设为true');
              useAuthStore.setState({ _hydrated: true });
            }
          }, 50);

          // 安全网 L2 (1000ms): 最终兜底，确保 _hydrated 不会永久卡在 false
          setTimeout(() => {
            const currentState = useAuthStore.getState();
            if (!currentState._hydrated) {
              console.error('[authStore] 安全网L2(紧急): 1秒后_hydrated仍为false，强制修正');
              useAuthStore.setState({ _hydrated: true, isAuthenticated: !!currentState.accessToken });
            }
          }, 1000);
        };
      },
    }
  )
);
