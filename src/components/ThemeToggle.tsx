'use client';

import { useEffect, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

const systemTheme = (): Theme => (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

// The saved choice wins; until one is made the system setting decides.
function readTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* storage blocked */
  }
  return systemTheme();
}

const subscribe = (notify: () => void) => {
  addEventListener('theme-change', notify);
  return () => removeEventListener('theme-change', notify);
};

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, (): Theme => 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const toggle = () => {
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* storage blocked */
    }
    dispatchEvent(new Event('theme-change'));
  };

  return (
    <button className="btn theme" type="button" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />
      </svg>
    </button>
  );
}
