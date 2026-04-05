export function useAnalytics() {
  const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID;

  const trackEvent = (eventName: string, params?: Record<string, unknown>) => {
    if (gaId && typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', eventName, params);
    }
  };
  const trackPageView = (page: string) => {
    if (gaId && typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('config', gaId, { page_path: page });
    }
  };
  return { trackEvent, trackPageView };
}
