import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Refetch when a screen regains focus, but only if it has been blurred
 * (navigated away from) for at least `staleMs`.
 *
 * Pairs with `detachInactiveScreens={false}` on the tab navigators: tab
 * screens now stay warm (which is what fixes the blank-on-fast-switch race),
 * so this is what makes a returned-to tab show fresh data instead of
 * last-loaded data — without ever unmounting the screen.
 *
 * `refetch` may be an inline / non-memoized function: it is read through a
 * ref, so the focus subscription never churns and never loops while focused.
 * The first focus (mount) is intentionally skipped — the screen's own
 * mount-time fetch already covers the initial load. Pass a *silent* refetch
 * (no full-screen loading/skeleton toggle) so returning never flashes.
 */
export function useRefreshOnFocus(refetch: () => unknown, staleMs = 60_000) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const blurredAt = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (blurredAt.current !== null && Date.now() - blurredAt.current >= staleMs) {
        refetchRef.current();
      }
      blurredAt.current = null;
      return () => {
        blurredAt.current = Date.now();
      };
    }, [staleMs]),
  );
}
