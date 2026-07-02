/**
 * 解析页面图片 URL。
 * 优先使用 /storage/ 路径（Next.js rewrite 无需鉴权），
 * 否则使用 gateway 图片端点（同样无需 Bearer，但需 rewrite 目标正确）。
 */
export function getGatewayOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';
  try {
    const url = new URL(raw.startsWith('http') ? raw : `http://${raw}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'http://localhost:8080';
  }
}

export function resolvePageImageUrl(
  pageId: string | null | undefined,
  originalUrl?: string | null,
  zoom?: number
): string | undefined {
  // 本地存储路径可直接通过 Next.js /storage rewrite 加载（无需 JWT）
  if (originalUrl?.startsWith('/storage/')) {
    return originalUrl;
  }

  if (originalUrl?.startsWith('http://') || originalUrl?.startsWith('https://')) {
    return originalUrl;
  }

  if (!pageId) {
    if (originalUrl?.startsWith('/api/v1/pages/')) {
      return originalUrl;
    }
    if (originalUrl?.startsWith('/uploads/')) {
      return originalUrl;
    }
    return undefined;
  }

  const base = `/api/v1/pages/${pageId}/image`;
  if (zoom != null && zoom !== 1) {
    return `${base}?zoom=${zoom}`;
  }
  return base;
}

/** 渲染结果图 URL（processed_url 可能是 /uploads/ 相对路径） */
export function resolveProcessedImageUrl(processedUrl?: string | null): string | undefined {
  if (!processedUrl) return undefined;
  if (
    processedUrl.startsWith('http://') ||
    processedUrl.startsWith('https://') ||
    processedUrl.startsWith('/storage/') ||
    processedUrl.startsWith('/uploads/') ||
    processedUrl.startsWith('/api/v1/')
  ) {
    return processedUrl;
  }
  return `/uploads/${processedUrl.replace(/^\/+/, '')}`;
}
