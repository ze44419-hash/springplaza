'use client';
import { Camera, CalendarDays, Store, Tags } from 'lucide-react';
import ClientOnly from '@/components/layout/ClientOnly';
import AppShell, { type NavItem } from '@/components/layout/AppShell';
import AdminBack from '@/components/layout/AdminBack';
import s from './hall.module.css';

const NAV: NavItem[] = [
  { href: '/hall', label: 'التقويم والحجوزات', icon: CalendarDays, exact: true },
  { href: '/branch', label: 'تقرير القاعة', icon: Store, roles: ['admin'] },
  { href: '/hall/pricing', label: 'الأسعار والخدمات', icon: Tags, roles: ['admin'] },
  { href: '/sessions', label: 'سيشن التصوير', icon: Camera, roles: ['admin'] },
];

export default function HallLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={NAV} subtitle="القاعة" actions={<AdminBack />}><div className={s.content}><ClientOnly>{children}</ClientOnly></div></AppShell>;
}
