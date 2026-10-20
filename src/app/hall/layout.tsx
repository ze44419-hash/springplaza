'use client';
import { Camera, CalendarDays, Store, Tags } from 'lucide-react';
import ClientOnly from '@/components/ClientOnly';
import AppShell, { type NavItem } from '@/components/AppShell';
import AdminBack from '@/components/AdminBack';
import s from './hall.module.css';

const NAV: NavItem[] = [
  { href: '/hall', label: 'التقويم والحجوزات', icon: CalendarDays, exact: true },
  { href: '/branch', label: 'تقرير القاعة', icon: Store },
  { href: '/hall/pricing', label: 'الأسعار والخدمات', icon: Tags },
  { href: '/sessions', label: 'سيشن التصوير', icon: Camera },
];

export default function HallLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={NAV} subtitle="القاعة" actions={<AdminBack />}><div className={s.content}><ClientOnly>{children}</ClientOnly></div></AppShell>;
}
