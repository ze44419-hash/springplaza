/**
 * Print the page that is currently on screen (reports, contracts…) in DOCUMENT mode (see styles/print.css).
 * Adds `doc-print` to <html> so the layout chrome is hidden and colours are forced to black-on-white,
 * and drops any leftover thermal `@page` override so the default A4 / 10 mm margin applies.
 */
export function printPage(): void {
  const root = document.documentElement;
  root.classList.add('doc-print');
  document.getElementById('page-size')?.remove();
  const cleanup = () => { root.classList.remove('doc-print'); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.setTimeout(() => window.print(), 50);   // let the class apply before the browser snapshots the page
}
