/**
 * Offline queue for field measurements.
 * Everything is captured on-device (IndexedDB) and uploaded later:
 * photo -> Drive, row -> Sheet, reading -> database.
 */

export type QueueStatus =
  | "pending" // ready to upload
  | "needs-ai" // saved without values, AI must read the photo first
  | "review" // AI filled the values, waiting for the technician to confirm
  | "error"; // last upload attempt failed

export type QueuedReading = {
  id: string;
  projectId: string;
  projectLabel: string;
  odbName: string;
  nm1490: number | null;
  nm1550: number | null;
  unit: string;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  photo: string; // stamped data URL
  createdAt: string;
  status: QueueStatus;
  error: string | null;
  attempts: number;
  aiFilled: boolean;
};

const DB_NAME = "proconect-field-queue";
const STORE = "queue";
const PROJECTS_KEY = "proconect.field.projects";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB indisponibil"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Operație eșuată"));
    t.oncomplete = () => db.close();
  });
}

export async function listQueue(): Promise<QueuedReading[]> {
  if (typeof indexedDB === "undefined") return [];
  const rows = await tx<QueuedReading[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedReading[]>);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putQueued(item: QueuedReading): Promise<void> {
  await tx("readwrite", (s) => s.put(item) as IDBRequest<IDBValidKey>);
}

export async function removeQueued(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

/** Keeps the assigned project list readable while offline. */
export function cacheProjects(list: Array<{ id: string; name: string; code: string | null }>) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable */
  }
}

export function cachedProjects(): Array<{ id: string; name: string; code: string | null }> {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Array<{ id: string; name: string; code: string | null }>) : [];
  } catch {
    return [];
  }
}

export function statusLabel(status: QueueStatus): string {
  switch (status) {
    case "pending":
      return "În aşteptare";
    case "needs-ai":
      return "Fără valori — se citesc la semnal";
    case "review":
      return "Valori AI — confirmă";
    case "error":
      return "Trimitere eşuată";
  }
}
