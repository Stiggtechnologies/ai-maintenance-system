import { useEffect, useState } from "react";
import { FIRST_PAINT_CYCLE_MS } from "../lib/first-paint-seeds";

type RotatingSeedChipProps = {
  questions: readonly string[];
  intervalMs?: number;
  onSelect: (index: number) => void;
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export function RotatingSeedChip({
  questions,
  intervalMs = FIRST_PAINT_CYCLE_MS,
  onSelect,
}: RotatingSeedChipProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const visibleIndex = reducedMotion ? 0 : index;
  const question = questions[visibleIndex] ?? questions[0];

  useEffect(() => {
    if (reducedMotion || paused || questions.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % questions.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [reducedMotion, paused, questions.length, intervalMs]);

  return (
    <button
      type="button"
      className="dw-seed-chip"
      data-testid="sample-seed-chip"
      data-seed-index={String(visibleIndex)}
      aria-label={question}
      onClick={() => onSelect(visibleIndex)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="dw-seed-orb" aria-hidden />
      <span className="dw-seed-chip-stage">
        <span key={visibleIndex} className="dw-seed-chip-copy">
          {question}
        </span>
      </span>
    </button>
  );
}
