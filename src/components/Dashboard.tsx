'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TenderView } from '@/domain/types';
import { api } from './api-client';
import { daysLeft, isOpen } from './format';
import { RunBar, isActive, type LogLine, type RunSummary } from './RunBar';
import { Runway } from './Runway';
import { TenderList } from './TenderList';
import { StatRow } from './StatRow';
import { ToastProvider, useToast } from './Toasts';

const REL: [string, string][] = [['', 'All'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function DashboardInner() {
  const { toast } = useToast();
  const [tenders, setTenders] = useState<TenderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [rel, setRel] = useState('');
  const [when, setWhen] = useState('open');
  const [sort, setSort] = useState('closing');
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [run, setRun] = useState<RunSummary | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [runLoaded, setRunLoaded] = useState(false);
  const [offline, setOffline] = useState('');
  const [limit, setLimit] = useState('150');
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const wasActive = useRef(false);
  const lastMatched = useRef(0);
  const offlineRef = useRef(false);
  const scrollTo = useRef(false);

  const loadTenders = useCallback(async () => {
    try {
      setTenders((await (await api('/api/tenders')).json()) as TenderView[]);
      setLoadError('');
    } catch (e) {
      setLoadError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const body = (await (await api('/api/runs')).json()) as { run: RunSummary | null; logs: LogLine[] };
      if (offlineRef.current) {
        offlineRef.current = false;
        setOffline('');
        toast('Reconnected.');
      }
      const active = isActive(body.run);
      if (wasActive.current && !active) {
        if (body.run?.status === 'failed') toast(`Run failed: ${body.run.error ?? 'unknown error'}`, 'err');
        else if (body.run?.status === 'cancelled') toast('Run stopped.');
        else toast(`Run finished. ${body.run?.matched ?? 0} new matches.`);
        void loadTenders();
      } else if (active && body.run && body.run.matched !== lastMatched.current) {
        void loadTenders();
      }
      lastMatched.current = body.run?.matched ?? 0;
      wasActive.current = active;
      setRun(body.run);
      setLogs(body.logs);
      setRunLoaded(true);
    } catch (e) {
      if (!offlineRef.current) toast(message(e), 'err');
      offlineRef.current = true;
      setOffline(message(e));
      setRunLoaded(true);
    }
  }, [toast, loadTenders]);

  const active = isActive(run);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadTenders();
      void poll();
    }, 0); // deferred a tick: the first load sets state, which must not happen synchronously in an effect
    return () => clearTimeout(t);
  }, [loadTenders, poll]);

  useEffect(() => {
    const id = setInterval(poll, active ? 3000 : 15000);
    return () => clearInterval(id);
  }, [poll, active]);

  useEffect(() => {
    if (openId !== null && scrollTo.current) {
      scrollTo.current = false;
      document.querySelector(`.item[data-id="${openId}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
  }, [openId]);

  const sources = useMemo(() => [...new Set(tenders.map((t) => t.source))], [tenders]);

  const base = useMemo(
    () => tenders.filter((t) => (!source || t.source === source) && (when === 'all' || isOpen(t))),
    [tenders, source, when],
  );
  const visible = useMemo(() => {
    const needle = q.toLowerCase().trim();
    const closed = (t: TenderView) => daysLeft(t.lastDate) < 0;
    const by: Record<string, (a: TenderView, b: TenderView) => number> = {
      closing: (a, b) => Number(closed(a)) - Number(closed(b)) || a.lastDate.localeCompare(b.lastDate),
      fit: (a, b) => b.score - a.score,
      posted: (a, b) => b.postingDate.localeCompare(a.postingDate),
    };
    return base
      .filter((t) => (when !== '7' || !t.lastDate || daysLeft(t.lastDate) <= 7) && (!rel || t.relevance === rel) && (!needle || [t.name, t.department, t.scope, t.refNo, t.recommendation].join(' ').toLowerCase().includes(needle)))
      .sort(by[sort] ?? by.closing);
  }, [base, q, rel, sort, when]);

  const count = (r: string) => base.filter((t) => !r || t.relevance === r).length;

  const start = async () => {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 3000) return toast('Enter a whole number from 1 to 3000.', 'err');
    setStarting(true);
    try {
      await api('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: n }) });
      toast(`Run started. Scanning up to ${n} new tenders.`);
    } catch (e) {
      toast(message(e), 'err');
    }
    setStarting(false);
    void poll();
  };

  const stop = async () => {
    try {
      const { forced } = (await (await api('/api/runs/stop', { method: 'POST' })).json()) as { forced: boolean };
      toast(forced ? 'Run force-stopped.' : 'Stopping after the current step. Press Force stop if it does not stop.');
      void poll();
    } catch (e) {
      toast(message(e), 'err');
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const url = URL.createObjectURL(await (await api('/api/export')).blob());
      Object.assign(document.createElement('a'), { href: url, download: 'tenders.xlsx' }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Excel file downloaded.');
    } catch (e) {
      toast(`Download failed: ${message(e)}`, 'err');
    }
    setDownloading(false);
  };

  const retry = () => {
    setLoading(true);
    setLoadError('');
    void loadTenders();
  };

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Tenders</h1>
          <p>Active tenders, matched to Funavry</p>
        </div>
        <div className="controls">
          <label className="scan">
            Scan up to <input type="number" value={limit} min={1} max={3000} onChange={(e) => setLimit(e.target.value)} /> new tenders
          </label>
          <button type="button" className="btn primary" onClick={start} disabled={active || starting}>
            {active || starting ? 'Running...' : 'Fetch latest tenders'}
          </button>
          <button type="button" className="btn" onClick={download} disabled={downloading}>
            {downloading ? 'Preparing...' : 'Download Excel'}
          </button>
        </div>
      </div>

      <StatRow tenders={tenders} run={run} loading={loading} />

      <RunBar loading={!runLoaded} run={run} logs={logs} matchedTotal={tenders.length} offline={offline} onStop={stop} />

      <Runway
        tenders={base}
        loading={loading}
        onPick={(id) => {
          setRel('');
          scrollTo.current = true;
          setOpenId(id);
        }}
      />

      <div className="filters">
        <div className="seg" id="relseg" role="group" aria-label="Relevance">
          {REL.map(([v, l]) => (
            <button type="button" key={v} aria-pressed={rel === v} onClick={() => setRel(v)}>
              {l}
              <b>{loading ? '' : count(v)}</b>
            </button>
          ))}
        </div>
        {sources.length > 1 && (
          <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Closing date" value={when} onChange={(e) => setWhen(e.target.value)}>
          <option value="open">Still open</option>
          <option value="7">Closing in 7 days</option>
          <option value="all">Include closed</option>
        </select>
        <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="closing">Closing soonest</option>
          <option value="fit">Best fit first</option>
          <option value="posted">Newest posted</option>
        </select>
        <input type="search" placeholder="Search name, department or scope" aria-label="Search tenders" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <TenderList tenders={visible} hasAny={tenders.length > 0} loading={loading} error={loadError} openId={openId} onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))} onRetry={retry} />
    </div>
  );
}

export function Dashboard() {
  return (
    <ToastProvider>
      <DashboardInner />
    </ToastProvider>
  );
}
