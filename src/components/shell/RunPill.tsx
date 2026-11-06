'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../api-client';
import { ago } from '../fmt';
import { isActive, type RunSummary } from '../RunBar';

type Pill = RunSummary & { finishedAt?: string | null; startedAt?: string };

// Shows on every page whether a fetch is running, so you can leave the Tenders page while a run works.
export function RunPill() {
  const [run, setRun] = useState<Pill | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let next = 10000;
      try {
        const body = (await (await api('/api/runs')).json()) as { run: Pill | null };
        if (live) setRun(body.run);
        if (isActive(body.run)) next = 4000;
      } catch {
        /* the page itself reports connection problems */
      }
      if (live) timer = setTimeout(tick, next);
    };
    timer = setTimeout(tick, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  const busy = isActive(run ?? null);
  const bad = run?.status === 'failed';
  const text = run === undefined ? 'Checking...' : !run ? 'No runs yet' : busy ? `Fetching (run ${run.id})` : bad ? 'Last run failed' : `Last run ${ago(run.finishedAt ?? run.startedAt)}`;
  return (
    <Link href={run ? `/runs/${run.id}` : '/runs'} className={`pill${busy ? ' busy' : ''}${bad ? ' bad' : ''}`} aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span className="label">{text}</span>
    </Link>
  );
}
