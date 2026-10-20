import type { Metadata, Viewport } from 'next';
import { Cairo, IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';

// Cairo: very clear, geometric Arabic for headings. IBM Plex Sans Arabic: open counters + generous x-height for body text.
const display = Cairo({ subsets: ['arabic', 'latin'], variable: '--font-display', weight: ['600', '700', '800'], display: 'swap' });
const body = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], variable: '--font-body', weight: ['400', '500', '600', '700'], display: 'swap' });

export const metadata: Metadata = {
  title: 'سبرينج بلازا كافيه',
  description: 'نظام إدارة الكافيه: أوردرات الكباتن، كاشير، مخزون وتقارير — يشتغل بدون إنترنت.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon.svg' },
};
export const viewport: Viewport = { themeColor: '#2E7358', width: 'device-width', initialScale: 1, maximumScale: 1 };

// Runs before first paint: applies the saved theme (or the OS preference) so there is never a white flash in night mode.
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('sp-theme');if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;if(t==='dark'){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','#0C100E');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head>
      <body className="min-h-dvh font-sans antialiased">
        <div id="app-root"><Providers>{children}</Providers></div>
        <div id="print-root" />
      </body>
    </html>
  );
}
