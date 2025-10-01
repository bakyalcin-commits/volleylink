// app/api/analyze-video/route.ts
import { NextRequest, NextResponse } from "next/server";
import { openai, DEFAULT_VISION_MODEL, VbReport } from "@/lib/openai";

export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 });
    }

    // DEMO: şimdilik video yerine sabit bir resim veriyoruz.
    // Sonraki adımda ffmpeg ile kare çıkarıp buraya koyacağız.
    const demoImage = {
      type: "input_image",
      image_url: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Volleyball_player.jpg"
    };

    const prompt = `
Sen profesyonel bir voleybol analistisın. 
Videodan seçilen karelere bakarak oyuncunun vuruş tekniğini değerlendir.
- Güçlü yanları
- Hataları
- Geliştirmek için drill önerileri
Yanıtı JSON formatında ver.
`;

    const schema = {
      type: "object",
      properties: {
        strengths: { type: "array", items: { type: "string" } },
        issues: { type: "array", items: { type: "string" } },
        drills: { type: "array", items: { type: "string" } }
      },
      required: ["strengths", "issues", "drills"],
      additionalProperties: false
    };

    const response = await openai.responses.create({
      model: DEFAULT_VISION_MODEL,
      input: [
        { role: "user", content: [{ type: "text", text: prompt }, demoImage] }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "vb_report", schema }
      }
    });

    const content = response.output?.[0]?.content?.[0];
    const report: VbReport =
      content && "json" in content ? (content as any).json : null;

    return NextResponse.json(report ?? { strengths: [], issues: [], drills: [] });
  } catch (err: any) {
    console.error("Analysis failed:", err);
    return NextResponse.json(
      { error: err.message || "Analysis failed" },
      { status: 500 }
    );
  }
}
