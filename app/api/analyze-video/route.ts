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

const ANALYZER_VERSION = 3;

type VideoRow = { id: string; storage_path: string };

// OpenAI vision parçası için explicit union
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

  if (!force) {
    const { data: cached } = await supabase
      .from("video_analyses")
      .select("*")
      .eq("video_id", videoId)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const isEmpty = !cached?.report?.strengths?.length && !cached?.report?.issues?.length && !cached?.report?.drills?.length;
    const isStale = (cached?.version ?? 0) !== ANALYZER_VERSION;

    if (cached?.report && !isEmpty && !isStale) {
      return NextResponse.json({
        from_cache: true,
        report: cached.report as VbReport,
        meta: { version: cached.version, model: cached.model, created_at: cached.created_at }
      });
    }
  }

  const { data: active } = await supabase
    .from("video_analyses")
    .select("id")
    .eq("video_id", videoId)
    .in("status", ["pending", "processing"])
    .maybeSingle();
  if (active) return NextResponse.json({ queued: true, message: "Analysis already in progress." }, { status: 202 });

  const { data: videoRow, error: vErr } = await supabase
    .from("videos")
    .select("id, storage_path")
    .eq("id", videoId)
    .maybeSingle<VideoRow>();
  if (vErr || !videoRow?.storage_path) {
    return NextResponse.json({ error: vErr?.message || "video not found" }, { status: 404 });
  }

  const { data: file, error: dErr } = await supabase.storage.from(bucket).download(videoRow.storage_path);
  if (dErr || !file) return NextResponse.json({ error: dErr?.message || "download failed" }, { status: 500 });

  const buf = Buffer.from(await file.arrayBuffer());
  const tmpPath = path.join("/tmp", `${videoId}_${crypto.randomBytes(4).toString("hex")}.mp4`);
  await fs.writeFile(tmpPath, buf);

  const { data: created, error: insErr } = await supabase
    .from("video_analyses")
    .insert({
      video_id: videoId,
      status: "pending",
      model: DEFAULT_VISION_MODEL,
      version: ANALYZER_VERSION,
      params: { mode: "fps", fps: "2", frames: 8, width: 640 }
    })
    .select()
    .single();
  if (insErr || !created) return NextResponse.json({ error: insErr?.message || "insert failed" }, { status: 500 });
  const analysisId = created.id;

  try {
    // 1) Kareler
    const framesRaw = await extractJpegFramesBase64(tmpPath, { fps: "2", maxFrames: 8, width: 640 });
    if (!framesRaw.length) throw new Error("No frames extracted");

    // 2) İlk 2 kare high detail
    const frames: VisionPart[] = framesRaw.map((f, i) =>
      i < 2 ? { type: "input_image", image_url: f.image_url, detail: "high" }
            : { type: "input_image", image_url: f.image_url, detail: "low" }
    );

    await supabase.from("video_analyses").update({ status: "processing" }).eq("id", analysisId);

    // 3) Prompt
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
`;

    const content: VisionPart[] = [{ type: "input_text", text: prompt }, ...frames];

    const resp = await openai.responses.create({
      model: DEFAULT_VISION_MODEL,
      input: [{ role: "user", content }],
      temperature: 0,
    });

    const text = resp.output_text ?? "{}";
    let report: VbReport = { strengths: [], issues: [], drills: [] };
    try { report = JSON.parse(text); } catch {}

    const empty = (!report.strengths?.length) && (!report.issues?.length) && (!report.drills?.length);
    if (empty) throw new Error("Model boş içerik döndürdü (frames yetersiz olabilir).");

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
