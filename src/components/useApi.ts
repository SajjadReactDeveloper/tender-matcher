'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api-client';

// GET a JSON endpoint with loading and error state. Pass null to skip. Changing `path` reloads.
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    const t = setTimeout(() => {
      if (!loaded.current) setLoading(true); // a reload keeps what is on screen instead of blanking it
      api(path)
        .then((r) => r.json())
        .then((d) => {
          if (!live) return;
          setData(d as T);
          loaded.current = true;
          setError('');
        })
        .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => live && setLoading(false));
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [path, tick]);

  useEffect(() => {
    loaded.current = false; // a different path is a different page of data
  }, [path]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload };
}
