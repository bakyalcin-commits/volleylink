// app/api/analyze-video/route.ts
import { NextRequest, NextResponse } from "next/server";
import { openai, DEFAULT_VISION_MODEL, VbReport } from "@/lib/openai";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const { videoId, force } = await req.json();
  if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

  // 2) PENDING/PROCESSING var mı? varsa ikinci kez tetikleme.
  const { data: active } = await supabase
    .from("video_analyses")
    .select("id")
    .eq("video_id", videoId)
    .in("status", ["pending", "processing"])
    .maybeSingle();

  if (active) {
    return NextResponse.json({ queued: true, message: "Analysis already in progress." }, { status: 202 });
  }

  // 3) yeni kayıt (pending)
  const { data: created, error: insErr } = await supabase
    .from("video_analyses")
    .insert({
      video_id: videoId,
      status: "pending",
      model: DEFAULT_VISION_MODEL,
      params: { frames: 1, detail: "low" } // şimdilik demo
    })
    .select()
    .single();

  if (insErr || !created) {
    return NextResponse.json({ error: insErr?.message || "insert failed" }, { status: 500 });
  }

  const analysisId = created.id;

  try {
    // 4) (DEMO) Görsel + prompt ile model çağrısı (gerçek frame’i sonra bağlayacağız)
    const demoImage = {
      type: "input_image" as const,
      image_url: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Volleyball_player.jpg",
      detail: "low" as const,
    };

    const prompt = `
Sen profesyonel bir voleybol analistisın.
Aşamalar: yaklaşma, sıçrama, kol salınımı, bilek teması, iniş.
SADECE şu JSON'u döndür:
{"strengths":[],"issues":[],"drills":[]}
`;

    // status -> processing
    await supabase.from("video_analyses").update({ status: "processing" }).eq("id", analysisId);

    const resp = await openai.responses.create({
      model: DEFAULT_VISION_MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }, demoImage] }],
      temperature: 0,
    });

    const text = resp.output_text ?? "{}";
    let report: VbReport = { strengths: [], issues: [], drills: [] };
    try { report = JSON.parse(text); } catch {}

    // 5) kaydet -> done
    await supabase
      .from("video_analyses")
      .update({ status: "done", report, updated_at: new Date().toISOString() })
      .eq("id", analysisId);

    return NextResponse.json({ from_cache: false, report, meta: { model: DEFAULT_VISION_MODEL } });
  } catch (e: any) {
    // hata -> failed
    await supabase.from("video_analyses").update({ status: "failed" }).eq("id", analysisId);
    return NextResponse.json({ error: e?.message || "analysis failed" }, { status: 500 });
  }
}
