/** Public customer journeys use the approved dark appearance.
 * Ignore legacy public light preferences without changing administrator settings.
 */
export function usePublicJourneyTheme() {
  return { theme: "dark" as const };
}
