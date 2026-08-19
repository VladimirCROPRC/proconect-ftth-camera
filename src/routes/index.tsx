import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Crosshair, Download, Loader2, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readPowerMeter, type PowerReading } from "@/lib/powermeter.functions";
import {
  dataUrlToBlob,
  deleteMeasurement,
  download,
  listMeasurements,
  photoFileName,
  saveMeasurement,
  toCsv,
  type Measurement,
} from "@/lib/measurements";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fiber Field Log — Geotagged 1490/1550 nm Power Readings" },
      {
        name: "description",
        content:
          "Capture geotagged photos of an optical power meter and let AI read the 1490 nm and 1550 nm values, with manual override and CSV export.",
      },
      { property: "og:title", content: "Fiber Field Log — Geotagged Optical Power Readings" },
      {
        property: "og:description",
        content:
          "Photograph your power meter, get 1490 nm and 1550 nm values read automatically, tagged with GPS coordinates.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FieldLog,
});

type Coords = { lat: number; lng: number; accuracy: number } | null;

function fmt(v: number | null) {
  return v === null ? "—" : v.toFixed(2);
}

function FieldLog() {
  const runRead = useServerFn(readPowerMeter);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coords>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [v1490, setV1490] = useState("");
  const [v1550, setV1550] = useState("");
  const [unit, setUnit] = useState("dBm");
  const [label, setLabel] = useState("");
  const [rows, setRows] = useState<Measurement[]>([]);

  const refresh = useCallback(() => {
    listMeasurements().then(setRows).catch(() => setRows([]));
  }, []);

  useEffect(() => {
    refresh();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [refresh]);

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
      setCameraError("Camera unavailable here — use “Upload photo” instead.");
    }
  };

  const locate = () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError("This device has no geolocation.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setCoords({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => setGpsError("Location denied or unavailable."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const interpret = async (dataUrl: string) => {
    setReading(true);
    setAiError(null);
    setAiNotes(null);
    try {
      const r: PowerReading = await runRead({ data: { imageDataUrl: dataUrl } });
      setV1490(r.nm1490 === null ? "" : String(r.nm1490));
      setV1550(r.nm1550 === null ? "" : String(r.nm1550));
      if (r.unit) setUnit(r.unit);
      setAiNotes(r.notes);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI reading failed.");
    } finally {
      setReading(false);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setShot(dataUrl);
    locate();
    await interpret(dataUrl);
  };

  const onUpload = (file: File) => {
    const fr = new FileReader();
    fr.onload = async () => {
      const dataUrl = String(fr.result);
      setShot(dataUrl);
      locate();
      await interpret(dataUrl);
    };
    fr.readAsDataURL(file);
  };

  const save = async () => {
    if (!shot) return;
    const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
    await saveMeasurement({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      label: label.trim() || "Reading",
      nm1490: num(v1490),
      nm1550: num(v1550),
      unit,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      accuracy: coords?.accuracy ?? null,
      photo: shot,
      aiNotes,
    });
    setShot(null);
    setV1490("");
    setV1550("");
    setLabel("");
    setAiNotes(null);
    refresh();
  };

  const exportAll = () => {
    if (rows.length === 0) return;
    download("optical-readings.csv", new Blob([toCsv(rows)], { type: "text/csv" }));
    rows.forEach((r, i) =>
      setTimeout(() => download(photoFileName(r), dataUrlToBlob(r.photo)), 400 * (i + 1)),
    );
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8">
      <header className="mb-6">
        <p className="readout text-xs uppercase tracking-[0.3em] text-primary">Fiber Field Log</p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight">
          Geotagged optical readings at 1490 &amp; 1550 nm
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Photograph the power meter — AI reads both wavelengths, you confirm, and the reading is
          stored on this device with its GPS fix. Export to CSV + photos and drop them into OneDrive.
        </p>
      </header>

      <section className="panel-surface overflow-hidden">
        <div className="relative aspect-[4/3] bg-black">
          {shot ? (
            <img src={shot} alt="Captured power meter display" className="h-full w-full object-contain" />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
                style={{ display: cameraOn ? "block" : "none" }}
              />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                  <Camera className="size-8 text-primary" />
                  <p className="max-w-xs text-sm text-muted-foreground">
                    {cameraError ?? "Start the camera and frame the meter display."}
                  </p>
                </div>
              )}
              {cameraOn && (
                <div className="pointer-events-none absolute inset-x-8 inset-y-16 rounded-md border-2 border-dashed border-primary/60" />
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border p-3">
          {!shot ? (
            <>
              {cameraOn ? (
                <Button onClick={capture} className="gap-2">
                  <Camera className="size-4" /> Capture &amp; read
                </Button>
              ) : (
                <Button onClick={startCamera} className="gap-2">
                  <Camera className="size-4" /> Start camera
                </Button>
              )}
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                Upload photo
              </Button>
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
            </>
          ) : (
            <>
              <Button onClick={save} className="gap-2">
                Save reading
              </Button>
              <Button variant="secondary" onClick={() => interpret(shot)} disabled={reading} className="gap-2">
                <Sparkles className="size-4" /> Re-read with AI
              </Button>
              <Button variant="ghost" onClick={() => setShot(null)}>
                Discard
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={locate} className="gap-2">
            <Crosshair className="size-4" /> GPS
          </Button>
        </div>
      </section>

      {shot && (
        <section className="panel-surface mt-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Values
            </h2>
            {reading && (
              <span className="flex items-center gap-2 text-xs text-primary">
                <Loader2 className="size-3 animate-spin" /> reading display…
              </span>
            )}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="v1490">1490 nm</Label>
              <Input
                id="v1490"
                inputMode="decimal"
                className="readout mt-1 text-lg"
                value={v1490}
                onChange={(e) => setV1490(e.target.value)}
                placeholder="-21.34"
              />
            </div>
            <div>
              <Label htmlFor="v1550">1550 nm</Label>
              <Input
                id="v1550"
                inputMode="decimal"
                className="readout mt-1 text-lg"
                value={v1550}
                onChange={(e) => setV1550(e.target.value)}
                placeholder="-19.02"
              />
            </div>
            <div>
              <Label htmlFor="unit">Unit</Label>
              <Input id="unit" className="mt-1" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="label">Location / site label</Label>
              <Input
                id="label"
                className="mt-1"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ONT — Str. Aviatorilor 12, ap. 4"
              />
            </div>
          </div>

          <dl className="readout mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>
              <dt className="uppercase tracking-wider">Latitude</dt>
              <dd className="text-foreground">{coords ? coords.lat.toFixed(6) : "—"}</dd>
            </div>
            <div>
              <dt className="uppercase tracking-wider">Longitude</dt>
              <dd className="text-foreground">{coords ? coords.lng.toFixed(6) : "—"}</dd>
            </div>
          </dl>
          {coords && (
            <p className="mt-1 text-xs text-muted-foreground">±{Math.round(coords.accuracy)} m accuracy</p>
          )}
          {gpsError && <p className="mt-1 text-xs text-destructive">{gpsError}</p>}
          {aiError && <p className="mt-2 text-xs text-destructive">{aiError}</p>}
          {aiNotes && <p className="mt-2 text-xs text-accent">AI note: {aiNotes}</p>}
        </section>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Saved readings ({rows.length})
          </h2>
          <Button variant="secondary" size="sm" onClick={exportAll} disabled={rows.length === 0} className="gap-2">
            <Download className="size-4" /> Export CSV + photos
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="panel-surface mt-3 p-6 text-center text-sm text-muted-foreground">
            No readings yet. Capture your first meter display above.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="panel-surface flex gap-3 p-3">
                <img
                  src={r.photo}
                  alt={`Power meter display for ${r.label}`}
                  className="size-20 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.label}</p>
                  <p className="readout mt-1 text-sm">
                    <span className="text-primary">1490</span> {fmt(r.nm1490)} {r.unit}
                    <span className="mx-2 text-border">|</span>
                    <span className="text-accent">1550</span> {fmt(r.nm1550)} {r.unit}
                  </p>
                  <p className="readout mt-1 text-xs text-muted-foreground">
                    {r.lat !== null && r.lng !== null
                      ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`
                      : "no GPS"}{" "}
                    · {new Date(r.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Download photo"
                    onClick={() => download(photoFileName(r), dataUrlToBlob(r.photo))}
                  >
                    <Download className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete reading"
                    onClick={() => deleteMeasurement(r.id).then(refresh)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
