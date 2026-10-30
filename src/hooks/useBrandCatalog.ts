import { useEffect, useSyncExternalStore } from 'react';
import { getBrandCatalogSnapshot, refreshBrandCatalog, subscribeBrandCatalog, type BrandCatalogSnapshot } from '../data/brandCatalog';

export function useBrandCatalog(): BrandCatalogSnapshot & { refresh: typeof refreshBrandCatalog } {
  const catalog: BrandCatalogSnapshot = useSyncExternalStore(subscribeBrandCatalog, getBrandCatalogSnapshot, getBrandCatalogSnapshot);
  useEffect(() => {
    if (getBrandCatalogSnapshot().status === 'loading') void refreshBrandCatalog();
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshBrandCatalog({ background: true });
    };
    const online = () => void refreshBrandCatalog({ background: true, force: true });
    // A backend can recover without the browser firing "online".
    const timer = window.setInterval(() => {
      if (getBrandCatalogSnapshot().origin !== 'live') refresh();
    }, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', online);
      window.clearInterval(timer);
    };
  }, []);
  return { ...catalog, refresh: refreshBrandCatalog };
}
