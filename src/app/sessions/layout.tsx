'use client';
import { Camera } from 'lucide-react';
import ClientOnly from '@/components/ClientOnly';
import AppShell, { type NavItem } from '@/components/AppShell';
import AdminBack from '@/components/AdminBack';
import s from './sessions.module.css';

const NAV: NavItem[] = [{ href: '/sessions', label: 'حجوزات السيشن', icon: Camera, exact: true }];

export default function SessionsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={NAV} subtitle="سيشن التصوير" actions={<AdminBack />}><div className={s.content}><ClientOnly>{children}</ClientOnly></div></AppShell>;
}
