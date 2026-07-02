import { redirect } from 'next/navigation';

/** PC 布局内注册路由 — 重定向到独立注册页（FE-P1-001） */
export default function PcRegisterPage() {
  redirect('/register');
}
