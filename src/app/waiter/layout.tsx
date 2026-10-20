import ClientOnly from '@/components/ClientOnly';

// يمنع أخطاء Hydration (IndexedDB / localStorage / تواريخ بتختلف بين السيرفر والمتصفح)
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientOnly>{children}</ClientOnly>;
}
