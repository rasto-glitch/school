import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosResponse } from 'axios';
import type { Paginated } from '../types';

type Fetcher<T> = (cursor: string | null) => Promise<AxiosResponse<Paginated<T>>>;

/**
 * Drives a keyset-paginated list with no data-fetching library.
 * - `items`     accumulated rows across pages
 * - `loadMore`  fetches the next page (no-op when exhausted / in flight)
 * - `setItems`  exposed for optimistic local edits (mark-as-read etc.)
 *
 * A bare-array (legacy) response is tolerated so a backend/web deploy skew
 * can't blank the screen.
 */
export function usePaginated<T>(fetcher: Fetcher<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const apply = (body: Paginated<T> | T[], append: boolean) => {
    const page: T[] = Array.isArray(body) ? body : body.data;
    const next: string | null = Array.isArray(body) ? null : body.nextCursor;
    cursorRef.current = next;
    setHasMore(!!next);
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
      .catch(() => { /* keep what we have; user can retry */ })
      .finally(() => setLoadingMore(false));
  }, [loadingMore]);

  useEffect(() => { reload(); }, [reload]);

  return { items, setItems, loading, loadingMore, error, hasMore, loadMore, reload };
}
