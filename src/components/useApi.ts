'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api-client';

// GET a JSON endpoint with loading and error state. Pass null to skip. Changing `path` reloads.
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    const t = setTimeout(() => {
      setLoading(true);
      api(path)
        .then((r) => r.json())
        .then((d) => {
          if (!live) return;
          setData(d as T);
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

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload };
}
