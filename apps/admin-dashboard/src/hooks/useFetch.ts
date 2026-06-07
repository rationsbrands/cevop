import { useState, useEffect, useCallback, useRef } from 'react';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Fire-and-forget data fetcher — refetch() re-runs on demand
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      if (mountedRef.current) setState({ data, loading: false, error: null });
    } catch (err) {
      if (mountedRef.current)
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Error',
        });
    }
  }, []);

  const lastDepsKeyRef = useRef<string>('');

  useEffect(() => {
    mountedRef.current = true;
    const currentDepsKey = JSON.stringify(deps);
    if (currentDepsKey !== lastDepsKeyRef.current) {
      lastDepsKeyRef.current = currentDepsKey;
      // Delay execution to avoid "cascading renders" lint error and ensure safe state update
      Promise.resolve().then(() => {
        if (mountedRef.current) run();
      });
    }
    return () => {
      mountedRef.current = false;
    };
  });

  return { ...state, refetch: run };
}
