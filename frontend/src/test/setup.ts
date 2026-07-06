// Deterministic in-memory Web Storage for tests. Node 25 ships an experimental
// global localStorage that can shadow jsdom's and lacks the full API, so we
// install a clean polyfill on every test run.
class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number): string | null { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
}

function install(name: 'localStorage' | 'sessionStorage') {
  const store = new MemStorage();
  try {
    Object.defineProperty(globalThis, name, { value: store, configurable: true, writable: true });
  } catch {
    (globalThis as unknown as Record<string, unknown>)[name] = store;
  }
}

install('localStorage');
install('sessionStorage');
