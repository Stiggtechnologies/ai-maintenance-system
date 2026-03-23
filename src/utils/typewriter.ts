export function createTypewriterEffect(
  text: string,
  onUpdate: (displayedText: string) => void,
  onComplete?: () => void,
  speed: number = 18
) {
  let currentIndex = 0;

  const interval = setInterval(() => {
    if (currentIndex < text.length) {
      currentIndex++;
      onUpdate(text.slice(0, currentIndex));
    } else {
      clearInterval(interval);
      onComplete?.();
    }
  }, speed);

  return () => clearInterval(interval);
}
