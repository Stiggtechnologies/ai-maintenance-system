type BrandWordmarkProps = {
  className?: string;
};

/**
 * Header wordmark — committed transparent PNG (white SyncAI + cyan comet).
 * Sized for the nav row. No background plate; the PNG carries its own alpha.
 */
export function BrandWordmark({ className = "h-9" }: BrandWordmarkProps) {
  return (
    <img
      src="/brand/wordmark-ink.png"
      alt="SyncAI"
      className={`w-auto shrink-0 object-contain ${className}`}
    />
  );
}
