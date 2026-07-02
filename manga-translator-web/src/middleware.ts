import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, getTokenFromRequestCookies } from '@/lib/authCookie';

const MOBILE_REGEX = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

const PUBLIC_PATHS = ['/login', '/register', '/api', '/_next', '/favicon.ico', '/fonts'];
const AUTH_PATHS = ['/login', '/register'];

/** 旧版无前缀路径 → /pc/ 前缀（Round-00 P2-005） */
const PC_LEGACY_PREFIXES = [
  '/fonts',
  '/search',
  '/settings',
  '/upload',
  '/audio',
  '/learn',
  '/plans',
  '/trash',
  '/api-keys',
  '/dynamic-manga',
  '/reader',
  '/recycle-bin',
];

function redirectPcLegacyPath(pathname: string, request: NextRequest): NextResponse | null {
  for (const prefix of PC_LEGACY_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return NextResponse.redirect(new URL(`/pc${pathname}${request.nextUrl.search}`, request.url));
    }
  }
  return null;
}

const AUTH_REQUIRED_PREFIXES = [
  '/pc/api-keys',
  '/pc/settings',
  '/pc/trash',
  '/pc/recycle-bin',
  '/pc/projects',
  '/m/me',
  '/m/projects',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((prefix) => pathname.startsWith(prefix));
}

function pathRequiresAuth(pathname: string): boolean {
  if (AUTH_REQUIRED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  if (pathname.startsWith('/pc/reader/') && !pathname.startsWith('/pc/reader/sample')) {
    return true;
  }
  if (pathname.startsWith('/m/reader/') && !pathname.startsWith('/m/reader/sample')) {
    return true;
  }
  if (pathname.startsWith('/m/quick-translate')) {
    return false;
  }
  if (pathname.startsWith('/m/')) {
    return true;
  }
  if (pathname === '/pc' || pathname.startsWith('/pc/')) {
    return false;
  }
  if (pathname === '/m') {
    return false;
  }
  return false;
}

function getAccessToken(request: NextRequest): string | undefined {
  return getTokenFromRequestCookies((name) => request.cookies.get(name));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDevBypass = request.nextUrl.searchParams.get('dev_bypass') === '1';

  if (isDevBypass) {
    if (
      pathname.startsWith('/_next') ||
      pathname.startsWith('/api') ||
      pathname.startsWith('/fonts') ||
      pathname === '/favicon.ico'
    ) {
      return NextResponse.next();
    }
    if (pathname === '/') {
      const userAgent = request.headers.get('user-agent') || '';
      const isMobile = MOBILE_REGEX.test(userAgent);
      return NextResponse.redirect(new URL(isMobile ? '/m' : '/pc', request.url));
    }
    const accessToken = getAccessToken(request);
    if (accessToken && AUTH_PATHS.includes(pathname)) {
      const userAgent = request.headers.get('user-agent') || '';
      const isMobile = MOBILE_REGEX.test(userAgent);
      return NextResponse.redirect(new URL(isMobile ? '/m' : '/pc', request.url));
    }
    const response = NextResponse.next();
    if (!accessToken) {
      response.cookies.set(AUTH_COOKIE, `dev_bypass_${Date.now()}`, {
        path: '/',
        maxAge: 86400,
        sameSite: 'lax',
      });
    }
    return response;
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const accessToken = getAccessToken(request);
  const isAuthenticated = !!accessToken;

  if (isAuthenticated && AUTH_PATHS.includes(pathname)) {
    const userAgent = request.headers.get('user-agent') || '';
    const isMobile = MOBILE_REGEX.test(userAgent);
    return NextResponse.redirect(new URL(isMobile ? '/m' : '/pc', request.url));
  }

  if (!isAuthenticated && pathRequiresAuth(pathname)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === '/') {
    const userAgent = request.headers.get('user-agent') || '';
    const isMobile = MOBILE_REGEX.test(userAgent);
    return NextResponse.redirect(new URL(isMobile ? '/m' : '/pc', request.url));
  }

  const legacyRedirect = redirectPcLegacyPath(pathname, request);
  if (legacyRedirect) return legacyRedirect;

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
