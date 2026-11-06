'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ThemeToggle } from '../ThemeToggle';
import { ToastProvider } from '../Toasts';
import { RunPill } from './RunPill';

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const NAV = [
  { href: '/', label: 'Tenders', icon: icon('M4 6h16M4 12h16M4 18h10') },
  { href: '/runs', label: 'Runs', icon: icon('M5 4v16M5 6l12 6-12 6') },
  { href: '/audit', label: 'Audit log', icon: icon('M9 4h6l4 4v12H5V4h4zM9 12h6M9 16h6') },
  { href: '/settings', label: 'Settings', icon: icon('M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2 1-2 3-2-.5-1.5 1V19h-3v-2.5L11 16l-2 .5-2-3 2-1V11l-2-1 2-3 2 .5L12.5 6V4h3v2.5') },
];

export function Shell({ children, signOut }: { children: ReactNode; signOut?: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setOpen(false), 0); // close the mobile menu after navigating
    return () => clearTimeout(t);
  }, [path]);

  const current = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

  return (
    <ToastProvider>
      <div className="shell">
        <div className="topbar">
          <button type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <b>Tender Matcher</b>
        </div>
        {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
        <aside className={`side${open ? ' open' : ''}`}>
          <div className="brand">
            <svg viewBox="0 0 34 34" fill="none" aria-hidden="true">
              <rect x="2" y="2" width="30" height="30" rx="9" stroke="currentColor" strokeWidth="2.5" />
              <path d="M9 22l5-5 4 3 7-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="25" cy="12" r="2.2" fill="currentColor" />
            </svg>
            <div>
              <b>Tender Matcher</b>
              <small>Funavry Technologies</small>
            </div>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={current(n.href) ? 'page' : undefined}>
                {n.icon}
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="side-foot">
            <RunPill />
            <div className="side-actions">
              <ThemeToggle />
              {signOut}
            </div>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </ToastProvider>
  );
}
