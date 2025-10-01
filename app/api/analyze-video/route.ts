// app/api/analyze-video/route.ts
import { NextRequest, NextResponse } from "next/server";
import { openai, DEFAULT_VISION_MODEL, VbReport } from "@/lib/openai";

// Gerekirse Node runtime:
// export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();
    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 });
    }

    // DEMO: gerçek frame yerine tek görsel. ffmpeg’i sonraki adımda ekleyeceğiz.
    const demoImage = {
      type: "input_image" as const,
      image_url:
        "https://upload.wikimedia.org/wikipedia/commons/7/7e/Volleyball_player.jpg",
      detail: "low" as const, // low | high
    };

    // Modele net talimat: sadece geçerli JSON dön.
    const prompt = `
Sen profesyonel bir voleybol analistisın.
Aşamalar: yaklaşma, sıçrama, kol salınımı, bilek teması, iniş.
Kısa ve net yaz. SADECE aşağıdaki JSON şemasına uygun döndür:

{
  "strengths": ["...","..."],
  "issues": ["...","..."],
  "drills": ["...","..."]
}

Açıklama metni, markdown, ek alan YOK. Sadece geçerli JSON.
`;

    const resp = await openai.responses.create({
      model: DEFAULT_VISION_MODEL, // "gpt-4o-mini"
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            demoImage,
          ],
        },
      ],
      temperature: 0,
    });

    // Metin çıktısını çek ve JSON'a çevir
    const text = resp.output_text ?? "";
    let report: VbReport = { strengths: [], issues: [], drills: [] };

    try {
      const parsed = JSON.parse(text);
      // Basit doğrulama
      report = {
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        drills: Array.isArray(parsed.drills) ? parsed.drills : [],
      };
    } catch {
      // Model JSON dışına kaçarsa boş şablon döndür.
    }

    return NextResponse.json(report);
  } catch (err: any) {
    console.error("Analysis failed:", err);
    return NextResponse.json(
      { error: err.message ?? "Analysis failed" },
      { status: 500 }
    );
  }
}
