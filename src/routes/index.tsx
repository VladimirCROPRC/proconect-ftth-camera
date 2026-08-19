import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";

import { adminExists, bootstrapAdmin } from "@/lib/admin.functions";
import { getSessionInfo, signIn } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PRO CONECT GIS TOOLS · Autentificare" },
      {
        name: "description",
        content:
          "Autentificare pentru aplicația de teren PRO CONECT: măsurători optice 1490/1550 nm, proiecte și sincronizare Google Drive.",
      },
      { property: "og:title", content: "PRO CONECT GIS TOOLS · Autentificare" },
      {
        property: "og:description",
        content: "Intră în contul de teren sau în panoul de administrare PRO CONECT GIS TOOLS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const checkAdmin = useServerFn(adminExists);
  const createFirstAdmin = useServerFn(bootstrapAdmin);

  const [booting, setBooting] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await getSessionInfo();
      if (!active) return;
      if (session) {
        navigate({ to: session.role === "field" ? "/app" : "/dashboard" });
        return;
      }
      try {
        const { exists } = await checkAdmin();
        if (active) setNeedsSetup(!exists);
      } catch {
        /* ignore */
      }
      if (active) setBooting(false);
    })();
    return () => {
      active = false;
    };
  }, [checkAdmin, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (needsSetup) {
        await createFirstAdmin({ data: { username, password } });
      }
      await signIn(username, password);
      const session = await getSessionInfo();
      navigate({ to: session?.role === "field" ? "/app" : "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Autentificarea a eșuat.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[440px] px-4 pb-10">
      <header className="brand-header -mx-4 mb-6 flex items-center gap-4 px-6 py-5">
        <div className="grid size-12 flex-none place-items-center rounded-xl bg-white text-lg font-bold text-brand">
          PC
        </div>
        <div>
          <h1 className="text-lg font-bold">PRO CONECT GIS TOOLS</h1>
          <p className="mt-0.5 text-xs opacity-90">Măsurători optice · 1490 / 1550 nm</p>
        </div>
      </header>

      {booting ? (
        <div className="panel-surface flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Se încarcă…
        </div>
      ) : (
        <form onSubmit={submit} className="panel-surface p-6">
          <div className="mb-5 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-[10px] bg-secondary text-brand">
              <LockKeyhole className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold">
                {needsSetup ? "Creează contul de administrator" : "Autentificare"}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {needsSetup
                  ? "Primul cont primește rol de administrator."
                  : "Utilizator și parolă primite de la administrator."}
              </p>
            </div>
          </div>

          <label htmlFor="username" className="mb-3 block">
            <span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">
              Utilizator
            </span>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoComplete="username"
              required
              className="h-11 w-full rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
            />
          </label>

          <label htmlFor="password" className="mb-4 block">
            <span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">Parolă</span>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="h-11 w-full rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
            />
          </label>

          {error && (
            <p className="mb-3 rounded-[10px] bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-brand text-[13px] font-bold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {needsSetup ? "Creează și intră" : "Intră în cont"}
          </button>
        </form>
      )}
    </div>
  );
}
