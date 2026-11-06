'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TenderView } from '@/domain/types';
import { DAY, daysLeft, fmt, midnight } from './format';

export const SPAN = 30; // days shown, today included

export interface DayBucket {
  iso: string;
  d: number;
  High: number;
  Medium: number;
  Low: number;
  items: TenderView[];
}

const isoOf = (d: number) => new Date(midnight().getTime() + d * DAY).toLocaleDateString('en-CA');

// Open tenders grouped by closing day for the next SPAN days. `later` counts the ones that close after that.
export function bucketByDay(tenders: TenderView[]): { days: DayBucket[]; later: number } {
  const days: DayBucket[] = Array.from({ length: SPAN }, (_, d) => ({ iso: isoOf(d), d, High: 0, Medium: 0, Low: 0, items: [] }));
  let later = 0;
  for (const t of tenders) {
    if (!t.lastDate) continue;
    const d = daysLeft(t.lastDate);
    if (d < 0) continue;
    if (d >= SPAN) {
      later++;
      continue;
    }
    const b = days[d];
    b[t.relevance === 'High' || t.relevance === 'Medium' ? t.relevance : 'Low']++;
    b.items.push(t);
  }
  for (const b of days) b.items.sort((a, c) => c.score - a.score);
  return { days, later };
}

const niceMax = (n: number) => Math.max(3, n);

interface Props {
  tenders: TenderView[];
  loading: boolean;
  selected: string; // ISO day or ''
  onPick: (iso: string) => void;
}

const H = 220;
const PAD = { l: 34, r: 12, t: 14, b: 30 };
const SEGS = ['High', 'Medium', 'Low'] as const;

// Stacked columns, one per closing day: height is how many tenders close that day, colour is relevance.
// Click a column to filter the list to that day.
export function ClosingChart({ tenders, loading, selected, onPick }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 900));
    ro.observe(el);
    setWidth(el.clientWidth || 900);
    return () => ro.disconnect();
  }, [loading]);

  const { days, later } = useMemo(() => bucketByDay(tenders), [tenders]);
  const inRange = days.reduce((a, b) => a + b.items.length, 0);
  if (!loading && inRange === 0 && later === 0) return null;

  const plotW = width - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const slot = plotW / SPAN;
  const barW = Math.max(6, slot * 0.66);
  const peak = niceMax(Math.max(0, ...days.map((b) => b.items.length)));
  const y = (n: number) => PAD.t + plotH - (n / peak) * plotH;
  const x = (d: number) => PAD.l + d * slot;
  const yTicks = peak <= 6 ? Array.from({ length: peak + 1 }, (_, i) => i) : [0, Math.round(peak / 2), peak];
  const xTicks = [0, 7, 14, 21, 28];
  const totals = SEGS.map((s) => days.reduce((a, b) => a + b[s], 0));

  const key = (e: KeyboardEvent, iso: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(selected === iso ? '' : iso);
    }
  };
  const tip = hover !== null ? days[hover] : null;

  return (
    <section className="card chart" aria-label="Tenders closing in the next 30 days">
      <div className="chart-head">
        <div>
          <h2>Closing in the next 30 days</h2>
          <p>{loading ? '' : `${inRange} tender${inRange === 1 ? '' : 's'} close in this window${later ? `, ${later} more later` : ''}. Click a column to filter the list.`}</p>
        </div>
        <div className="legend" aria-hidden="true">
          {SEGS.map((s, i) => (
            <span key={s}>
              <i style={{ background: `var(--${s === 'High' ? 'high' : s === 'Medium' ? 'med' : 'low'})`, opacity: s === 'Low' ? 0.7 : 1 }} />
              {s} {loading ? '' : totals[i]}
            </span>
          ))}
        </div>
      </div>
      <div className="chart-body" onMouseLeave={() => setHover(null)}>
        <svg ref={ref} role="group" viewBox={`0 0 ${width} ${H}`} style={loading ? { visibility: 'hidden' } : undefined}>
          {!loading && (
            <>
              {yTicks.map((n) => (
                <g key={n}>
                  <line className={n === 0 ? 'axis' : 'grid'} x1={PAD.l} x2={width - PAD.r} y1={y(n)} y2={y(n)} />
                  <text x={PAD.l - 8} y={y(n) + 4} textAnchor="end">
                    {n}
                  </text>
                </g>
              ))}
              {xTicks.map((d) => (
                <text key={d} x={x(d) + slot / 2} y={H - 8} textAnchor="middle">
                  {d === 0 ? 'Today' : fmt(isoOf(d))}
                </text>
              ))}
              <line className="today" x1={x(0) + slot / 2} x2={x(0) + slot / 2} y1={PAD.t} y2={y(0)} />
              {days.map((b) => {
                const n = b.items.length;
                const on = selected === b.iso;
                let top = y(0);
                const segs = SEGS.map((s) => {
                  const h = (b[s] / peak) * plotH;
                  top -= h;
                  return { s, h, y: top };
                }).filter((g) => g.h > 0);
                const bx = x(b.d) + (slot - barW) / 2;
                return (
                  <g
                    key={b.iso}
                    className={`bar${on ? ' on' : ''}`}
                    {...(n
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          'aria-label': `${fmt(b.iso)}: ${n} tender${n === 1 ? '' : 's'} closing${on ? ', selected' : ''}`,
                          'aria-pressed': on,
                          onClick: () => onPick(on ? '' : b.iso),
                          onKeyDown: (e: KeyboardEvent) => key(e, b.iso),
                          onMouseEnter: () => setHover(b.d),
                          onFocus: () => setHover(b.d),
                          onBlur: () => setHover(null),
                        }
                      : {})}
                  >
                    <rect className="hit" x={x(b.d)} y={PAD.t} width={slot} height={plotH} />
                    {segs.map((g) => (
                      <rect key={g.s} className={`seg ${g.s}`} x={bx} y={g.y} width={barW} height={Math.max(2, g.h - 1)} rx={3} />
                    ))}
                  </g>
                );
              })}
            </>
          )}
        </svg>
        {tip && tip.items.length > 0 && (
          <div className="tip" style={{ left: Math.min(Math.max(x(tip.d) + slot / 2, 150), width - 150), top: y(tip.items.length) + 4 }} role="tooltip">
            <b>
              {fmt(tip.iso)}: {tip.items.length} closing
            </b>
            <ul>
              {tip.items.slice(0, 4).map((t) => (
                <li key={t.id}>
                  <span>{t.name}</span>
                  <em>{t.score}</em>
                </li>
              ))}
              {tip.items.length > 4 && <li>and {tip.items.length - 4} more</li>}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
