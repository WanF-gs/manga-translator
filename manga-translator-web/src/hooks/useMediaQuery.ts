'use client';

import { useState, useEffect } from 'react';

/**
 * A custom hook that detects whether a CSS media query matches.
 * Returns false during SSR and updates on mount + resize.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches); // sync on mount (handles SSR mismatch)
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
