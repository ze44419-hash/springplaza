'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import Blossom from './Blossom';
import StatusPill from './StatusPill';
import EmployeeRequests from './EmployeeRequests';
import BranchSwitcher from './BranchSwitcher';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useProfile } from '@/hooks/useProfile';
import { db, delMeta } from '@/lib/db';
import { roleLabel } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';

export interface NavItem { href: string; label: string; icon: LucideIcon; /** Highlight only on this exact path (use for a section's home tab). */ exact?: boolean }

export default function AppShell({ children, nav, subtitle, actions }: { children: ReactNode; nav?: NavItem[]; subtitle?: string; actions?: ReactNode }) {
  const { profile } = useProfile();
  const router = useRouter();
  const path = usePathname();

  async function signOut() {
    const unsent = await db.outbox.where('status').equals('pending').count();
    if (unsent > 0 && !confirm(`في ${unsent} تغيير لسه ما اتزامنش. تسجّل خروج برضه؟ هيفضلوا على الجهاز ويتزامنوا بعد الدخول الجاي.`)) return;
    await createClient().auth.signOut().catch(() => {});
    await delMeta('profile');
    router.replace('/login');
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b-2 border-petal-200 bg-surface/85 px-4 py-2.5 shadow-[var(--shadow-sm)] backdrop-blur-md">
        <Blossom size={36} />
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-lg font-bold">سبرينج بلازا</p>
          <p className="truncate text-xs text-bark-500">{subtitle ?? (profile ? roleLabel[profile.role] : '')}{profile ? ` · ${profile.full_name}` : ''}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {actions}
          <StatusPill />
          <ThemeToggle className="!h-10 !w-10" />
          <button className="btn-ghost btn-sm" onClick={signOut} aria-label="تسجيل الخروج"><LogOut size={18} /><span className="hidden sm:inline">خروج</span></button>
        </div>
      </header>
      {nav && (
        <nav className="flex gap-1 overflow-x-auto border-b-2 border-petal-200 bg-surface px-3 py-2" aria-label="الأقسام">
          {nav.map(({ href, label, icon: Icon, exact }) => {
            const active = exact || href === '/admin' ? path === href : path.startsWith(href);
            return (
              <Link key={href} href={href} className={clsx('flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold', active ? 'bg-fern text-white shadow-sm' : 'text-bark-500 hover:bg-petal-100')}>
                <Icon size={18} /> {label}
              </Link>
            );
          })}
        </nav>
      )}
      <main className="flex-1">
        {profile && profile.role !== 'waiter' && profile.role !== 'cashier' && <BranchSwitcher profile={profile} />}
        {profile && (profile.role === 'waiter' || profile.role === 'cashier' || profile.role === 'admin') && <EmployeeRequests profile={profile} />}
        {children}
      </main>
    </div>
  );
}
