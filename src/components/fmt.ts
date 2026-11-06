// Small display helpers shared by the Runs, Audit and Settings pages. All tolerate null (a provider that reports no usage).
export const num = (n: number | null | undefined): string => (n == null ? 'n/a' : n.toLocaleString('en-US'));

export const usd = (n: number | string | null | undefined): string => {
  if (n == null || n === '') return 'n/a';
  const v = Number(n);
  return v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
};

export const duration = (sec: number | null | undefined): string => {
  if (sec == null) return 'n/a';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m ${sec % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export const ms = (n: number | null | undefined): string => (n == null ? 'n/a' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

export const stamp = (iso: string | Date): string =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const clock = (iso: string | Date): string => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const ago = (iso: string | null | undefined): string => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
