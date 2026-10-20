'use client';
import { Store } from 'lucide-react';
import ClientOnly from '@/components/ClientOnly';
import AppShell, { type NavItem } from '@/components/AppShell';
import AdminBack from '@/components/AdminBack';

const NAV: NavItem[] = [{ href: '/branch', label: 'تقرير الفرع', icon: Store, exact: true }];

/** شاشة مدير الكافيه/القاعة: تقرير فروعه + مصروفاته + اعتماد الضيافة. */
export default function BranchLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={NAV} subtitle="الفروع" actions={<AdminBack />}><div style={{ maxWidth: 1152, margin: '0 auto', padding: 16 }}><ClientOnly>{children}</ClientOnly></div></AppShell>;
}
