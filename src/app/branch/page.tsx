'use client';
import BranchReport from '@/components/BranchReport';
import { useProfile } from '@/hooks/useProfile';

export default function BranchPage() {
  const { profile } = useProfile();
  return <BranchReport allowAll={profile?.role === 'admin'} canEstablishment={profile?.role === 'admin'} />;
}
