/** 与 middleware、login 流程保持一致的认证 cookie 名 */
export const AUTH_COOKIE = 'manga-token';

const LEGACY_AUTH_COOKIES = ['access_token', 'accessToken'] as const;

export function setAuthCookie(token: string, maxAgeSeconds = 86400) {
  if (typeof document === 'undefined') return;
  document.cookie = `${AUTH_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

export function clearAuthCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/** middleware 侧：从 cookie 读取 token（兼容测试注入的 legacy 名称） */
export function getTokenFromRequestCookies(
  get: (name: string) => { value: string } | undefined
): string | undefined {
  const primary = get(AUTH_COOKIE)?.value;
  if (primary) return decodeURIComponent(primary);

  for (const name of LEGACY_AUTH_COOKIES) {
    const legacy = get(name)?.value;
    if (legacy) return decodeURIComponent(legacy);
  }
  return undefined;
}
