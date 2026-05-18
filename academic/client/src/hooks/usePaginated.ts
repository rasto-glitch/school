import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosResponse } from 'axios';
import type { Paginated } from '../types';

type Fetcher<T> = (cursor: string | null) => Promise<AxiosResponse<Paginated<T>>>;

/**
 * Keyset-paginated list with seamless auto-load (no library). Attach
 * `sentinelRef` to an element at the end of the list; the next page fetches
 * 600px before it scrolls into view. Tolerates a legacy bare-array body so
 * a backend/client deploy skew can't blank the screen.
 */
export function usePaginated<T>(fetcher: Fetcher<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const apply = (body: Paginated<T> | T[], append: boolean) => {
    const page: T[] = Array.isArray(body) ? body : body.data;
    cursorRef.current = Array.isArray(body) ? null : body.nextCursor;
    setItems(prev => (append ? [...prev, ...page] : page));
  };

  const reload = useCallback(() => {
    cursorRef.current = null;
    setError(false);
    setLoading(true);
    fetcherRef.current(null)
      .then(r => apply(r.data, false))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMore || !cursorRef.current) return;
    setLoadingMore(true);
    fetcherRef.current(cursorRef.current)
      .then(r => apply(r.data, true))
      .catch(() => { /* keep what we have; next scroll retries */ })
      .finally(() => setLoadingMore(false));
  }, [loadingMore]);

  useEffect(() => { reload(); }, [reload]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      entries => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observerRef.current.observe(node);
  }, [loadMore]);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { items, setItems, loading, loadingMore, error, loadMore, reload, sentinelRef };
}
