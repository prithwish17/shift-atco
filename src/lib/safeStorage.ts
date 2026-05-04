const memoryStorage = new Map<string, string>();

let cachedStorage: Storage | null | undefined;

function resolveBrowserStorage(): Storage | null {
  if (cachedStorage !== undefined) {
    return cachedStorage;
  }

  if (typeof window === "undefined") {
    cachedStorage = null;
    return cachedStorage;
  }

  try {
    const storage = window.localStorage;
    const probeKey = "__shift_storage_probe__";
    storage.setItem(probeKey, probeKey);
    storage.removeItem(probeKey);
    cachedStorage = storage;
    return cachedStorage;
  } catch {
    cachedStorage = null;
    return cachedStorage;
  }
}

export const safeStorage = {
  getItem(key: string): string | null {
    const storage = resolveBrowserStorage();
    if (storage) {
      return storage.getItem(key);
    }

    return memoryStorage.get(key) ?? null;
  },

  setItem(key: string, value: string): void {
    const storage = resolveBrowserStorage();
    if (storage) {
      storage.setItem(key, value);
      return;
    }

    memoryStorage.set(key, value);
  },

  removeItem(key: string): void {
    const storage = resolveBrowserStorage();
    if (storage) {
      storage.removeItem(key);
      return;
    }

    memoryStorage.delete(key);
  },
};