import type { StateStorage } from "zustand/middleware";

/*
 * Persistence abstraction. The app talks to a KeyValueStore; today that's localStorage
 * (with an in-memory fallback for SSR, private mode or quota errors). Swapping in
 * IndexedDB, a REST API or SQLite-over-HTTP means implementing these three methods.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

class BrowserStore implements KeyValueStore {
  private fallback = new MemoryStore();
  private get ls(): Storage | null {
    try {
      return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
      return null;
    }
  }
  getItem(key: string) {
    try {
      return this.ls?.getItem(key) ?? this.fallback.getItem(key);
    } catch {
      return this.fallback.getItem(key);
    }
  }
  setItem(key: string, value: string) {
    try {
      if (this.ls) this.ls.setItem(key, value);
      else this.fallback.setItem(key, value);
    } catch {
      this.fallback.setItem(key, value);
    }
  }
  removeItem(key: string) {
    try {
      this.ls?.removeItem(key);
    } catch {
      /* ignore */
    }
    this.fallback.removeItem(key);
  }
}

export const kv: KeyValueStore = new BrowserStore();

export const zustandStorage: StateStorage = {
  getItem: (name) => kv.getItem(name),
  setItem: (name, value) => kv.setItem(name, value),
  removeItem: (name) => kv.removeItem(name),
};

export const STORAGE_KEY = "sentinel:workspace:v1";
