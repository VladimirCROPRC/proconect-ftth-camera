import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Crosshair, Download, RefreshCw, Trash2, X } from "lucide-react";

import {
  deletePhoto,
  download,
  dataUrlToBlob,
  listPhotos,
  photoFileName,
  savePhoto,
  
  stampPhoto,
  type GpsPhoto,
} from "@/lib/gps-photos";

export const Route = createFileRoute("/camera")({
  head: () => ({
    meta: [
      { title: "Cameră GPS · fotografii geotagate local" },
      {
        name: "description",
        content:
          "Aplicație simplă de cameră GPS: fotografiază, iar data și coordonatele sunt imprimate pe imagine și salvate local pe dispozitiv.",
      },
      { property: "og:title", content: "Cameră GPS · fotografii geotagate local" },
      {
        property: "og:description",
        content: "Fotografii cu dată și coordonate GPS imprimate, stocate doar pe telefonul tău.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GpsCamera,
});

type Coords = { lat: number; lng: number; accuracy: number } | null;

function GpsCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coords>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [rows, setRows] = useState<GpsPhoto[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listPhotos()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    refresh();
    locate();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [refresh]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraOn || !video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [cameraOn]);

  function locate() {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError("GPS indisponibil pe acest dispozitiv.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => setGpsError("Locația nu a putut fi obținută."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setCameraError("Camera nu este disponibilă aici — folosește „Încarcă fotografie”.");
    }
  };

  const store = async (dataUrl: string) => {
    setBusy(true);
    const takenAt = new Date();
    try {
      const stamped = await stampPhoto(dataUrl, takenAt, coords).catch(() => dataUrl);
      await savePhoto({
        id: retakeId ?? crypto.randomUUID(),
        createdAt: takenAt.toISOString(),
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        accuracy: coords?.accuracy ?? null,
        photo: stamped,
      });
      setRetakeId(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    locate();
    await store(canvas.toDataURL("image/jpeg", 0.9));
  };

  const onUpload = (file: File) => {
    const fr = new FileReader();
    fr.onload = () => void store(String(fr.result));
    fr.readAsDataURL(file);
  };

  const remove = async (id: string) => {
    if (retakeId === id) setRetakeId(null);
    await deletePhoto(id);
    refresh();
  };

  const startRetake = async (id: string) => {
    setRetakeId(id);
    locate();
    if (!cameraOn) await startCamera();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };


  return (
    <div className="mx-auto w-full max-w-[900px] px-3 pb-10 sm:px-5">
      <header className="brand-header -mx-3 mb-4 flex items-center justify-between gap-4 px-4 py-4 sm:-mx-5 sm:px-8 sm:py-5">
        <div>
          <h1 className="text-lg font-bold sm:text-2xl">Cameră GPS</h1>
          <p className="mt-1 text-xs opacity-90">
            Fotografiile rămân doar pe acest dispozitiv
          </p>
        </div>
        <button
          type="button"
          onClick={locate}
          aria-label="Actualizează locația"
          className="grid size-9 place-items-center rounded-xl border border-white/50 bg-white/10"
        >
          <Crosshair className="size-4" />
        </button>
      </header>

      <section className="panel-surface mb-4 flex items-center gap-3 p-4">
        <div className="grid size-[42px] flex-none place-items-center rounded-[10px] bg-secondary text-brand">
          <Crosshair className="size-5" />
        </div>
        <div className="min-w-0">
          <strong className="block text-xs">{coords ? "Locație fixată" : "Geotag GPS"}</strong>
          <small className="readout mt-0.5 block text-[10px] text-muted-foreground">
            {coords
              ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)} · ±${Math.round(coords.accuracy)} m`
              : (gpsError ?? "Se caută locația…")}
          </small>
        </div>
      </section>

      <section className="panel-surface overflow-hidden">
        <div className="relative h-[320px] bg-black/90">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
            style={{ display: cameraOn ? "block" : "none" }}
          />
          {!cameraOn && (
            <button
              type="button"
              onClick={startCamera}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-brand"
              style={{
                background: "linear-gradient(135deg, rgba(0,91,170,.06), rgba(0,114,206,.12)), #fff",
              }}
            >
              <span className="mb-1 grid size-[66px] place-items-center rounded-[14px] bg-brand text-white shadow-[0_11px_28px_rgba(0,91,170,.25)]">
                <Camera className="size-8" />
              </span>
              <strong className="text-[15px]">Deschide camera</strong>
              <small className="px-6 text-center text-[11px] text-muted-foreground">
                {cameraError ?? "Data și coordonatele se imprimă pe fotografie"}
              </small>
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border p-3">
          {cameraOn && (
            <button
              type="button"
              onClick={capture}
              disabled={busy}
              className="flex items-center gap-2 rounded-[10px] bg-brand px-3 py-2 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              <Camera className="size-4" /> {busy ? "Se salvează…" : "Fotografiază"}
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-[10px] bg-secondary px-3 py-2 text-xs font-bold text-brand"
          >
            Încarcă fotografie
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => void sharePhotos(rows)}
              className="ml-auto flex items-center gap-2 rounded-[10px] bg-secondary px-3 py-2 text-xs font-bold text-brand"
            >
              <Share2 className="size-4" /> Trimite toate
            </button>
          )}
        </div>
      </section>

      <h2 className="mb-3 mt-6 text-base font-semibold">Fotografii salvate ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="panel-surface p-6 text-center text-sm text-muted-foreground">
          Nicio fotografie salvată încă.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id} className="panel-surface overflow-hidden">
              <img
                src={r.photo}
                alt={`Fotografie din ${new Date(r.createdAt).toLocaleString("ro-RO")}`}
                className="h-40 w-full object-cover"
              />
              <div className="p-3">
                <p className="readout text-[10px] text-muted-foreground">
                  {r.lat !== null && r.lng !== null
                    ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`
                    : "fără GPS"}{" "}
                  · {new Date(r.createdAt).toLocaleString("ro-RO")}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => download(photoFileName(r), dataUrlToBlob(r.photo))}
                    className="flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-[11px] font-bold text-brand"
                  >
                    <Download className="size-3.5" /> Descarcă
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(r.id)}
                    aria-label="Șterge fotografia"
                    className="ml-auto grid size-8 place-items-center rounded-lg bg-destructive/10 text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
