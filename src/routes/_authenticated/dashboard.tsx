import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import {
  Camera,
  ExternalLink,
  FolderPlus,
  KeyRound,
  Loader2,
  LogOut,
  Trash2,
  UserPlus,
} from "lucide-react";

import {
  createProject,
  createUser,
  deleteProject,
  deleteUser,
  listProjects,
  listReadings,
  listUsers,
  setAssignment,
  setUserPassword,
  setUserRole,
  type DashboardReading,
  type ManagedProject,
  type ManagedUser,
} from "@/lib/admin.functions";
import { getSessionInfo, signOut, type SessionInfo } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Panou de control · PRO CONECT GIS TOOLS" },
      {
        name: "description",
        content:
          "Gestionează utilizatorii, proiectele și folderele Google Drive pentru măsurătorile optice de teren.",
      },
      { property: "og:title", content: "Panou de control · PRO CONECT GIS TOOLS" },
      {
        property: "og:description",
        content: "Utilizatori, proiecte, alocări și măsurători sincronizate în Google Drive.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const ROLE_LABEL: Record<ManagedUser["role"], string> = {
  admin: "Administrator",
  supervisor: "Supervizor",
  field: "Tehnician",
};

function Dashboard() {
  const navigate = useNavigate();
  const loadUsers = useServerFn(listUsers);
  const loadProjects = useServerFn(listProjects);
  const loadReadings = useServerFn(listReadings);
  const addUser = useServerFn(createUser);
  const removeUser = useServerFn(deleteUser);
  const changeRole = useServerFn(setUserRole);
  const changePassword = useServerFn(setUserPassword);
  const addProject = useServerFn(createProject);
  const removeProject = useServerFn(deleteProject);
  const toggleAssignment = useServerFn(setAssignment);

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [readings, setReadings] = useState<DashboardReading[]>([]);
  const [tab, setTab] = useState<"projects" | "users" | "readings">("projects");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    fullName: "",
    role: "field" as ManagedUser["role"],
  });
  const [newProject, setNewProject] = useState({ name: "", code: "", notes: "" });

  const isAdmin = session?.role === "admin";

  const refresh = useCallback(async () => {
    const [u, p, r] = await Promise.all([
      loadUsers().catch(() => [] as ManagedUser[]),
      loadProjects().catch(() => [] as ManagedProject[]),
      loadReadings().catch(() => [] as DashboardReading[]),
    ]);
    setUsers(u);
    setProjects(p);
    setReadings(r);
  }, [loadUsers, loadProjects, loadReadings]);

  useEffect(() => {
    getSessionInfo().then((s) => {
      setSession(s);
      if (s?.role === "field") navigate({ to: "/app" });
    });
    void refresh();
  }, [refresh, navigate]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operația a eșuat.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 pb-10 sm:px-5">
      <header className="brand-header -mx-3 mb-4 flex items-center justify-between gap-4 px-4 py-4 sm:-mx-5 sm:px-8 sm:py-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid size-12 flex-none place-items-center rounded-xl bg-white text-lg font-bold text-brand">
            PC
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold sm:text-2xl">Panou de control</h1>
            <p className="mt-1 text-xs opacity-90">
              {session ? `${session.fullName ?? session.username} · ${ROLE_LABEL[session.role]}` : "…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/app"
            className="flex items-center gap-1.5 rounded-xl border border-white/50 bg-white/10 px-3 py-2 text-[11px] font-bold"
          >
            <Camera className="size-4" /> Teren
          </Link>
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

      <div className="mb-4 flex gap-2">
        {(
          [
            ["projects", `Proiecte (${projects.length})`],
            ["users", `Utilizatori (${users.length})`],
            ["readings", `Măsurători (${readings.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-[10px] px-3 py-2 text-xs font-bold ${
              tab === key ? "bg-brand text-white" : "bg-secondary text-brand"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-[10px] bg-destructive/10 px-3.5 py-3 text-[11px] text-destructive">
          {error}
        </p>
      )}
      {!isAdmin && (
        <p className="mb-4 rounded-[10px] bg-muted px-3.5 py-3 text-[11px] text-muted-foreground">
          Rol de supervizor: poți vedea toate datele, dar nu poți modifica utilizatori sau proiecte.
        </p>
      )}

      {tab === "projects" && (
        <div className="grid gap-4">
          {isAdmin && (
            <section className="panel-surface p-5">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
                <FolderPlus className="size-4 text-brand" /> Proiect nou
              </h2>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <input
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  className="h-11 rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
                />
                <input
                  value={newProject.code}
                  onChange={(e) => setNewProject({ ...newProject, code: e.target.value })}
                  className="h-11 rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
                />
                <input
                  value={newProject.notes}
                  onChange={(e) => setNewProject({ ...newProject, notes: e.target.value })}
                  className="h-11 rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
                />
              </div>
              <button
                type="button"
                disabled={busy || newProject.name.trim().length < 2}
                onClick={() =>
                  run(async () => {
                    await addProject({
                      data: {
                        name: newProject.name.trim(),
                        code: newProject.code.trim() || undefined,
                        notes: newProject.notes.trim() || undefined,
                      },
                    });
                    setNewProject({ name: "", code: "", notes: "" });
                  })
                }
                className="mt-3 flex min-h-[46px] items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-45"
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                Creează proiect + folder Google Drive
              </button>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Se creează automat folderul pe Google Drive și fișierul Excel/Sheet cu ODB,
                coordonate și valori optice.
              </p>
            </section>
          )}

          {projects.length === 0 ? (
            <p className="panel-surface p-6 text-center text-sm text-muted-foreground">
              Niciun proiect încă.
            </p>
          ) : (
            projects.map((p) => (
              <section key={p.id} className="panel-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">
                      {p.code ? `${p.code} — ${p.name}` : p.name}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {p.readingCount} măsurători · creat{" "}
                      {new Date(p.createdAt).toLocaleDateString("ro-RO")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-bold text-brand">
                      {p.driveFolderUrl && (
                        <a href={p.driveFolderUrl} target="_blank" rel="noopener" className="flex items-center gap-1">
                          <ExternalLink className="size-3.5" /> Folder Drive
                        </a>
                      )}
                      {p.spreadsheetUrl && (
                        <a href={p.spreadsheetUrl} target="_blank" rel="noopener" className="flex items-center gap-1">
                          <ExternalLink className="size-3.5" /> Excel / Sheet
                        </a>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      aria-label="Șterge proiectul"
                      onClick={() => run(() => removeProject({ data: { projectId: p.id } }))}
                      className="grid size-9 place-items-center rounded-lg text-destructive hover:bg-secondary"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>

                <p className="mt-4 mb-2 text-[11px] font-bold text-muted-foreground">
                  Utilizatori alocați
                </p>
                <div className="flex flex-wrap gap-2">
                  {users.length === 0 && (
                    <span className="text-[11px] text-muted-foreground">Niciun utilizator.</span>
                  )}
                  {users.map((u) => {
                    const on = p.assignedUserIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        disabled={!isAdmin || busy}
                        onClick={() =>
                          run(() =>
                            toggleAssignment({
                              data: { projectId: p.id, userId: u.id, assigned: !on },
                            }),
                          )
                        }
                        className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${
                          on ? "bg-brand text-white" : "bg-secondary text-brand"
                        } disabled:opacity-60`}
                      >
                        {u.username}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {tab === "users" && (
        <div className="grid gap-4">
          {isAdmin && (
            <section className="panel-surface p-5">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
                <UserPlus className="size-4 text-brand" /> Utilizator nou
              </h2>
              <div className="grid gap-2.5 sm:grid-cols-4">
                <input
                  value={newUser.username}
                  autoCapitalize="none"
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="h-11 rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
                />
                <input
                  value={newUser.fullName}
                  onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                  className="h-11 rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
                />
                <input
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="h-11 rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
                />
                <select
                  value={newUser.role}
                  onChange={(e) =>
                    setNewUser({ ...newUser, role: e.target.value as ManagedUser["role"] })
                  }
                  className="h-11 rounded-[10px] border border-border bg-[#fbfcfe] px-3 text-sm outline-none focus:border-brand-2"
                >
                  <option value="field">Tehnician</option>
                  <option value="supervisor">Supervizor</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <button
                type="button"
                disabled={busy || newUser.username.trim().length < 3 || newUser.password.length < 8}
                onClick={() =>
                  run(async () => {
                    await addUser({
                      data: {
                        username: newUser.username.trim(),
                        password: newUser.password,
                        fullName: newUser.fullName.trim() || undefined,
                        role: newUser.role,
                      },
                    });
                    setNewUser({ username: "", password: "", fullName: "", role: "field" });
                  })
                }
                className="mt-3 flex min-h-[46px] items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-45"
              >
                {busy && <Loader2 className="size-4 animate-spin" />} Creează utilizator
              </button>
            </section>
          )}

          <ul className="grid gap-3 sm:grid-cols-2">
            {users.map((u) => (
              <li key={u.id} className="panel-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{u.fullName ?? u.username}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {u.username} · {u.projectIds.length} proiecte
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      aria-label="Șterge utilizatorul"
                      onClick={() => run(() => removeUser({ data: { userId: u.id } }))}
                      className="grid size-8 place-items-center rounded-lg text-destructive hover:bg-secondary"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={u.role}
                    disabled={!isAdmin || busy}
                    onChange={(e) =>
                      run(() =>
                        changeRole({
                          data: { userId: u.id, role: e.target.value as ManagedUser["role"] },
                        }),
                      )
                    }
                    className="h-9 rounded-[10px] border border-border bg-[#fbfcfe] px-2 text-[11px] font-bold text-brand outline-none"
                  >
                    <option value="field">Tehnician</option>
                    <option value="supervisor">Supervizor</option>
                    <option value="admin">Administrator</option>
                  </select>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        const pass = window.prompt(`Parolă nouă pentru ${u.username} (min. 8):`);
                        if (pass && pass.length >= 8)
                          void run(() => changePassword({ data: { userId: u.id, password: pass } }));
                      }}
                      className="flex items-center gap-1.5 rounded-[10px] bg-secondary px-3 py-2 text-[11px] font-bold text-brand"
                    >
                      <KeyRound className="size-3.5" /> Resetează parola
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "readings" && (
        <div className="panel-surface overflow-x-auto p-4">
          {readings.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Nicio măsurătoare încă.</p>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-2">Data</th>
                  <th className="p-2">Proiect</th>
                  <th className="p-2">ODB</th>
                  <th className="p-2">1490</th>
                  <th className="p-2">1550</th>
                  <th className="p-2">Coordonate</th>
                  <th className="p-2">Foto</th>
                </tr>
              </thead>
              <tbody>
                {readings.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString("ro-RO")}
                    </td>
                    <td className="p-2">
                      {projects.find((p) => p.id === r.projectId)?.name ?? "—"}
                    </td>
                    <td className="p-2 font-semibold">{r.odbName}</td>
                    <td className="readout p-2">{r.nm1490 ?? "—"}</td>
                    <td className="readout p-2">{r.nm1550 ?? "—"}</td>
                    <td className="readout p-2 whitespace-nowrap">
                      {r.lat !== null && r.lng !== null
                        ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`
                        : "—"}
                    </td>
                    <td className="p-2">
                      {r.driveFileUrl && (
                        <a
                          href={r.driveFileUrl}
                          target="_blank"
                          rel="noopener"
                          className="font-bold text-brand"
                        >
                          Drive
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
