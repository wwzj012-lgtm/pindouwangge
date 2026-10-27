import { useEffect, useSyncExternalStore } from 'react';
import { getBrandCatalogSnapshot, refreshBrandCatalog, subscribeBrandCatalog, type BrandCatalogSnapshot } from '../data/brandCatalog';

export function useBrandCatalog(): BrandCatalogSnapshot & { refresh: typeof refreshBrandCatalog } {
  const catalog: BrandCatalogSnapshot = useSyncExternalStore(subscribeBrandCatalog, getBrandCatalogSnapshot, getBrandCatalogSnapshot);
  useEffect(() => {
    if (getBrandCatalogSnapshot().status === 'loading') void refreshBrandCatalog();
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshBrandCatalog();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return { ...catalog, refresh: refreshBrandCatalog };
}
