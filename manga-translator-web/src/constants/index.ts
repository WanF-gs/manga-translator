// 语言代码常量
export const LANGUAGES = {
  ja: { code: 'ja', label: '日语', flag: '🇯🇵' },
  'zh-CN': { code: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
  'zh-TW': { code: 'zh-TW', label: '繁体中文', flag: '🇹🇼' },
  en: { code: 'en', label: '英语', flag: '🇺🇸' },
  ko: { code: 'ko', label: '韩语', flag: '🇰🇷' },
} as const;

// 文件格式支持
export const SUPPORTED_FORMATS = {
  import: ['.jpg', '.jpeg', '.png', '.webp', '.cbz', '.zip', '.rar', '.7z', '.pdf'],
  export: ['.jpg', '.png', '.webp', '.cbz', '.pdf'],
  font: ['.ttf', '.otf'],
};

// 文件大小限制 (bytes)
export const FILE_SIZE_LIMITS = {
  image: 50 * 1024 * 1024,    // 50MB
  archive: 500 * 1024 * 1024,  // 500MB
  font: 20 * 1024 * 1024,      // 20MB
};

// 分片上传大小
export const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

// 页面状态
export const PAGE_STATUS = {
  pending: { label: '待处理', color: '#94A3B8' },
  translating: { label: '翻译中', color: '#3B82F6' },
  reviewed: { label: '已校对', color: '#EAB308' },
  completed: { label: '已完成', color: '#22C55E' },
} as const;

// 区域类型
export const REGION_TYPES = {
  speech: { label: '对话气泡', color: '#3B82F6' },
  thought: { label: '内心独白', color: '#8B5CF6' },
  narration: { label: '旁白', color: '#F59E0B' },
  onomatopoeia: { label: '拟声词', color: '#EF4444' },
  effect: { label: '效果字', color: '#10B981' },
} as const;

// 导出分辨率
export const EXPORT_RESOLUTIONS = {
  original: { label: '原始分辨率', description: '保持原图分辨率' },
  '1080p': { label: '1080P', description: '1920×1080' },
  '2k': { label: '2K', description: '2560×1440' },
  '4k': { label: '4K', description: '3840×2160' },
} as const;

// 双语对照模式
export const BILINGUAL_MODES = {
  'side-by-side': { label: '左右分屏对照', icon: 'columns' },
  'top-bottom': { label: '上下对照', icon: 'rows' },
  'in-bubble': { label: '气泡内双语叠加', icon: 'layers' },
} as const;

// API基础路径
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

/** 默认 API 请求超时（毫秒）— 普通 CRUD 请求 */
export const API_REQUEST_TIMEOUT_MS = 30_000;

/** 登录/注册等认证接口超时 — 快速失败，不阻塞用户 */
export const API_AUTH_TIMEOUT_MS = 10_000;

/** 上传/导出等大文件接口超时 — 大文件处理需要更久 */
export const API_UPLOAD_TIMEOUT_MS = 600_000;

/** 非关键 API（通知、计数等）快速超时，不阻塞导航 */
export const API_FAST_TIMEOUT_MS = 3_000;
