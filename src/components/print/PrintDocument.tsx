'use client';
import { useEffect, type ReactNode } from 'react';
import { Printer } from 'lucide-react';

/**
 * A4 print sheet. Shows an on-screen preview with a print button; under @media print only the sheet is left
 * (white page, black text, 10 mm margins — see styles/print.css), even when the app is in dark mode.
 * While mounted the page is in "document" print mode, so Ctrl+P from the browser prints correctly too.
 * `title` becomes the tab title, which browsers use as the default PDF file name.
 */
export default function PrintDocument({ title, children, toolbar }: { title: string; children: ReactNode; toolbar?: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const prevTitle = document.title;
    root.classList.add('doc-print');
    document.getElementById('page-size')?.remove();
    document.title = title;
    return () => { root.classList.remove('doc-print'); document.title = prevTitle; };
  }, [title]);

  return (
    <div>
      <div className="doc-toolbar no-print">
        <button type="button" className="btn-primary" onClick={() => window.print()}><Printer size={18} /> طباعة (A4)</button>
        {toolbar}
      </div>
      <article className="a4-sheet">{children}</article>
    </div>
  );
}
