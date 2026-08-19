import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CloudUpload,
  Crosshair,
  LayoutDashboard,
  Loader2,
  LogOut,
  Sparkles,
} from "lucide-react";

import { readPowerMeter, type PowerReading } from "@/lib/powermeter.functions";
import {
  myProjects,
  myReadings,
  saveReading,
  type FieldProject,
  type MyReading,
} from "@/lib/field.functions";
import { getSessionInfo, signOut, type SessionInfo } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "Măsurători de teren · PRO CONECT GIS TOOLS" },
      {
        name: "description",
        content:
          "Fotografiază powermetrul, valorile 1490/1550 nm sunt citite automat, iar fotografia este marcată cu data și coordonatele GPS.",
      },
      { property: "og:title", content: "Măsurători de teren · PRO CONECT GIS TOOLS" },
      {
        property: "og:description",
        content: "Capturi geotagate cu dată, coordonate și valori optice 1490/1550 nm.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FieldApp,
});

type Coords = { lat: number; lng: number; accuracy: number } | null;

function fmt(v: number | null) {
  return v === null ? "—" : v.toFixed(2);
}

/** Burns a timestamp + GPS coordinates band onto the bottom of the photo. */
async function stampPhoto(dataUrl: string, takenAt: Date, coords: Coords): Promise<string> {
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


function FieldApp() {
  const navigate = useNavigate();
  const runRead = useServerFn(readPowerMeter);
  const loadProjects = useServerFn(myProjects);
  const loadReadings = useServerFn(myReadings);
  const upload = useServerFn(saveReading);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [projects, setProjects] = useState<FieldProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<MyReading[]>([]);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState<Date | null>(null);
  const [stamped, setStamped] = useState<string | null>(null);

  const [coords, setCoords] = useState<Coords>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [v1490, setV1490] = useState("");
  const [v1550, setV1550] = useState("");
  const [unit, setUnit] = useState("dBm");
  const [odb, setOdb] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId) ?? null;

  const refreshReadings = useCallback(
    (id: string) => {
      if (!id) return;
      loadReadings({ data: { projectId: id } })
        .then(setRows)
        .catch(() => setRows([]));
    },
    [loadReadings],
  );

  useEffect(() => {
    getSessionInfo().then(setSession).catch(() => undefined);
    loadProjects()
      .then((list) => {
        setProjects(list);
        if (list.length === 1 && list[0]) setProjectId(list[0].id);
      })
      .catch(() => setProjects([]));
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [loadProjects]);

  useEffect(() => {
    refreshReadings(projectId);
  }, [projectId, refreshReadings]);

  // Re-attach the live stream whenever we go back to the preview (after "Refă fotografia")
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (shot || !cameraOn || !video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [shot, cameraOn]);


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
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
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
    setStamped(null);
    setTakenAt(new Date());
    setShot(dataUrl);
    locate();
    await interpret(dataUrl);
  };

  const onUpload = (file: File) => {
    const fr = new FileReader();
    fr.onload = async () => {
      const dataUrl = String(fr.result);
      setStamped(null);
      setTakenAt(new Date());
      setShot(dataUrl);
      locate();
      await interpret(dataUrl);
    };
    fr.readAsDataURL(file);
  };

  // Burn timestamp + coordinates into the photo (re-runs when GPS lands)
  useEffect(() => {
    if (!shot || !takenAt) {
      setStamped(null);
      return;
    }
    let active = true;
    stampPhoto(shot, takenAt, coords)
      .then((out) => {
        if (active) setStamped(out);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [shot, takenAt, coords]);


  const ready = Boolean(shot) && projectId !== "" && odb.trim() !== "";

  const save = async () => {
    if (!shot || !projectId) return;
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
    try {
      const finalPhoto =
        stamped ?? (takenAt ? await stampPhoto(shot, takenAt, coords).catch(() => shot) : shot);
      await upload({
        data: {
          projectId,
          odbName: odb.trim(),
          nm1490: num(v1490),
          nm1550: num(v1550),
          unit,
          notes: aiNotes,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          accuracy: coords?.accuracy ?? null,
          imageBase64: finalPhoto.split(",")[1] ?? "",
        },
      });
      setSaved("ok");
      setShot(null);
      setStamped(null);
      setTakenAt(null);
      setV1490("");
      setV1550("");
      setOdb("");
      setAiNotes(null);
      refreshReadings(projectId);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Salvarea măsurătorii a eșuat.");
    } finally {
      setSaving(false);
    }
  };


  const logout = async () => {
    await signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 pb-8 sm:px-5">
      <header className="brand-header -mx-3 mb-4 flex items-center justify-between gap-4 px-4 py-4 sm:-mx-5 sm:px-8 sm:py-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid size-12 flex-none place-items-center rounded-xl bg-white text-lg font-bold text-brand">
            PC
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold sm:text-2xl">Măsurători de teren</h1>
            <p className="mt-1 text-xs opacity-90">
              {session ? `${session.fullName ?? session.username}` : "…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session && session.role !== "field" && (
            <Link
              to="/dashboard"
              className="flex items-center gap-1.5 rounded-xl border border-white/50 bg-white/10 px-3 py-2 text-[11px] font-bold"
            >
              <LayoutDashboard className="size-4" /> Panou
            </Link>
          )}
          <button
            type="button"
            onClick={logout}
            aria-label="Ieși din cont"
            className="grid size-9 place-items-center rounded-xl border border-white/50 bg-white/10"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel-surface p-4 lg:col-span-3">
          <label htmlFor="project" className="block">
            <span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">Proiect</span>
            <select
              id="project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-11 w-full rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
            >
              <option value="">— alege proiectul —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code ? `${p.code} — ${p.name}` : p.name}
                </option>
              ))}
            </select>
          </label>
          {projects.length === 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Nu ai încă proiecte alocate. Cere administratorului să te aloce pe un proiect.
            </p>
          )}

        </section>

        <section className="panel-surface relative min-h-[280px] overflow-hidden">
          <div className="relative h-[280px] bg-black/90">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
              style={{ display: cameraOn && !shot ? "block" : "none" }}
            />
            {shot ? (
              <>
                <img
                  src={shot}
                  alt="Fotografia powermetrului"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div
                  className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2.5 rounded-[10px] px-3 py-2.5 text-[11px] font-bold text-white"
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
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">Valori optice</h3>
            <span className="rounded-md bg-secondary px-2 py-1 text-[9px] font-extrabold text-brand">
              {unit.toUpperCase()}
            </span>
          </div>
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

          <label htmlFor="odb" className="mt-3 block">
            <span className="mb-1.5 ml-0.5 block text-[11px] font-bold text-muted-foreground">
              Nume ODB
            </span>
            <input
              id="odb"
              value={odb}
              onChange={(e) => setOdb(e.target.value)}
              placeholder="ODB-1234 / Str. Aviatorilor 12"
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
              <span>{aiError ?? aiNotes ?? "Introdu sau confirmă valorile afișate de powermetru."}</span>
            )}
          </div>
        </section>

        <section className="panel-surface grid grid-cols-[auto_1fr_auto] items-center gap-3 self-start p-5">
          <div className="grid size-[42px] place-items-center rounded-[10px] bg-secondary text-brand">
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

        {saveError && (
          <p className="rounded-[10px] bg-destructive/10 px-3.5 py-3 text-[11px] text-destructive lg:col-span-3">
            {saveError}
          </p>
        )}
        {saved && (
          <p className="rounded-[10px] bg-[#e7f5f0] px-3.5 py-3 text-[11px] text-[#11694f] lg:col-span-3">
            Măsurătoarea a fost salvată în proiect.
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={!ready || saving}
          className="flex min-h-[58px] w-full items-center justify-center gap-3 rounded-[10px] bg-brand px-5 text-[13px] font-bold text-white shadow-[0_8px_22px_rgba(0,91,170,.22)] hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none lg:col-span-3"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
          {saving ? "Se salvează…" : "Salvează în proiect"}
        </button>


        <section className="lg:col-span-3">
          <h3 className="mb-3 text-base font-semibold">Măsurătorile mele ({rows.length})</h3>
          {rows.length === 0 ? (
            <p className="panel-surface p-6 text-center text-sm text-muted-foreground">
              Nicio măsurătoare pentru acest proiect încă.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => (
                <li key={r.id} className="panel-surface p-3">
                  <p className="truncate text-sm font-semibold">{r.odbName}</p>
                  <p className="readout mt-1 text-[13px]">
                    <span className="font-bold text-brand-2">1490</span> {fmt(r.nm1490)}
                    <span className="mx-1.5 text-border">|</span>
                    <span className="font-bold text-[#e2a600]">1550</span> {fmt(r.nm1550)} {r.unit}
                  </p>
                  <p className="readout mt-1 text-[10px] text-muted-foreground">
                    {r.lat !== null && r.lng !== null
                      ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`
                      : "fără GPS"}{" "}
                    · {new Date(r.createdAt).toLocaleString("ro-RO")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
