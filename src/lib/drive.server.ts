/**
 * Google Drive + Google Sheets access through the Lovable connector gateway.
 * Server-only: reads gateway credentials from process.env.
 */

const GATEWAY = "https://connector-gateway.lovable.dev";

type Connector = "google_drive" | "google_sheets";

function keys(connector: Connector) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connKey =
    connector === "google_drive"
      ? process.env["GOOGLE_DRIVE_API_KEY"]
      : process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lovableKey || !connKey) {
    throw new Error(
      "Google Drive/Sheets nu este conectat. Reconectează integrarea Google în Lovable.",
    );
  }
  return { lovableKey, connKey };
}

async function gw(
  connector: Connector,
  path: string,
  init: RequestInit & { rawBody?: BodyInit } = {},
): Promise<unknown> {
  const { lovableKey, connKey } = keys(connector);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${lovableKey}`);
  headers.set("X-Connection-Api-Key", connKey);

  const res = await fetch(`${GATEWAY}/${connector}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Google API failed [${res.status}] ${connector}${path}: ${text.slice(0, 500)}`);
    throw new Error(`Google ${connector} a răspuns cu eroare [${res.status}]: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as unknown) : {};
}

const SHEET_HEADER = [
  "Data/ora",
  "ODB",
  "Latitudine",
  "Longitudine",
  "Precizie GPS (m)",
  "1490 nm",
  "1550 nm",
  "Unitate",
  "Observatii",
  "Tehnician",
  "Fotografie",
];

export type ProjectDriveResources = {
  folderId: string;
  folderUrl: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
};

/** Creates the Drive folder + live Google Sheet for a new project. */
export async function createProjectResources(projectName: string): Promise<ProjectDriveResources> {
  const folder = (await gw("google_drive", "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: projectName,
      mimeType: "application/vnd.google-apps.folder",
    }),
  })) as { id: string };

  const sheet = (await gw("google_sheets", "/v4/spreadsheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title: `${projectName} — masuratori optice` },
      sheets: [{ properties: { title: "Masuratori" } }],
    }),
  })) as { spreadsheetId: string };

  // Move the sheet into the project folder (the app created both, so drive.file covers it).
  await gw(
    "google_drive",
    `/drive/v3/files/${sheet.spreadsheetId}?addParents=${folder.id}&fields=id`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" },
  );

  await gw(
    "google_sheets",
    `/v4/spreadsheets/${sheet.spreadsheetId}/values/Masuratori!A1:K1?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [SHEET_HEADER] }),
    },
  );

  return {
    folderId: folder.id,
    folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
    spreadsheetId: sheet.spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`,
  };
}

/** Uploads a JPEG (base64, no data-url prefix) into a project folder. */
export async function uploadPhoto(
  folderId: string,
  fileName: string,
  base64Jpeg: string,
): Promise<{ id: string; url: string }> {
  const boundary = `pcgis${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name: fileName, parents: [folderId] })}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: image/jpeg\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Jpeg}\r\n` +
    `--${boundary}--`;

  const file = (await gw(
    "google_drive",
    "/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  )) as { id: string; webViewLink?: string };

  return { id: file.id, url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view` };
}

/** Appends one measurement row to the project's live Google Sheet. */
export async function appendReadingRow(
  spreadsheetId: string,
  row: (string | number)[],
): Promise<void> {
  await gw(
    "google_sheets",
    `/v4/spreadsheets/${spreadsheetId}/values/Masuratori!A:K:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    },
  );
}
