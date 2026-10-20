'use client';
import { Camera, BarChart3, BookOpen, CalendarDays, Calculator, Store, ClipboardList, Gift, LayoutDashboard, Package, ReceiptText, Users, UtensilsCrossed } from 'lucide-react';
import ClientOnly from '@/components/ClientOnly';
import AppShell, { type NavItem } from '@/components/AppShell';
import s from './admin.module.css';

const NAV: NavItem[] = [
  { href: '/admin', label: 'نظرة عامة', icon: LayoutDashboard },
  { href: '/admin/orders', label: 'الأوردرات', icon: ClipboardList },
  { href: '/admin/special-orders', label: 'الضيافة والطلبات الشخصية', icon: Gift },
  { href: '/admin/menu', label: 'المنيو', icon: UtensilsCrossed },
  { href: '/admin/inventory', label: 'المخازن والمخزون', icon: Package },
  { href: '/admin/recipes', label: 'الوصفات', icon: BookOpen },
  { href: '/admin/reports', label: 'الشيفتات والتقارير', icon: BarChart3 },
  { href: '/admin/receipts', label: 'تصميم الإيصالات', icon: ReceiptText },
  { href: '/admin/branches', label: 'الفروع والمسؤولين', icon: Store },
  { href: '/hall', label: 'القاعة', icon: CalendarDays },
  { href: '/sessions', label: 'سيشن التصوير', icon: Camera },
  { href: '/accounting', label: 'المحاسبة', icon: Calculator },
  { href: '/admin/users', label: 'الحسابات', icon: Users },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={NAV} subtitle="مدير"><div className={s.content}><ClientOnly>{children}</ClientOnly></div></AppShell>;
}
