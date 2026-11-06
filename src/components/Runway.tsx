'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TenderView } from '@/domain/types';
import { DAY, colorClass, daysLeft, fmt, midnight } from './format';

const SPAN = 30; // days shown
const H = 150;
const PAD = 26;

interface Props {
  tenders: TenderView[];
  loading: boolean;
  onPick: (id: number) => void;
}

// Closing dates for the next 30 days: taller pins fit better, colour is relevance.
export function Runway({ tenders, loading, onPick }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 900));
    ro.observe(el);
    setWidth(el.clientWidth || 900);
    return () => ro.disconnect();
  }, [loading]);

  const open = useMemo(() => tenders.filter((t) => t.lastDate && daysLeft(t.lastDate) >= 0), [tenders]);
  if (!loading && !open.length) return null;

  const base = H - 34;
  const x = (d: number) => PAD + (Math.min(d, SPAN) / SPAN) * (width - PAD * 2);
  const ticks = [7, 14, 21, 28].map((d) => ({ d, label: fmt(new Date(midnight().getTime() + d * DAY).toLocaleDateString('en-CA')) }));
  const slots: Record<number, number> = {};
  let later = 0;
  const pins = [...open]
    .sort((a, b) => a.score - b.score)
    .flatMap((t) => {
      const d = daysLeft(t.lastDate);
      if (d > SPAN) {
        later++;
        return [];
      }
      const k = (slots[d] = (slots[d] ?? 0) + 1) - 1;
      return [{ t, cx: x(d) + k * 15, h: 14 + (t.score / 100) * (base - 34) }];
    });

  const onKey = (e: KeyboardEvent, id: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(id);
    }
  };

  return (
    <section className="runway" id="runwaybox" aria-label="Closing dates for the next 30 days">
      <div className="runway-head">
        <h2>Closing in the next 30 days</h2>
        <p id="runway-note">{loading ? <span className="sk" style={{ height: 12, width: 140 }} /> : `Taller pins fit better${later ? `. ${later} more close later.` : '.'}`}</p>
      </div>
      <svg ref={ref} id="runway-svg" role="group" viewBox={`0 0 ${width} ${H}`} style={loading ? { visibility: 'hidden' } : undefined}>
        {!loading && (
          <>
            <line className="axis" x1={PAD} x2={width - PAD} y1={base} y2={base} />
            {ticks.map(({ d, label }) => (
              <g key={d}>
                <line className="tick" x1={x(d)} x2={x(d)} y1={base} y2={base + 6} />
                <text x={x(d)} y={H - 8} textAnchor="middle">
                  {label}
                </text>
              </g>
            ))}
            <line className="now" x1={x(0)} x2={x(0)} y1={14} y2={base} />
            <text className="now-label" x={x(0) + 6} y={H - 8}>
              Today
            </text>
            {pins.map(({ t, cx, h }) => (
              <g
                key={t.id}
                className={`pin ${colorClass(t.relevance)}`}
                tabIndex={0}
                role="button"
                aria-label={`${t.name}, closes ${fmt(t.lastDate)}, score ${t.score}`}
                onClick={() => onPick(t.id)}
                onKeyDown={(e) => onKey(e, t.id)}
              >
                <title>{`${t.name}\nCloses ${fmt(t.lastDate)}, score ${t.score}`}</title>
                <line className="stem" x1={cx} x2={cx} y1={base} y2={base - h} />
                <circle className="dot" cx={cx} cy={base - h} r={8} />
              </g>
            ))}
          </>
        )}
      </svg>
    </section>
  );
}
