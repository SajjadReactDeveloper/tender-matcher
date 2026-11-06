'use client';

import { useEffect, useRef, useState } from 'react';

export interface RunSummary {
  id: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  screened: number;
  matched: number;
  error: string | null;
}
export interface LogLine {
  at: string;
  message: string;
}

interface Props {
  loading: boolean;
  run: RunSummary | null;
  logs: LogLine[];
  matchedTotal: number;
  offline: string;
  onStop: () => void;
}

export const isActive = (run: RunSummary | null): boolean => run?.status === 'running' || run?.status === 'queued';

export function RunBar({ loading, run, logs, matchedTotal, offline, onStop }: Props) {
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const active = isActive(run);
  const last = logs.length ? logs[logs.length - 1].message.trim() : '';

  useEffect(() => {
    const el = logRef.current;
    if (el && showLog) el.scrollTop = el.scrollHeight;
  }, [logs, showLog]);

  let msg: React.ReactNode;
  if (loading) msg = <span className="sk" style={{ width: 240, height: 14 }} aria-label="Loading" />;
  else if (offline) msg = <span role="alert">{offline}</span>;
  else if (active) msg = (<><i className="spin" /><span>{last || 'Starting...'}</span></>);
  else if (run?.status === 'failed' && run.error) msg = <span role="alert">{run.error}</span>;
  else if (run?.status === 'cancelled') msg = <span>Last run was stopped. {matchedTotal} matched tenders.</span>;
  else msg = <span>{matchedTotal} matched tenders{run ? ` (last run screened ${run.screened}, matched ${run.matched})` : ''}.</span>;

  const cls = 'runbar' + (active ? ' busy' : run?.status === 'failed' || offline ? ' err' : '');
  return (
    <>
      <section className={cls} id="runbar" aria-live="polite">
        <div className="msg" id="runmsg">
          {msg}
        </div>
        <div>
          {active && (
            <button type="button" className="link" onClick={onStop}>
              Stop run
            </button>
          )}{' '}
          {logs.length > 0 && (
            <button type="button" className="link" onClick={() => setShowLog((s) => !s)}>
              {showLog ? 'Hide log' : 'Show log'}
            </button>
          )}
        </div>
      </section>
      {showLog && logs.length > 0 && (
        <pre id="log" ref={logRef}>
          {logs.map((l) => l.message).join('\n')}
        </pre>
      )}
    </>
  );
}
