export const DAY = 864e5;

export const midnight = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// Whole calendar days from today to an ISO date (YYYY-MM-DD): 0 today, negative once closed.
export const daysLeft = (iso: string): number => Math.round((new Date(iso + 'T00:00:00').getTime() - midnight().getTime()) / DAY);

export const fmt = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
};

export type Verdict = 'Bid' | 'Consider' | 'Skip' | '';

export const verdictOf = (t: { recommendation: string }): Verdict => {
  const m = /^\s*(bid|consider|skip)/i.exec(t.recommendation || '')?.[1];
  return m ? ((m[0].toUpperCase() + m.slice(1).toLowerCase()) as Verdict) : '';
};

export const whyOf = (t: { recommendation: string }): string =>
  (t.recommendation || '').replace(/^\s*(bid|consider|skip)\W*/i, '').replace(/^./, (c) => c.toUpperCase());

// Relevance ends up in a class name, so only ever return one of the known values.
export const colorClass = (r: string): 'High' | 'Medium' | 'Low' => (r === 'High' || r === 'Medium' ? r : 'Low');

// Links come from scraped data: only http(s) is ever rendered as a link.
export const safeHref = (url: string): string | undefined => (/^https?:\/\//i.test(url) ? url : undefined);
