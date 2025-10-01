// app/api/analyze-video/route.ts
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

// Cache’i kırmak için sürüm artırıldı (önceki boş raporları yok sayalım)
const ANALYZER_VERSION = 4;

type VideoRow = { id: string; storage_path: string };

// OpenAI vision content’i için explicit union tipi
type VisionPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" };

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

  // 1) Cache: boş/eskimiş ise YOK SAY
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

  // 2) Aktif iş var mı?
  const { data: active } = await supabase
    .from("video_analyses")
    .select("id")
    .eq("video_id", videoId)
    .in("status", ["pending", "processing"])
    .maybeSingle();
  if (active) {
    return NextResponse.json({ queued: true, message: "Analysis already in progress." }, { status: 202 });
  }

  // 3) Video satırı
  const { data: videoRow, error: vErr } = await supabase
    .from("videos")
    .select("id, storage_path")
    .eq("id", videoId)
    .maybeSingle<VideoRow>();

  if (vErr || !videoRow?.storage_path) {
    return NextResponse.json({ error: vErr?.message || "video not found" }, { status: 404 });
  }

  // 4) Storage → /tmp
  const { data: file, error: dErr } = await supabase.storage.from(bucket).download(videoRow.storage_path);
  if (dErr || !file) {
    return NextResponse.json({ error: dErr?.message || "download failed" }, { status: 500 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const tmpPath = path.join("/tmp", `${videoId}_${crypto.randomBytes(4).toString("hex")}.mp4`);
  await fs.writeFile(tmpPath, buf);

  // 5) pending kaydı
  const { data: created, error: insErr } = await supabase
    .from("video_analyses")
    .insert({
      video_id: videoId,
      status: "pending",
      model: DEFAULT_VISION_MODEL,
      version: ANALYZER_VERSION,
      params: { mode: "fps", fps: "4→6(fallback)", frames: 16, width: 768 }
    })
    .select()
    .single();
  if (insErr || !created) {
    return NextResponse.json({ error: insErr?.message || "insert failed" }, { status: 500 });
  }
  const analysisId = created.id;

  try {
    // =========================
    // 6) KARE ÇIKAR — 1. DENEME
    // =========================
    let framesRaw = await extractJpegFramesBase64(tmpPath, {
      fps: "4",
      maxFrames: 16,
      width: 768,
    });
    if (!framesRaw.length) throw new Error("No frames extracted");

    // İlk 6 kare high, diğerleri low
    let frames: VisionPart[] = framesRaw.map((f, i) =>
      i < 6
        ? { type: "input_image", image_url: f.image_url, detail: "high" }
        : { type: "input_image", image_url: f.image_url, detail: "low" }
    );

    await supabase.from("video_analyses").update({ status: "processing" }).eq("id", analysisId);

    const prompt = `
Sen profesyonel bir voleybol analistisın. Görüntülerde smaç/antrenman sekanslarını değerlendir.
Aşamalar: yaklaşma, sıçrama, kol salınımı, bilek teması, iniş, core/denge, kol-bacak senkronu.

KURAL:
- SADECE geçerli JSON döndür.
- Her listede EN AZ 3 madde olsun. Görüntü sınırlıysa en olası gözlemi yaz; boş liste YOK.
- Cümleler kısa ve spesifik olsun (maks 15 kelime). Teknik terim kullan.

JSON ŞEMASI:
{
  "strengths": ["...","...","..."],
  "issues": ["...","...","..."],
  "drills": ["...","...","..."]
}
`.trim();

    const vbSchema = {
      name: "vb_report",
      schema: {
        type: "object",
        properties: {
          strengths: { type: "array", items: { type: "string" }, minItems: 3 },
          issues:    { type: "array", items: { type: "string" }, minItems: 3 },
          drills:    { type: "array", items: { type: "string" }, minItems: 3 }
        },
        required: ["strengths", "issues", "drills"],
        additionalProperties: false
      },
      strict: true
    };

    const content1: VisionPart[] = [{ type: "input_text", text: prompt }, ...frames];

    // TS tipi henüz 'response_format' için schema’yı bilmiyor -> 'as any' ile geçiyoruz
    let resp = await openai.responses.create({
      model: DEFAULT_VISION_MODEL,
      input: [{ role: "user", content: content1 }],
      temperature: 0,
      response_format: { type: "json_schema", json_schema: vbSchema } as any,
    });

    let text = resp.output_text ?? "{}";
    let report: VbReport = { strengths: [], issues: [], drills: [] };
    try { report = JSON.parse(text); } catch {}

    // =========================
    // 7) FALLBACK — 2. DENEME
    // =========================
    const empty1 = (!report.strengths?.length) && (!report.issues?.length) && (!report.drills?.length);
    if (empty1) {
      // Daha da agresif sampling + tüm kareler high
      framesRaw = await extractJpegFramesBase64(tmpPath, {
        fps: "6",
        maxFrames: 20,
        width: 768,
      });
      if (!framesRaw.length) throw new Error("No frames extracted (fallback)");

      frames = framesRaw.map((f) => ({ type: "input_image", image_url: f.image_url, detail: "high" as const }));
      const content2: VisionPart[] = [{ type: "input_text", text: prompt }, ...frames];

      resp = await openai.responses.create({
        model: DEFAULT_VISION_MODEL,
        input: [{ role: "user", content: content2 }],
        temperature: 0,
        response_format: { type: "json_schema", json_schema: vbSchema } as any,
      });

      text = resp.output_text ?? "{}";
      try { report = JSON.parse(text); } catch {}
    }

    const emptyFinal = (!report.strengths?.length) && (!report.issues?.length) && (!report.drills?.length);
    if (emptyFinal) throw new Error("Model boş içerik döndürdü (frames yetersiz olabilir).");

    // 8) Kaydet → done
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
