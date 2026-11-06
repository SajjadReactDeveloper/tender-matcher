'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { TenderView } from '@/domain/types';
import { api } from './api-client';
import { ago, num, usd } from './fmt';
import { daysLeft, isOpen } from './format';
import { isActive, type RunSummary } from './RunBar';

interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
}

type Props = { tenders: TenderView[]; run: (RunSummary & { finishedAt?: string | null; startedAt?: string }) | null; loading: boolean };

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

function Card({ icon, tone, label, children }: { icon: string; tone?: 'warn' | 'good'; label: string; children: ReactNode }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span className={`stat-ico${tone ? ` ${tone}` : ''}`}>{svg(icon)}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

// Five plain, evenly weighted cards. The chart below is the page's main picture, so these stay calm.
export function StatRow({ tenders, run, loading }: Props) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const active = isActive(run);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api('/api/usage?hours=24')
        .then((r) => r.json())
        .then((u) => live && setUsage(u as Usage))
        .catch(() => {});
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [run?.id, run?.status, run?.matched]);

  const open = tenders.filter(isOpen);
  const soon = open.filter((t) => t.lastDate && daysLeft(t.lastDate) <= 7);
  const scored = open.filter((t) => t.score > 0);
  const avg = scored.length ? Math.round(scored.reduce((a, t) => a + t.score, 0) / scored.length) : null;
  const by = (r: string) => open.filter((t) => t.relevance === r).length;
  const [hi, me, lo] = [by('High'), by('Medium'), by('Low')];
  const total = Math.max(1, hi + me + lo);
  const tokens = usage ? usage.inputTokens + usage.outputTokens : 0;
  const blank = loading ? '' : undefined;

  return (
    <section className="stats" aria-label="Summary">
      <Card icon="M4 6h16M4 12h16M4 18h10" label="Open matches">
        <div className="stat-val">{blank ?? open.length}</div>
        <div className="stat-sub">{loading ? '' : `${tenders.length - open.length} already closed`}</div>
      </Card>

      <Card icon="M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z" tone="warn" label="Closing soon">
        <div className="stat-val">{blank ?? soon.length}</div>
        <div className="stat-sub">{loading ? '' : 'within the next 7 days'}</div>
      </Card>

      <Card icon="M4 19V9M10 19V5M16 19v-7M22 19H2" tone="good" label="Average fit">
        <div className="stat-val">
          {blank ?? (avg ?? 'n/a')}
          {avg != null && <span className="unit">/ 100</span>}
        </div>
        <div className="meter" role="img" aria-label={`${hi} high, ${me} medium, ${lo} low`}>
          <i style={{ width: `${(hi / total) * 100}%`, background: 'var(--high)' }} />
          <i style={{ width: `${(me / total) * 100}%`, background: 'var(--med)' }} />
          <i style={{ width: `${(lo / total) * 100}%`, background: 'var(--low)', opacity: 0.7 }} />
        </div>
        <div className="stat-sub">{loading ? '' : `${hi} high, ${me} medium, ${lo} low`}</div>
      </Card>

      <Card icon="M5 4v16M5 6l12 6-12 6" label="Last fetch">
        {run ? <span className={`status ${active ? 'running' : run.status}`}>{active ? 'Running' : run.status[0].toUpperCase() + run.status.slice(1)}</span> : <div className="stat-val">None</div>}
        <div className="stat-sub" style={{ marginTop: 6 }}>{run ? `${ago(run.finishedAt ?? run.startedAt)}, ${run.matched} new ${run.matched === 1 ? 'match' : 'matches'}` : 'Press Fetch to start'}</div>
      </Card>

      <Card icon="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5L12 3z" label="AI tokens, 24 h">
        <div className="stat-val">{usage ? num(tokens) : ''}</div>
        <div className="meter" role="img" aria-label="Input versus output tokens">
          <i style={{ width: `${tokens ? ((usage?.inputTokens ?? 0) / tokens) * 100 : 0}%`, background: 'var(--accent)' }} />
          <i style={{ width: `${tokens ? ((usage?.outputTokens ?? 0) / tokens) * 100 : 0}%`, background: 'var(--med)' }} />
        </div>
        <div className="stat-sub">{usage ? `${num(usage.inputTokens)} in, ${num(usage.outputTokens)} out${usage.estCostUsd > 0 ? `, ${usd(usage.estCostUsd)}` : ''}` : ''}</div>
      </Card>
    </section>
  );
}
