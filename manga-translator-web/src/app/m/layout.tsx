'use client';

import React from 'react';
import { MobileLayout } from '@/components/layout/MobileLayout';

export default function MobileRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MobileLayout>{children}</MobileLayout>;
}
