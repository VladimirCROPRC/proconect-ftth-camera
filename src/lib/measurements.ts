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
  const [meta = "", b64 = ""] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(meta)?.[1] ?? "image/jpeg";
  const bin = atob(b64);

  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Files for a WhatsApp / native share: one CSV + one JPEG per reading. */
export function exportFiles(rows: Measurement[]): File[] {
  const csv = new File([toCsv(rows)], "masuratori-optice.csv", { type: "text/csv" });
  const photos = rows.map(
    (r) => new File([dataUrlToBlob(r.photo)], photoFileName(r), { type: "image/jpeg" }),
  );
  return [csv, ...photos];
}

export function shareSummary(rows: Measurement[]): string {
  const lines = rows.slice(0, 20).map((r) => {
    const gps = r.lat !== null && r.lng !== null ? `${r.lat.toFixed(5)},${r.lng.toFixed(5)}` : "fara GPS";
    return `• ${r.label}: 1490 ${r.nm1490 ?? "—"} / 1550 ${r.nm1550 ?? "—"} ${r.unit} · ${gps}`;
  });
  const extra = rows.length > 20 ? `\n… si ${rows.length - 20} masuratori in CSV` : "";
  return `Masuratori optice (${rows.length})\n${lines.join("\n")}${extra}`;
}

export type ShareResult = "shared" | "downloaded" | "cancelled";

/**
 * Share the export straight into WhatsApp (or any app) via the native share
 * sheet. Falls back to wa.me text + local downloads where file sharing is
 * unsupported (most desktop browsers).
 */
export async function shareExport(rows: Measurement[]): Promise<ShareResult> {
  if (rows.length === 0) return "cancelled";
  const files = exportFiles(rows);
  const text = shareSummary(rows);

  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  if (nav.share && nav.canShare?.({ files })) {
    try {
      await nav.share({ files, title: "Masuratori optice", text });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }

  files.forEach((f, i) => setTimeout(() => download(f.name, f), 350 * i));
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  return "downloaded";
}
