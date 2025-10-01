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

const ANALYZER_VERSION = 4;

type VideoRow = { id: string; storage_path: string };

type VisionPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" };

export async function POST(req: NextRequest) {
  const { videoId, force } = await req.json();
  if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const bucket      = process.env.SUPABASE_VIDEOS_BUCKET || "videos";
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Supabase env missing" }, { status: 500 });

  const supabase = createClient(supabaseUrl, serviceKey);

  // cache kontrolü
  if (!force) {
    const { data: cached } = await supabase
      .from("video_analyses").select("*")
      .eq("video_id", videoId).eq("status", "done")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    const isEmpty = !cached?.report?.strengths?.length && !cached?.report?.issues?.length && !cached?.report?.drills?.length;
    const isStale = (cached?.version ?? 0) !== ANALYZER_VERSION;

    if (cached?.report && !isEmpty && !isStale) {
      return NextResponse.json({
        report: cached.report as VbReport,
        meta: { version: cached.version, model: cached.model, created_at: cached.created_at }
      });
    }
  }

  // aktif iş?
  const { data: active } = await supabase
    .from("video_analyses").select("id")
    .eq("video_id", videoId).in("status", ["pending","processing"]).maybeSingle();
  if (active) return NextResponse.json({ queued: true, message: "Analysis already in progress." }, { status: 202 });

  // video
  const { data: videoRow, error: vErr } = await supabase
    .from("videos").select("id, storage_path").eq("id", videoId).maybeSingle<VideoRow>();
  if (vErr || !videoRow?.storage_path) return NextResponse.json({ error: vErr?.message || "video not found" }, { status: 404 });

  // indir
  const { data: file, error: dErr } = await supabase.storage.from(bucket).download(videoRow.storage_path);
  if (dErr || !file) return NextResponse.json({ error: dErr?.message || "download failed" }, { status: 500 });

  const buf = Buffer.from(await file.arrayBuffer());
  const tmpPath = path.join("/tmp", `${videoId}_${crypto.randomBytes(4).toString("hex")}.mp4`);
  await fs.writeFile(tmpPath, buf);

  // pending kaydı
  const { data: created, error: insErr } = await supabase
    .from("video_analyses").insert({
      video_id: videoId,
      status: "pending",
      model: DEFAULT_VISION_MODEL,
      version: ANALYZER_VERSION,
      params: { mode: "fps", fps: "4→6(fallback)", frames: 16, width: 768 }
    }).select().single();
  if (insErr || !created) return NextResponse.json({ error: insErr?.message || "insert failed" }, { status: 500 });
  const analysisId = created.id;

  try {
    // 1. pas
    let framesRaw = await extractJpegFramesBase64(tmpPath, { fps: "4", maxFrames: 16, width: 768 });
    if (!framesRaw.length) throw new Error("No frames extracted");

    let frames: VisionPart[] = framesRaw.map((f, i) =>
      i < 6 ? { type: "input_image", image_url: f.image_url, detail: "high" }
            : { type: "input_image", image_url: f.image_url, detail: "low" }
    );

    await supabase.from("video_analyses").update({ status: "processing" }).eq("id", analysisId);

    const prompt = `
Sen profesyonel bir voleybol analistisın. Görüntülerde smaç/antrenman sekanslarını değerlendir.
Aşamalar: yaklaşma, sıçrama, kol salınımı, bilek teması, iniş, core/denge, kol-bacak senkronu.
KURAL: Sadece geçerli JSON döndür; her listede en az 3 madde; boş liste yok; cümleler kısa ve spesifik.
JSON: {"strengths":["..."],"issues":["..."],"drills":["..."]}
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
        required: ["strengths","issues","drills"],
        additionalProperties: false
      }
    };

    const content1: VisionPart[] = [{ type: "input_text", text: prompt }, ...frames];

    let resp = await openai.responses.create({
      model: DEFAULT_VISION_MODEL,
      input: [{ role: "user", content: content1 }],
      temperature: 0,
      text: { format: jsonFormat }
    } as any);

    let text = resp.output_text ?? "{}";
    let report: VbReport = { strengths: [], issues: [], drills: [] };
    try { report = JSON.parse(text); } catch {}

    // fallback
    const empty1 = (!report.strengths?.length) && (!report.issues?.length) && (!report.drills?.length);
    if (empty1) {
      framesRaw = await extractJpegFramesBase64(tmpPath, { fps: "6", maxFrames: 20, width: 768 });
      if (!framesRaw.length) throw new Error("No frames extracted (fallback)");

      frames = framesRaw.map((f) => ({ type: "input_image", image_url: f.image_url, detail: "high" as const }));
      const content2: VisionPart[] = [{ type: "input_text", text: prompt }, ...frames];

      resp = await openai.responses.create({
        model: DEFAULT_VISION_MODEL,
        input: [{ role: "user", content: content2 }],
        temperature: 0,
        text: { format: jsonFormat }
      } as any);

      text = resp.output_text ?? "{}";
      try { report = JSON.parse(text); } catch {}
    }

    const emptyFinal = (!report.strengths?.length) && (!report.issues?.length) && (!report.drills?.length);
    if (emptyFinal) throw new Error("Model boş içerik döndürdü (frames yetersiz olabilir).");

    await supabase
      .from("video_analyses")
      .update({ status: "done", report, version: ANALYZER_VERSION, updated_at: new Date().toISOString() })
      .eq("id", analysisId);

    return NextResponse.json({ report, meta: { model: DEFAULT_VISION_MODEL } });
  } catch (e: any) {
    await supabase.from("video_analyses").update({ status: "failed" }).eq("id", analysisId);
    return NextResponse.json({ error: e?.message || "analysis failed" }, { status: 500 });
  } finally {
    try { await fs.unlink(tmpPath); } catch {}
  }
}
