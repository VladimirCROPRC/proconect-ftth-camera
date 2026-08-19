import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Crosshair, Download, Loader2, Share2, Sparkles, Trash2 } from "lucide-react";

import { readPowerMeter, type PowerReading } from "@/lib/powermeter.functions";
import {
  dataUrlToBlob,
  deleteMeasurement,
  download,
  listMeasurements,
  photoFileName,
  saveMeasurement,
  shareExport,
  toCsv,
  type Measurement,
} from "@/lib/measurements";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PRO CONECT GIS TOOLS · Măsurători optice 1490/1550 nm" },
      {
        name: "description",
        content:
          "Fotografiază powermetrul, valorile optice 1490/1550 nm sunt citite automat, geotag GPS, export CSV + poze și trimitere pe WhatsApp.",
      },
      { property: "og:title", content: "PRO CONECT GIS TOOLS · Măsurători optice" },
      {
        property: "og:description",
        content:
          "Fotografie, valori optice 1490/1550 nm și coordonate GPS într-un singur flux, salvate local pe telefon.",
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

function Heading({ n, title, pill }: { n: string; title: string; pill?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black text-brand">{n}</span>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      {pill && (
        <span className="rounded-md bg-secondary px-2 py-1 text-[9px] font-extrabold text-brand">
          {pill}
        </span>
      )}
    </div>
  );
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
  const [shareNote, setShareNote] = useState<string | null>(null);

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
      setCameraError("Camera nu este disponibilă aici — folosește „Încarcă fotografie”.");
    }
  };

  const locate = () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError("GPS indisponibil pe acest dispozitiv.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setCoords({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => setGpsError("Locația nu a putut fi obținută."),
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
      setAiError(e instanceof Error ? e.message : "Citirea automată a eșuat.");
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

  const ready = Boolean(shot) && v1490.trim() !== "" && v1550.trim() !== "";

  const save = async () => {
    if (!shot) return;
    const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
    await saveMeasurement({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      label: label.trim() || "Măsurătoare",
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
    download("masuratori-optice.csv", new Blob([toCsv(rows)], { type: "text/csv" }));
    rows.forEach((r, i) =>
      setTimeout(() => download(photoFileName(r), dataUrlToBlob(r.photo)), 400 * (i + 1)),
    );
  };

  const sendToWhatsApp = async () => {
    setShareNote(null);
    const result = await shareExport(rows);
    if (result === "downloaded") {
      setShareNote(
        "Browserul acesta nu poate atașa fișiere direct: CSV-ul și pozele s-au descărcat, iar WhatsApp Web s-a deschis cu rezumatul — atașează fișierele descărcate.",
      );
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 pb-8 sm:px-5">
      <header className="brand-header -mx-3 mb-4 flex items-center justify-between gap-4 px-4 py-4 sm:-mx-5 sm:px-8 sm:py-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid size-12 flex-none place-items-center rounded-xl bg-white text-lg font-bold text-brand sm:size-14 sm:text-[22px]">
            PC
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold sm:text-2xl">PRO CONECT GIS TOOLS</h1>
            <p className="mt-1 text-xs opacity-90 sm:text-sm">Măsurători optice</p>
          </div>
        </div>
        <span className="hidden rounded-xl border border-white/50 bg-white/10 px-3 py-2 text-[11px] font-bold sm:block">
          1490 / 1550 nm
        </span>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel-surface grid grid-cols-[auto_1fr_auto] items-center gap-3 p-4 lg:col-span-3">
          <span
            className="size-2.5 rounded-full"
            style={{
              background: rows.length ? "var(--signal)" : "#a8b1b8",
              boxShadow: `0 0 0 4px ${rows.length ? "rgba(24,135,101,.16)" : "rgba(168,177,184,.16)"}`,
            }}
          />
          <div>
            <strong className="block text-[13px]">Stocare locală pe acest dispozitiv</strong>
            <small className="mt-0.5 block text-[11px] text-muted-foreground">
              {rows.length} măsurători salvate · export CSV + poze sau trimitere pe WhatsApp
            </small>
          </div>
          <button
            type="button"
            onClick={sendToWhatsApp}
            disabled={rows.length === 0}
            className="border-0 bg-transparent px-1 py-2 text-[11px] font-extrabold text-brand disabled:opacity-40"
          >
            Trimite
          </button>
        </section>

        <section className="panel-surface p-5 lg:col-span-3">
          <p className="kicker mb-1.5">Măsurătoare nouă</p>
          <h2 className="text-[clamp(25px,4vw,34px)] font-semibold tracking-[-0.035em]">
            Fotografiază. Măsoară. Salvează.
          </h2>
          <p className="mt-2 max-w-[760px] text-[13px] leading-[1.55] text-muted-foreground">
            Fotografia powermetrului, valorile optice citite automat și coordonatele GPS, pregătite
            într-un singur flux și salvate local pe telefon.
          </p>
        </section>

        <section className="panel-surface relative min-h-[280px] overflow-hidden">
          <div className="relative h-[280px] bg-black/90">
            {shot ? (
              <>
                <img
                  src={shot}
                  alt="Fotografia powermetrului"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2.5 rounded-[10px] px-3 py-2.5 text-[11px] font-bold text-white"
                  style={{ background: "rgba(0,70,138,.88)" }}
                >
                  <span>Fotografie pregătită</span>
                  <button type="button" className="underline" onClick={() => setShot(null)}>
                    Refă fotografia
                  </button>
                </div>
              </>
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
                  <button
                    type="button"
                    onClick={startCamera}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-brand"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(0,91,170,.06), rgba(0,114,206,.12)), #fff",
                    }}
                  >
                    <span className="mb-1 grid size-[66px] place-items-center rounded-[14px] bg-brand text-white shadow-[0_11px_28px_rgba(0,91,170,.25)]">
                      <Camera className="size-8" />
                    </span>
                    <strong className="text-[15px]">Deschide camera</strong>
                    <small className="px-6 text-center text-[11px] text-muted-foreground">
                      {cameraError ?? "Fotografia powermetrului"}
                    </small>
                  </button>
                )}
                {cameraOn && (
                  <div className="pointer-events-none absolute inset-x-8 inset-y-14 rounded-md border-2 border-dashed border-white/70" />
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border p-3">
            {!shot ? (
              <>
                {cameraOn && (
                  <button
                    type="button"
                    onClick={capture}
                    className="flex items-center gap-2 rounded-[10px] bg-brand px-3 py-2 text-xs font-bold text-white hover:bg-brand-dark"
                  >
                    <Camera className="size-4" /> Fotografiază & citește
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
              </>
            ) : (
              <button
                type="button"
                onClick={() => interpret(shot)}
                disabled={reading}
                className="flex items-center gap-2 rounded-[10px] bg-secondary px-3 py-2 text-xs font-bold text-brand disabled:opacity-50"
              >
                <Sparkles className="size-4" /> Recitește cu AI
              </button>
            )}
          </div>
        </section>

        <section className="panel-surface p-5">
          <Heading n="02" title="Valori optice" pill={unit.toUpperCase()} />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {[
              { id: "v1490", tag: "1490 nm", dot: "var(--brand-2)", value: v1490, set: setV1490, ph: "-18.45" },
              { id: "v1550", tag: "1550 nm", dot: "#e2a600", value: v1550, set: setV1550, ph: "-20.10" },
            ].map((f) => (
              <label key={f.id} htmlFor={f.id} className="block">
                <span className="mb-1.5 ml-0.5 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                  <i className="size-[7px] rounded-full" style={{ background: f.dot }} />
                  {f.tag}
                </span>
                <span className="flex h-[54px] items-center gap-1.5 rounded-[10px] border border-border bg-[#fbfcfe] px-3 focus-within:border-brand-2">
                  <input
                    id={f.id}
                    inputMode="decimal"
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    placeholder={f.ph}
                    className="readout w-full min-w-0 border-0 bg-transparent text-[19px] font-bold text-foreground outline-none"
                  />
                  <b className="text-[9px] text-muted-foreground">{unit}</b>
                </span>
              </label>
            ))}
          </div>

          <label htmlFor="label" className="mt-3 block">
            <span className="mb-1.5 ml-0.5 block text-[11px] font-bold text-muted-foreground">
              Locație / etichetă
            </span>
            <input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ONT — Str. Aviatorilor 12, ap. 4"
              className="h-11 w-full rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
            />
          </label>

          <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted p-2.5 text-[10px] text-[#55636c]">
            {reading ? (
              <>
                <Loader2 className="size-4 animate-spin text-brand" />
                <span>Se citesc valorile de pe display…</span>
              </>
            ) : (
              <>
                <i className="grid size-[21px] place-items-center rounded-full bg-[#89969e] not-italic font-black text-white">
                  i
                </i>
                <span>
                  {aiError ?? aiNotes ?? "Introdu sau confirmă valorile afișate de powermetru."}
                </span>
              </>
            )}
          </div>
        </section>

        <section className="panel-surface grid grid-cols-[auto_1fr_auto] items-center gap-3 self-start p-5">
          <div className="grid size-[42px] place-items-center rounded-[10px] bg-secondary text-xl text-brand">
            <Crosshair className="size-5" />
          </div>
          <div>
            <strong className="block text-xs">{coords ? "Locație fixată" : "Geotag GPS"}</strong>
            <small className="mt-0.5 block text-[10px] leading-[1.35] text-muted-foreground">
              {coords
                ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)} · ±${Math.round(coords.accuracy)} m`
                : (gpsError ?? "Locație GPS necesară")}
            </small>
          </div>
          <button
            type="button"
            onClick={locate}
            className="border-0 bg-transparent text-[10px] font-extrabold text-brand"
          >
            {coords ? "Actualizează" : "Obține"}
          </button>
        </section>

        {ready && (
          <div className="flex items-start gap-2.5 rounded-[10px] bg-[#e7f5f0] px-3.5 py-3 text-[11px] leading-[1.45] text-[#11694f] lg:col-span-3">
            <i className="grid size-[21px] flex-none place-items-center rounded-full bg-signal not-italic font-black text-white">
              ✓
            </i>
            <span>Fotografia și datele măsurătorii sunt pregătite.</span>
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={!ready}
          className="flex min-h-[58px] w-full items-center justify-center gap-3.5 rounded-[10px] bg-brand px-5 text-[13px] font-bold text-white shadow-[0_8px_22px_rgba(0,91,170,.22)] hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none lg:col-span-3"
        >
          Salvează măsurătoarea <span>→</span>
        </button>
        <p className="-mt-2 text-center text-[9px] text-[#7f8c95] lg:col-span-3">
          Fotografia și locația sunt păstrate local, în acest browser. Doar fotografia trimisă
          pentru citire automată părăsește dispozitivul.
        </p>

        <section className="lg:col-span-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-brand">03</span>
              <h3 className="text-base font-semibold">Măsurători salvate ({rows.length})</h3>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={sendToWhatsApp}
                disabled={rows.length === 0}
                className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                style={{ background: "#25D366" }}
              >
                <Share2 className="size-4" /> Trimite pe WhatsApp
              </button>
              <button
                type="button"
                onClick={exportAll}
                disabled={rows.length === 0}
                className="flex items-center gap-2 rounded-[10px] bg-secondary px-3 py-2 text-xs font-bold text-brand disabled:opacity-40"
              >
                <Download className="size-4" /> Export CSV + poze
              </button>
            </div>
          </div>

          {shareNote && (
            <p className="panel-surface mb-3 p-3 text-[11px] text-muted-foreground">{shareNote}</p>
          )}

          {rows.length === 0 ? (
            <p className="panel-surface p-6 text-center text-sm text-muted-foreground">
              Nicio măsurătoare încă. Fotografiază primul powermetru mai sus.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => (
                <li key={r.id} className="panel-surface flex gap-3 p-3">
                  <img
                    src={r.photo}
                    alt={`Powermetru pentru ${r.label}`}
                    className="size-20 shrink-0 rounded-[10px] object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.label}</p>
                    <p className="readout mt-1 text-[13px]">
                      <span className="font-bold text-brand-2">1490</span> {fmt(r.nm1490)}
                      <span className="mx-1.5 text-border">|</span>
                      <span className="font-bold text-[#e2a600]">1550</span> {fmt(r.nm1550)} {r.unit}
                    </p>
                    <p className="readout mt-1 text-[10px] text-muted-foreground">
                      {r.lat !== null && r.lng !== null
                        ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`
                        : "fără GPS"}{" "}
                      · {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      aria-label="Descarcă fotografia"
                      onClick={() => download(photoFileName(r), dataUrlToBlob(r.photo))}
                      className="grid size-8 place-items-center rounded-lg text-brand hover:bg-secondary"
                    >
                      <Download className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Șterge măsurătoarea"
                      onClick={() => deleteMeasurement(r.id).then(refresh)}
                      className="grid size-8 place-items-center rounded-lg text-destructive hover:bg-secondary"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
