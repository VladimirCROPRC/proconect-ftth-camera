export type GpsPhoto = {
  id: string;
  createdAt: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  photo: string; // stamped data URL (jpeg)
};

const DB_NAME = "gps-camera";
const STORE = "photos";

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

export async function listPhotos(): Promise<GpsPhoto[]> {
  const all = await tx<GpsPhoto[]>("readonly", (s) => s.getAll() as IDBRequest<GpsPhoto[]>);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function savePhoto(p: GpsPhoto): Promise<void> {
  await tx("readwrite", (s) => s.put(p) as IDBRequest<IDBValidKey>);
}

export async function deletePhoto(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

export function photoFileName(p: GpsPhoto): string {
  return `${p.createdAt.replace(/[:.]/g, "-")}.jpg`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta = "", b64 = ""] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(meta)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Burns timestamp + GPS coordinates onto the bottom of the photo. */
export async function stampPhoto(
  dataUrl: string,
  takenAt: Date,
  coords: { lat: number; lng: number; accuracy: number } | null,
): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("imagine invalidă"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);

  const lines = [
    takenAt.toLocaleString("ro-RO"),
    coords
      ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}  ±${Math.round(coords.accuracy)} m`
      : "GPS indisponibil",
  ];
  const size = Math.max(16, Math.round(canvas.width * 0.032));
  const pad = Math.round(size * 0.55);
  const bandH = lines.length * (size * 1.28) + pad * 2;
  ctx.fillStyle = "rgba(0, 45, 88, 0.72)";
  ctx.fillRect(0, canvas.height - bandH, canvas.width, bandH);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  ctx.font = `600 ${size}px ui-monospace, "JetBrains Mono", monospace`;
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, canvas.height - bandH + pad + i * size * 1.28);
  });
  return canvas.toDataURL("image/jpeg", 0.88);
}
