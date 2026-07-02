import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import { Providers } from './providers';
import { ThemeScript } from '@/components/common/ThemeScript';
import { THEME_COOKIE } from '@/lib/themeCookie';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Manga Translator - 漫画多语言智能翻译',
  description: '上传即翻译、一键出成品、多端无缝用的漫画翻译工具',
  keywords: ['漫画翻译', 'Manga Translator', 'AI翻译', 'OCR', '漫画汉化'],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const themeCookie = cookies().get(THEME_COOKIE)?.value;
  const htmlClass = [inter.variable, themeCookie === 'dark' ? 'dark' : ''].filter(Boolean).join(' ');

  return (
    <html lang="zh-CN" className={htmlClass} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
