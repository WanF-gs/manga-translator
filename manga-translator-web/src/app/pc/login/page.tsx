import { redirect } from 'next/navigation';

/** PC 布局内登录路由 — 重定向到独立登录页（FE-P1-001） */
export default function PcLoginPage() {
  redirect('/login');
}
