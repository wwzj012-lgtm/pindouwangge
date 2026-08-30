import { useState, useEffect } from 'react';

/**
 * Hook to detect whether the viewport is desktop (>= lg, i.e. 1024px) or mobile (< 1024px).
 * Returns true if desktop (>= 1024px), false if mobile/tablet screen.
 */
export function useIsDesktop(breakpoint = 1024): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= breakpoint;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsDesktop(e.matches);
    };

    setIsDesktop(mediaQuery.matches);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [breakpoint]);

  return isDesktop;
}
