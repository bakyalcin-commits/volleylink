export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { openai, DEFAULT_VISION_MODEL, VbReport } from "@/lib/openai";
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { extractJpegFramesBase64 } from "@/lib/frames";

const ANALYZER_VERSION = 5; // cache kır / versiyonla

type VideoRow = { id: string; storage_path: string };

type VisionPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" };

/* ------------------ JSON-DAYANIKLI OKUMA YARDIMCILARI ------------------ */
function pickText(resp: any): string {
  try {
    if (typeof resp?.output_text === "string" && resp.output_text.trim()) {
      return resp.output_text;
    }
    const blocks = resp?.output?.[0]?.content ?? [];
    for (const b of blocks) {
      if ((b.type === "output_text" || b.type === "text") && typeof b.text === "string") {
        return b.text;
      }
      if (b?.text) return String(b.text);
    }
  } catch {}
  return "";
}

function parseJsonLoose(s: string): any | null {
  if (!s) return null;
  // ```json ... ``` gibi fence'leri temizle
  s = s.replace(/```json|```/g, "").trim();
  // metin içinde ilk JSON bloğunu yakala
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch {}
  return null;
}
/* ----------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  const { videoId, force } = await req.json();
  if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const bucket      = process.env.SUPABASE_VIDEOS_BUCKET || "videos";
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase env missing" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // cache: boş olmayan ve güncel sürümse kullan
  if (!force) {
    const { data: cached } = await supabase
      .from("video_analyses")
      .select("*")
      .eq("video_id", videoId)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const isEmpty =
      !cached?.report?.strengths?.length &&
      !cached?.report?.issues?.length &&
      !cached?.report?.drills?.length;
    const isStale = (cached?.version ?? 0) !== ANALYZER_VERSION;

    if (cached?.report && !isEmpty && !isStale) {
      return NextResponse.json({
        from_cache: true,
        report: cached.report as VbReport,
        meta: { version: cached.version, model: cached.model, created_at: cached.created_at }
      });
    }
  }

  // aktif iş?
  const { data: active } = await supabase
    .from("video_analyses")
    .select("id")
    .eq("video_id", videoId)
    .in("status", ["pending", "processing"])
    .maybeSingle();
  if (active) {
    return NextResponse.json({ queued: true, message: "Analysis already in progress." }, { status: 202 });
  }

  // video satırı
  const { data: videoRow, error: vErr } = await supabase
    .from("videos")
    .select("id, storage_path")
    .eq("id", videoId)
    .maybeSingle<VideoRow>();
  if (vErr || !videoRow?.storage_path) {
    return NextResponse.json({ error: vErr?.message || "video not found" }, { status: 404 });
  }

  // indir → /tmp
  const { data: file, error: dErr } = await supabase.storage.from(bucket).download(videoRow.storage_path);
  if (dErr || !file) return NextResponse.json({ error: dErr?.message || "download failed" }, { status: 500 });

  const buf = Buffer.from(await file.arrayBuffer());
  const tmpPath = path.join("/tmp", `${videoId}_${crypto.randomBytes(4).toString("hex")}.mp4`);
  await fs.writeFile(tmpPath, buf);

  // pending kayıt
  const { data: created, error: insErr } = await supabase
    .from("video_analyses")
    .insert({
      video_id: videoId,
      status: "pending",
      model: DEFAULT_VISION_MODEL,
      version: ANALYZER_VERSION,
      params: { pass1: { fps: "2", frames: 24, width: 896 }, pass2: { fps: "3", frames: 28, width: 1024 } }
    })
    .select()
    .single();
  if (insErr || !created) return NextResponse.json({ error: insErr?.message || "insert failed" }, { status: 500 });
  const analysisId = created.id;

  try {
    /* ===================== 1. PAS ===================== */
    let framesRaw = await extractJpegFramesBase64(tmpPath, { fps: "2", maxFrames: 24, width: 896 });
    if (!framesRaw.length) throw new Error("No frames extracted");

    // ilk 10 kare high, kalanı low
    const frames1: VisionPart[] = framesRaw.map((f, i) =>
      i < 10
        ? { type: "input_image", image_url: f.image_url, detail: "high" }
        : { type: "input_image", image_url: f.image_url, detail: "low" }
    );

    await supabase.from("video_analyses").update({ status: "processing" }).eq("id", analysisId);

    const prompt = `
Sen profesyonel bir voleybol analistisın. Görüntülerde smaç/antrenman sekanslarını değerlendir.
Aşamalar: yaklaşma, sıçrama, kol salınımı, bilek teması, iniş, core/denge, kol-bacak senkronu.

KURALLAR:
- SADECE geçerli JSON döndür.
- Her listede en az 3 madde; boş liste yok.
- Cümleler kısa ve spesifik (≈15 kelime, teknik terim serbest).

JSON ŞEMASI:
{
  "strengths": ["...","...","..."],
  "issues": ["...","...","..."],
  "drills": ["...","...","..."]
}
`.trim();

    const jsonFormat = {
      type: "json_schema" as const,
      name: "vb_report",
      strict: true,
      schema: {
        type: "object",
        properties: {
          strengths: { type: "array", items: { type: "string" }, minItems: 3 },
          issues:    { type: "array", items: { type: "string" }, minItems: 3 },
          drills:    { type: "array", items: { type: "string" }, minItems: 3 }
        },
        required: ["strengths", "issues", "drills"],
        additionalProperties: false
      }
    };

    const content1: VisionPart[] = [{ type: "input_text", text: prompt }, ...frames1];

    let resp = await openai.responses.create({
      model: DEFAULT_VISION_MODEL,
      input: [{ role: "user", content: content1 }],
      temperature: 0,
      text: { format: jsonFormat }
    } as any);

    let report: VbReport =
      parseJsonLoose(pickText(resp)) ?? { strengths: [], issues: [], drills: [] };

    /* ===================== 2. PAS (fallback) ===================== */
    const empty1 = (!report.strengths?.length) && (!report.issues?.length) && (!report.drills?.length);
    if (empty1) {
      framesRaw = await extractJpegFramesBase64(tmpPath, { fps: "3", maxFrames: 28, width: 1024 });
      if (!framesRaw.length) throw new Error("No frames extracted (fallback)");

      const frames2: VisionPart[] = framesRaw.map((f, i) =>
        i < 14
          ? { type: "input_image", image_url: f.image_url, detail: "high" }
          : { type: "input_image", image_url: f.image_url, detail: "low" }
      );
      const content2: VisionPart[] = [{ type: "input_text", text: prompt }, ...frames2];

      resp = await openai.responses.create({
        model: DEFAULT_VISION_MODEL,
        input: [{ role: "user", content: content2 }],
        temperature: 0,
        text: { format: jsonFormat }
      } as any);

      report = parseJsonLoose(pickText(resp)) ?? { strengths: [], issues: [], drills: [] };
    }

    const emptyFinal =
      (!report.strengths?.length) && (!report.issues?.length) && (!report.drills?.length);
    if (emptyFinal) throw new Error("Model boş içerik döndürdü (frames yetersiz olabilir).");

    await supabase
      .from("video_analyses")
      .update({ status: "done", report, version: ANALYZER_VERSION, updated_at: new Date().toISOString() })
      .eq("id", analysisId);

    return NextResponse.json({ from_cache: false, report, meta: { model: DEFAULT_VISION_MODEL } });
  } catch (e: any) {
    await supabase.from("video_analyses").update({ status: "failed" }).eq("id", analysisId);
    return NextResponse.json({ error: e?.message || "analysis failed" }, { status: 500 });
  } finally {
    try { await fs.unlink(tmpPath); } catch {}
  }
}
