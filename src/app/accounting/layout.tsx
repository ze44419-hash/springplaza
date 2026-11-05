'use client';
import { Banknote, BarChart3, Camera, Calculator, Handshake, Landmark, PieChart, Receipt, Truck, UsersRound, Store, Sprout, Wallet } from 'lucide-react';
import ClientOnly from '@/components/layout/ClientOnly';
import AppShell, { type NavItem } from '@/components/layout/AppShell';
import AdminBack from '@/components/layout/AdminBack';
import s from './accounting.module.css';

const NAV: NavItem[] = [
  { href: '/accounting', label: 'لوحة المحاسبة', icon: Calculator, exact: true },
  { href: '/accounting/expenses', label: 'المصروفات', icon: Receipt },
  { href: '/accounting/treasury', label: 'الخزنة', icon: Landmark },
  { href: '/accounting/receivables', label: 'فلوس بره', icon: Banknote },
  { href: '/accounting/suppliers', label: 'الموردين والمشتريات', icon: Truck },
  { href: '/accounting/assets', label: 'الأصول', icon: Wallet },
  { href: '/accounting/reports', label: 'التقارير', icon: BarChart3 },
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
