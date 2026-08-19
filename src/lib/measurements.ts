export type Measurement = {
  id: string;
  createdAt: string;
  label: string;
  nm1490: number | null;
  nm1550: number | null;
  unit: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  photo: string; // data URL (jpeg)
  aiNotes: string | null;
};

const DB_NAME = "fiber-field-log";
const STORE = "measurements";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listMeasurements(): Promise<Measurement[]> {
  const all = await tx<Measurement[]>("readonly", (s) => s.getAll() as IDBRequest<Measurement[]>);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveMeasurement(m: Measurement): Promise<void> {
  await tx("readwrite", (s) => s.put(m) as IDBRequest<IDBValidKey>);
}

export async function deleteMeasurement(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

export function toCsv(rows: Measurement[]): string {
  const head = [
    "id",
    "timestamp",
    "label",
    "1490nm",
    "1550nm",
    "unit",
    "latitude",
    "longitude",
    "gps_accuracy_m",
    "photo_file",
    "ai_notes",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((r) =>
    [
      r.id,
      r.createdAt,
      r.label,
      r.nm1490 ?? "",
      r.nm1550 ?? "",
      r.unit,
      r.lat ?? "",
      r.lng ?? "",
      r.accuracy ?? "",
      `${photoFileName(r)}`,
      r.aiNotes ?? "",
    ]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...body].join("\n");
}

export function photoFileName(m: Measurement): string {
  const stamp = m.createdAt.replace(/[:.]/g, "-");
  const label = (m.label || "reading").replace(/[^a-z0-9_-]+/gi, "_");
  return `${stamp}_${label}.jpg`;
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(meta)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
