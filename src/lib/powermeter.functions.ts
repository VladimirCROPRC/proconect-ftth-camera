import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  imageDataUrl: z.string().min(32),
});

export type PowerReading = {
  nm1490: number | null;
  nm1550: number | null;
  unit: string | null;
  notes: string | null;
};

const SYSTEM_PROMPT = `You read optical power meter displays used in fiber optic (GPON/FTTH) field work.
From the photo, extract the measured optical power at 1490 nm and at 1550 nm.
Rules:
- Values are usually negative dBm (e.g. -21.34).
- If the meter shows only one wavelength, return the other as null.
- Never invent a value you cannot see.
Reply with ONLY compact JSON: {"nm1490": number|null, "nm1550": number|null, "unit": "dBm"|"dB"|"W"|null, "notes": string|null}`;

export const readPowerMeter = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<PowerReading> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured (missing LOVABLE_API_KEY).");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Read the 1490 nm and 1550 nm optical values from this meter." },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("AI is rate limited right now. Try again in a moment.");
      if (res.status === 402)
        throw new Error("AI credits are exhausted. Add credits in Lovable to keep reading meters.");
      throw new Error(`AI request failed [${res.status}]: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { nm1490: null, nm1550: null, unit: null, notes: text.slice(0, 200) || null };

    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      return {
        nm1490: num(parsed["nm1490"]),
        nm1550: num(parsed["nm1550"]),
        unit: typeof parsed["unit"] === "string" ? parsed["unit"] : null,
        notes: typeof parsed["notes"] === "string" ? parsed["notes"] : null,
      };
    } catch {
      return { nm1490: null, nm1550: null, unit: null, notes: "Could not parse AI response" };
    }
  });
