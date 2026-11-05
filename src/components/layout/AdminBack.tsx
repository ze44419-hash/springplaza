'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useProfile } from '@/hooks/useProfile';

/** "Back to admin dashboard" shortcut — shown only to the admin when browsing the hall / accounting areas. */
export default function AdminBack() {
  const { profile } = useProfile();
  if (profile?.role !== 'admin') return null;
  return <Link href="/admin" className="btn-ghost btn-sm"><ArrowRight size={16} /><span className="hidden sm:inline">لوحة المدير</span></Link>;
}
