import { useEffect, useState } from "react";

const THEME_KEY = "syncai-public-theme";
const THEME_EVENT = "syncai-public-theme-change";
function readTheme() {
  try {
    return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function usePublicJourneyTheme() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const update = (event: Event) =>
      setTheme(
        event instanceof CustomEvent &&
          (event.detail === "light" || event.detail === "dark")
          ? event.detail
          : readTheme(),
      );
    window.addEventListener(THEME_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(THEME_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Appearance remains usable when storage is blocked. */
    }
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
  };
  return { theme, toggleTheme };
}
