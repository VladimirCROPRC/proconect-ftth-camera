import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FieldProject = {
  id: string;
  name: string;
  code: string | null;
  driveFolderUrl: string | null;
  spreadsheetUrl: string | null;
};

export const myProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FieldProject[]> => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code, drive_folder_url, spreadsheet_url")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      driveFolderUrl: p.drive_folder_url,
      spreadsheetUrl: p.spreadsheet_url,
    }));
  });

const SaveInput = z.object({
  projectId: z.string().uuid(),
  odbName: z.string().trim().min(1, "Numele ODB este obligatoriu").max(120),
  nm1490: z.number().nullable(),
  nm1550: z.number().nullable(),
  unit: z.string().trim().max(10).default("dBm"),
  notes: z.string().trim().max(500).nullable().optional(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  accuracy: z.number().nullable(),
  imageBase64: z.string().min(64, "Fotografia lipseste"),
});

export type SavedReading = {
  id: string;
  driveFileUrl: string;
};

/** Uploads the photo to the project's Drive folder, appends the sheet row, stores the reading. */
export const saveReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SaveInput.parse(data))
  .handler(async ({ data, context }): Promise<SavedReading> => {
    // RLS makes this readable only for assigned projects (or admins).
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id, name, drive_folder_id, spreadsheet_id")
      .eq("id", data.projectId)
      .single();
    if (projectError || !project) throw new Error("Proiectul nu este disponibil pentru contul tau.");
    if (!project.drive_folder_id || !project.spreadsheet_id)
      throw new Error("Proiectul nu are folder Google Drive configurat.");

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("username, full_name")
      .eq("id", context.userId)
      .single();
    const technician = profile?.full_name || profile?.username || "necunoscut";

    const stamp = new Date().toISOString();
    const safeOdb = data.odbName.replace(/[^a-z0-9_-]+/gi, "_");
    const fileName = `${stamp.replace(/[:.]/g, "-")}_${safeOdb}.jpg`;

    const { uploadPhoto, appendReadingRow } = await import("./drive.server");
    const photo = await uploadPhoto(project.drive_folder_id, fileName, data.imageBase64);

    await appendReadingRow(project.spreadsheet_id, [
      new Date(stamp).toLocaleString("ro-RO"),
      data.odbName,
      data.lat ?? "",
      data.lng ?? "",
      data.accuracy === null ? "" : Math.round(data.accuracy),
      data.nm1490 ?? "",
      data.nm1550 ?? "",
      data.unit,
      data.notes ?? "",
      technician,
      photo.url,
    ]);

    const { data: reading, error } = await context.supabase
      .from("readings")
      .insert({
        project_id: data.projectId,
        user_id: context.userId,
        odb_name: data.odbName,
        lat: data.lat,
        lng: data.lng,
        accuracy: data.accuracy,
        nm1490: data.nm1490,
        nm1550: data.nm1550,
        unit: data.unit,
        notes: data.notes ?? null,
        drive_file_id: photo.id,
        drive_file_url: photo.url,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { id: reading.id, driveFileUrl: photo.url };
  });

export type MyReading = {
  id: string;
  odbName: string;
  nm1490: number | null;
  nm1550: number | null;
  unit: string;
  lat: number | null;
  lng: number | null;
  driveFileUrl: string | null;
  createdAt: string;
};

export const myReadings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ projectId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<MyReading[]> => {
    const { data: rows, error } = await context.supabase
      .from("readings")
      .select("id, odb_name, nm1490, nm1550, unit, lat, lng, drive_file_url, created_at")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      odbName: r.odb_name,
      nm1490: r.nm1490,
      nm1550: r.nm1550,
      unit: r.unit,
      lat: r.lat,
      lng: r.lng,
      driveFileUrl: r.drive_file_url,
      createdAt: r.created_at,
    }));
  });
