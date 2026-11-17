type BrandWordmarkProps = {
  className?: string;
};

/**
 * Shared precision wordmark for the app's dark chrome.
 * External outlined SVG from the approved graphite/brass package; no font dependency.
 */
export function BrandWordmark({ className = "h-9" }: BrandWordmarkProps) {
  return (
    <img
      src="/brand/syncai-wordmark-light.svg"
      alt="SyncAI"
      width={843}
      height={224}
      className={`w-auto shrink-0 object-contain ${className}`}
    />
  );
}
