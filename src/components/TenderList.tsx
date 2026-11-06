'use client';

import type { CSSProperties } from 'react';
import type { TenderView } from '@/domain/types';
import { colorClass, daysLeft, fmt, safeHref, verdictOf, whyOf } from './format';
import { SkeletonRows } from './Skeleton';

interface Props {
  tenders: TenderView[];
  hasAny: boolean; // there are tenders, so an empty list means the filters hid them
  loading: boolean;
  error: string;
  openId: number | null;
  onToggle: (id: number) => void;
  onRetry: () => void;
}

function Item({ t, open, onToggle }: { t: TenderView; open: boolean; onToggle: (id: number) => void }) {
  const d = daysLeft(t.lastDate);
  const v = verdictOf(t);
  const rc = colorClass(t.relevance);
  const when = !t.lastDate ? { cls: '', head: 'No closing date', sub: '' } : d < 0 ? { cls: 'closed', head: 'Closed', sub: '' } : { cls: d <= 3 ? 'soon' : '', head: fmt(t.lastDate), sub: d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days` };
  const facts: [string, string][] = (
    [
      ['Closes', `${fmt(t.lastDate)} ${t.closingTime}`.trim()],
      ['Posted', t.postingDate ? fmt(t.postingDate) : ''],
      ['Type', [t.type, t.nature, t.category].filter(Boolean).join(', ')],
      ['Procedure', t.procedure],
      ['Bid security', t.bidSecurity],
      ['Bid validity', t.bidValidity],
      ['Contact', t.contact],
      ['Tender no.', t.refNo],
    ] as [string, string][]
  ).filter(([, x]) => x);
  const page = safeHref(t.url);
  const ad = safeHref(t.docs.advertisement);
  const doc = safeHref(t.docs.tender);

  return (
    <article className={`item ${rc}${open ? ' open' : ''}`} data-id={t.id}>
      <button type="button" className="row" aria-expanded={open} onClick={() => onToggle(t.id)}>
        <span className={`ring ${rc}`} style={{ '--s': Number(t.score) || 0 } as CSSProperties} title={`Fit score ${t.score} out of 100, relevance ${t.relevance}`}>
          <b>{t.score}</b>
        </span>
        <span>
          <span className="title">{t.name}</span>
          <span className="meta">{t.department}</span>
        </span>
        <span className={`when ${when.cls}`}>
          <b>{when.head}</b>
          <small>{when.sub}</small>
        </span>
        <span className="verdict">
          {v && <span className={`chip ${v}`}>{v}</span>}
          <span className="why">{whyOf(t)}</span>
        </span>
      </button>
      {open && (
        <div className="detail">
          <div className="story">
            <h3>Recommendation</h3>
            <p>{whyOf(t)}</p>
            <h3>Scope</h3>
            <p>{t.scope}</p>
            <h3>Dependencies and challenges</h3>
            <p>{t.challenges}</p>
          </div>
          <div className="facts">
            <h3>Details</h3>
            <dl>
              {facts.map(([k, x]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
                  <dd>{x}</dd>
                </div>
              ))}
            </dl>
            <div className="docs">
              {page && (
                <a href={page} target="_blank" rel="noopener noreferrer">
                  PPRA page
                </a>
              )}
              {ad && (
                <a href={ad} target="_blank" rel="noopener noreferrer" title="Opens the advertisement PDF">
                  Advertisement
                </a>
              )}
              {doc && (
                <a href={doc} target="_blank" rel="noopener noreferrer" title="Opens the tender document PDF">
                  Tender document
                </a>
              )}
            </div>
            <p className="note">
              Score, scope and recommendation are AI estimates from {t.docs.pagesRead} scanned page{t.docs.pagesRead === 1 ? '' : 's'}. Check the documents before you bid.
            </p>
          </div>
        </div>
      )}
    </article>
  );
}

export function TenderList({ tenders, hasAny, loading, error, openId, onToggle, onRetry }: Props) {
  return (
    <div className="list" id="list" aria-busy={loading}>
      {loading ? (
        <SkeletonRows />
      ) : error ? (
        <div className="empty error" role="alert">
          <b>Could not load tenders</b>
          {error}
          <br />
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : tenders.length ? (
        tenders.map((t) => <Item key={t.id} t={t} open={openId === t.id} onToggle={onToggle} />)
      ) : hasAny ? (
        <div className="empty">
          <b>Nothing matches these filters</b>Clear the search or widen the closing date.
        </div>
      ) : (
        <div className="empty">
          <b>No matched tenders yet</b>Fetch the latest tenders to screen new notices against the Funavry profile.
        </div>
      )}
    </div>
  );
}
