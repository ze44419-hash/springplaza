'use client';
import BranchReport from '@/components/cafe/BranchReport';
import { useProfile } from '@/hooks/useProfile';

export default function BranchPage() {
  const { profile } = useProfile();
  return <BranchReport allowAll={profile?.role === 'admin'} canEstablishment={profile?.role === 'admin'} />;
}
