// app/api/analyze-video/route.ts

export const runtime = "nodejs";          // Edge değil, Node runtime
export const dynamic = "force-dynamic";   // cache yok / serverless
export const maxDuration = 60;            // Vercel function time limit (opsiyonel)

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
  bucket?: string | null;
};

export async function POST(req: NextRequest) {
  const { videoId, force } = await req.json();
  if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const defaultBucket = process.env.SUPABASE_VIDEOS_BUCKET || "videos";

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase env missing" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1) DONE varsa ve force değilse -> cache’ten dön
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

  // 2) aktif iş var mı?
  const { data: active } = await supabase
    .from("video_analyses")
    .select("id")
    .eq("video_id", videoId)
    .in("status", ["pending", "processing"])
    .maybeSingle();

  if (active) {
    return NextResponse.json({ queued: true, message: "Analysis already in progress." }, { status: 202 });
  }

  // 3) video tablosundan dosya yolunu çek
  const { data: videoRow, error: vErr } = await supabase
    .from("videos")
    .select("id, storage_path, bucket")
    .eq("id", videoId)
    .maybeSingle<VideoRow>();

  if (vErr || !videoRow?.storage_path) {
    return NextResponse.json({ error: vErr?.message || "video not found" }, { status: 404 });
  }

  const bucket = videoRow.bucket || defaultBucket;

  // 4) storage’tan indir -> /tmp
  const { data: file, error: dErr } = await supabase
    .storage
    .from(bucket)
    .download(videoRow.storage_path);

  if (dErr || !file) {
    return NextResponse.json({ error: dErr?.message || "download failed" }, { status: 500 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const tmpPath = path.join("/tmp", `${videoId}_${crypto.randomBytes(4).toString("hex")}.mp4`);
  await fs.writeFile(tmpPath, buf);

  // 5) pending kaydı oluştur
  const { data: created, error: insErr } = await supabase
    .from("video_analyses")
    .insert({
      video_id: videoId,
      status: "pending",
      model: DEFAULT_VISION_MODEL,
      params: { fps: "2", frames: 8, width: 640 }
    })
    .select()
    .single();

  if (insErr || !created) {
    return NextResponse.json({ error: insErr?.message || "insert failed" }, { status: 500 });
  }

  const analysisId = created.id;

  try {
    // 6) frame çıkar (fps=2, en fazla 8 kare)
    const framesRaw = await extractJpegFramesBase64(tmpPath, { fps: "2", maxFrames: 8, width: 640 });

    if (!framesRaw.length) {
      throw new Error("No frames extracted");
    }

    // ilk 2 kare high detail
    const frames = framesRaw.map((f, i) =>
      i < 2 ? { ...f, detail: "high" as const } : f
    );

    await supabase.from("video_analyses").update({ status: "processing" }).eq("id", analysisId);

    // 7) GPT çağrısı
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

    const resp = await openai.responses.create({
      model: DEFAULT_VISION_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...frames,
          ],
        },
      ],
      temperature: 0,
    });

    const text = resp.output_text ?? "{}";
    let report: VbReport = { strengths: [], issues: [], drills: [] };
    try { report = JSON.parse(text); } catch {}

    const emptyLists =
      (!report.strengths?.length) &&
      (!report.issues?.length) &&
      (!report.drills?.length);

    if (emptyLists) {
      throw new Error("Model boş içerik döndürdü (frames yetersiz olabilir).");
    }

    await supabase
      .from("video_analyses")
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
