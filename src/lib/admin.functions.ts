import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const USER_EMAIL_DOMAIN = "proconect.local";

const UsernameSchema = z
  .string()
  .trim()
  .min(3, "Numele de utilizator trebuie sa aiba minim 3 caractere")
  .max(40)
  .regex(/^[a-z0-9._-]+$/i, "Foloseste doar litere, cifre, punct, minus sau underscore");

const NewUser = z.object({
  username: UsernameSchema,
  password: z.string().min(8, "Parola trebuie sa aiba minim 8 caractere").max(72),
  fullName: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "supervisor", "field"]),
});

export type ManagedUser = {
  id: string;
  username: string;
  fullName: string | null;
  role: "admin" | "supervisor" | "field";
  createdAt: string;
  projectIds: string[];
};

export type ManagedProject = {
  id: string;
  name: string;
  code: string | null;
  notes: string | null;
  driveFolderUrl: string | null;
  spreadsheetUrl: string | null;
  createdAt: string;
  assignedUserIds: string[];
  readingCount: number;
  odbTotal: number;
  odbDone: number;
};

/** True when at least one admin account exists (used to gate first-run setup). */
export const adminExists = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (error) throw new Error(error.message);
  return { exists: (count ?? 0) > 0 };
});

/** First-run only: creates the very first admin account. */
export const bootstrapAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => NewUser.omit({ role: true }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) > 0) throw new Error("Exista deja un administrator.");

    const username = data.username.toLowerCase();
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: `${username}@${USER_EMAIL_DOMAIN}`,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Contul nu a putut fi creat.");

    await supabaseAdmin
      .from("profiles")
      .insert({ id: created.user.id, username, full_name: data.fullName ?? null });
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "admin" });
    return { ok: true as const };
  });

async function assertAdmin(context: { supabase: { rpc: Function }; userId: string }) {
  const { data, error } = await (context.supabase.rpc as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: boolean | null; error: { message: string } | null }>)("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Doar administratorii pot face aceasta operatie.");
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ManagedUser[]> => {
    const { data: profiles, error } = await context.supabase
      .from("profiles")
      .select("id, username, full_name, created_at")
      .order("username");
    if (error) throw new Error(error.message);

    const { data: roles } = await context.supabase.from("user_roles").select("user_id, role");
    const { data: assignments } = await context.supabase
      .from("project_assignments")
      .select("user_id, project_id");

    return (profiles ?? []).map((p) => ({
      id: p.id,
      username: p.username,
      fullName: p.full_name,
      createdAt: p.created_at,
      role:
        ((roles ?? []).find((r) => r.user_id === p.id)?.role as ManagedUser["role"] | undefined) ??
        "field",
      projectIds: (assignments ?? []).filter((a) => a.user_id === p.id).map((a) => a.project_id),
    }));
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => NewUser.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const username = data.username.toLowerCase();

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: `${username}@${USER_EMAIL_DOMAIN}`,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Contul nu a putut fi creat.");

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({ id: created.user.id, username, full_name: data.fullName ?? null });
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(profileError.message);
    }
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: data.role });
    return { id: created.user.id };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ userId: z.string().uuid(), role: z.enum(["admin", "supervisor", "field"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ userId: z.string().uuid(), password: z.string().min(8).max(72) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("Nu iti poti sterge propriul cont.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ManagedProject[]> => {
    const { data: projects, error } = await context.supabase
      .from("projects")
      .select(
        "id, name, code, notes, odb_total, drive_folder_url, spreadsheet_url, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: assignments } = await context.supabase
      .from("project_assignments")
      .select("project_id, user_id");
    const { data: readings } = await context.supabase
      .from("readings")
      .select("project_id, odb_name");

    return (projects ?? []).map((p) => {
      const own = (readings ?? []).filter((r) => r.project_id === p.id);
      const distinct = new Set(
        own.map((r) => (r.odb_name ?? "").trim().toUpperCase()).filter(Boolean),
      );
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        notes: p.notes,
        driveFolderUrl: p.drive_folder_url,
        spreadsheetUrl: p.spreadsheet_url,
        createdAt: p.created_at,
        assignedUserIds: (assignments ?? [])
          .filter((a) => a.project_id === p.id)
          .map((a) => a.user_id),
        readingCount: own.length,
        odbTotal: p.odb_total ?? 0,
        odbDone: distinct.size,
      };
    });
  });



/** Creates a project plus its Google Drive folder and live Google Sheet. */
export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        name: z.string().trim().min(2).max(120),
        code: z.string().trim().max(60).optional(),
        notes: z.string().trim().max(500).optional(),
        odbTotal: z.number().int().min(0).max(100000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { createProjectResources } = await import("./drive.server");
    const folderName = data.code ? `${data.code} — ${data.name}` : data.name;
    const drive = await createProjectResources(folderName);

    const { data: project, error } = await context.supabase
      .from("projects")
      .insert({
        name: data.name,
        code: data.code ?? null,
        notes: data.notes ?? null,
        drive_folder_id: drive.folderId,
        drive_folder_url: drive.folderUrl,
        spreadsheet_id: drive.spreadsheetId,
        spreadsheet_url: drive.spreadsheetUrl,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: project.id, ...drive };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ projectId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("projects").delete().eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        userId: z.string().uuid(),
        assigned: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.assigned) {
      const { error } = await context.supabase
        .from("project_assignments")
        .insert({ project_id: data.projectId, user_id: data.userId });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("project_assignments")
        .delete()
        .eq("project_id", data.projectId)
        .eq("user_id", data.userId);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export type DashboardReading = {
  id: string;
  projectId: string;
  odbName: string;
  lat: number | null;
  lng: number | null;
  nm1490: number | null;
  nm1550: number | null;
  unit: string;
  driveFileUrl: string | null;
  createdAt: string;
};

export const listReadings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardReading[]> => {
    const { data, error } = await context.supabase
      .from("readings")
      .select("id, project_id, odb_name, lat, lng, nm1490, nm1550, unit, drive_file_url, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      odbName: r.odb_name,
      lat: r.lat,
      lng: r.lng,
      nm1490: r.nm1490,
      nm1550: r.nm1550,
      unit: r.unit,
      driveFileUrl: r.drive_file_url,
      createdAt: r.created_at,
    }));
  });
