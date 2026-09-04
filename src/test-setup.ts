// Test-env polyfills for jsdom component tests. Guarded on window so node-env
// suites (no window) skip them. Not loaded by the app build.
if (typeof window !== "undefined") {
  // theme.ts calls matchMedia at import; jsdom doesn't implement it.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }

  // The bare `localStorage` global is undefined under jsdom + Node 22; provide a
  // simple in-memory store so auth.tsx (chooseActive/applyActive) works in tests.
  if (!globalThis.localStorage) {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
}
