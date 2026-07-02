import React from 'react';
import { PcLayout } from '@/components/layout/PcLayout';

export default function PcRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PcLayout>{children}</PcLayout>;
}
