'use client';
import { Camera, Calculator, Handshake, PieChart, Receipt, UsersRound, Store, Sprout } from 'lucide-react';
import ClientOnly from '@/components/ClientOnly';
import AppShell, { type NavItem } from '@/components/AppShell';
import AdminBack from '@/components/AdminBack';
import s from './accounting.module.css';

const NAV: NavItem[] = [
  { href: '/accounting', label: 'لوحة المحاسبة', icon: Calculator, exact: true },
  { href: '/accounting/expenses', label: 'المصروفات', icon: Receipt },
  { href: '/accounting/branches', label: 'تقارير الفروع', icon: Store },
  { href: '/accounting/nursery', label: 'المشتل', icon: Sprout },
  { href: '/accounting/staff', label: 'الموظفون والرواتب', icon: UsersRound },
  { href: '/sessions', label: 'سيشن التصوير', icon: Camera },
  { href: '/accounting/partners', label: 'الشركاء', icon: Handshake },
  { href: '/accounting/profit', label: 'توزيع الأرباح', icon: PieChart },
];

export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={NAV} subtitle="المحاسبة" actions={<AdminBack />}><div className={s.content}><ClientOnly>{children}</ClientOnly></div></AppShell>;
}
