'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type Kind = 'ok' | 'err';
interface ToastItem {
  id: number;
  message: string;
  kind: Kind;
}
interface ToastApi {
  toast: (message: string, kind?: Kind) => void;
}

const Ctx = createContext<ToastApi>({ toast: () => {} });
export const useToast = (): ToastApi => useContext(Ctx);

const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: Kind = 'ok') => {
      const id = nextId.current++;
      setItems((cur) => [...cur.slice(-(MAX_VISIBLE - 1)), { id, message, kind }]);
      timers.current.set(id, setTimeout(() => dismiss(id), kind === 'err' ? 8000 : 4500));
    },
    [dismiss],
  );

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div id="toasts" role="region" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={'toast' + (t.kind === 'err' ? ' err' : '')} role={t.kind === 'err' ? 'alert' : 'status'}>
            <span>{t.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              &times;
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
