// app/api/analyze-video/route.ts
export const runtime = "nodejs";          // ← İstediğin gibi başa ekledim
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { openai, DEFAULT_VISION_MODEL, VbReport } from "@/lib/openai";
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { extractJpegFramesBase64 } from "@/lib/frames";

type VideoRow = {
  id: string;
  storage_path: string;
};

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

  // 1) Cache kontrol
  if (!force) {
    const { data: cached } = await supabase
      .from("video_analyses")
      .select("*")
      .eq("video_id", videoId)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.report) {
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
    .in("status", ["pending","processing"])
    .maybeSingle();

  if (active) {
    return NextResponse.json({ queued: true, message: "Analysis already in progress." }, { status: 202 });
  }

  // 3) Video yolunu al
  const { data: videoRow, error: vErr } = await supabase
    .from("videos")
    .select("id, storage_path")
    .eq("id", videoId)
    .maybeSingle<VideoRow>();
  if (vErr || !videoRow?.storage_path) {
    return NextResponse.json({ error: vErr?.message || "video not found" }, { status: 404 });
  }

  // 4) Storage'tan indir → /tmp
  const { data: file, error: dErr } = await supabase.storage.from(bucket).download(videoRow.storage_path);
  if (dErr || !file) return NextResponse.json({ error: dErr?.message || "download failed" }, { status: 500 });

  const buf = Buffer.from(await file.arrayBuffer());
  const tmpPath = path.join("/tmp", `${videoId}_${crypto.randomBytes(4).toString("hex")}.mp4`);
  await fs.writeFile(tmpPath, buf);

  // 5) pending kaydı
  const { data: created, error: insErr } = await supabase
    .from("video_analyses")
    .insert({ video_id: videoId, status: "pending", model: DEFAULT_VISION_MODEL, params: { fps: "1/3", frames: 8, width: 768 } })
    .select()
    .single();
  if (insErr || !created) return NextResponse.json({ error: insErr?.message || "insert failed" }, { status: 500 });

  const analysisId = created.id;

  try {
    // 6) Kare çıkar
    const frames = await extractJpegFramesBase64(tmpPath, { fps: "1/3", maxFrames: 8, width: 768 });
    if (!frames.length) throw new Error("No frames extracted");

    await supabase.from("video_analyses").update({ status: "processing" }).eq("id", analysisId);

    // 7) GPT çağrısı (sadece geçerli JSON)
    const prompt = `
Sen profesyonel bir voleybol analistisın.
Aşamalar: yaklaşma, sıçrama, kol salınımı, bilek teması, iniş.
SADECE geçerli JSON döndür:
{"strengths":[],"issues":[],"drills":[]}
`;

    const resp = await openai.responses.create({
      model: DEFAULT_VISION_MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...frames] }],
      temperature: 0,
    });

    const text = resp.output_text ?? "{}";
    let report: VbReport = { strengths: [], issues: [], drills: [] };
    try { report = JSON.parse(text); } catch {}

    await supabase.from("video_analyses")
      .update({ status: "done", report, updated_at: new Date().toISOString() })
      .eq("id", analysisId);

    return NextResponse.json({ from_cache: false, report, meta: { model: DEFAULT_VISION_MODEL } });
  } catch (e: any) {
    await supabase.from("video_analyses").update({ status: "failed" }).eq("id", analysisId);
    return NextResponse.json({ error: e?.message || "analysis failed" }, { status: 500 });
  } finally {
    try { await fs.unlink(tmpPath); } catch {}
  }
}
