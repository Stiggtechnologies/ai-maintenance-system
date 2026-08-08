import "@testing-library/jest-dom";

/**
 * Web Storage polyfill for the test environment.
 *
 * Node 22+ exposes a native `localStorage` global. When Node is started
 * without `--localstorage-file` that global is an inert stub with no methods,
 * and because it already exists on `globalThis` it shadows the working
 * implementation jsdom would otherwise provide. Tests that call
 * `localStorage.clear()` then fail with "clear is not a function" — on the
 * developer's machine or CI, depending on the Node version in use.
 *
 * Installing a spec-shaped in-memory Storage keeps the suite deterministic
 * across Node versions instead of depending on runtime flags.
 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(String(key)) ?? null,
    setItem: (key: string, value: string) => {
      map.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      map.delete(String(key));
    },
    clear: () => {
      map.clear();
    },
  } as Storage;
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  const existing = (globalThis as unknown as Record<string, unknown>)[name] as
    Storage | undefined;
  if (!existing || typeof existing.clear !== "function") {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: createMemoryStorage(),
    });
    if (typeof window !== "undefined") {
      Object.defineProperty(window, name, {
        configurable: true,
        writable: true,
        value: (globalThis as unknown as Record<string, Storage>)[name],
      });
    }
  }
}
