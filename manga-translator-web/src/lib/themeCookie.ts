/** SSR/CSR 主题 cookie 名，与 ThemeScript、themeStore 保持一致 */
export const THEME_COOKIE = 'manga-theme-resolved';

export function setThemeCookie(resolved: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  document.cookie = `${THEME_COOKIE}=${resolved}; path=/; max-age=31536000; SameSite=Lax`;
}
