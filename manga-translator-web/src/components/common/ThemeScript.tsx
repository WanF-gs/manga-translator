import { THEME_COOKIE } from '@/lib/themeCookie';

/** 在 React 水合前同步暗色模式类名，避免 SSR/CSR className 不匹配（BUG-R00-P2-001） */
export function ThemeScript() {
  const script = `
(function() {
  try {
    var resolved = 'light';
    var raw = localStorage.getItem('manga-theme');
    if (raw) {
      var parsed = JSON.parse(raw);
      var mode = (parsed && parsed.state && parsed.state.mode) || 'system';
      if (mode === 'dark') resolved = 'dark';
      else if (mode === 'system') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    }
    if (resolved === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.cookie = '${THEME_COOKIE}=' + resolved + '; path=/; max-age=31536000; SameSite=Lax';
  } catch (e) {}
})();
`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
