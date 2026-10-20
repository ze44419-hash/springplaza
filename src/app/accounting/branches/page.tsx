'use client';
import BranchReport from '@/components/BranchReport';

/** المحاسب/الأدمن: تقرير كل كافيه وقاعة على حدة + مقارنة + مصاريف التأسيس. */
export default function AccountingBranchesPage() {
  return <BranchReport allowAll canEstablishment />;
}
