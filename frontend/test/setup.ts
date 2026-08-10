import "@testing-library/jest-dom/vitest";

// Node 25's built-in `localStorage` global (unflagged, requires
// --localstorage-file) shadows jsdom's own working implementation and is a
// non-functional stub without that flag -- getItem/setItem/etc. are all
// undefined. Replace it with a plain in-memory Storage for tests only; the
// real browser localStorage in production is unaffected by this.
class InMemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new InMemoryStorage(),
});
