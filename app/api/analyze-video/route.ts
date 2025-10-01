// app/api/analyze-video/route.ts
import { NextRequest, NextResponse } from "next/server";
import { openai, DEFAULT_VISION_MODEL, VbReport } from "@/lib/openai";

// (İstersen) Edge yerine Node koşsun:
// export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();
    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 });
    }

    // DEMO: gerçek frame yerine tek görsel kullanıyoruz.
    const demoImage = {
      type: "input_image" as const,
      image_url: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Volleyball_player.jpg",
      detail: "low" as const, // low|high (SDK bu alanı bekliyor)
    };

    const prompt = `
Sen profesyonel bir voleybol analistisın.
Aşamalar: yaklaşma, sıçrama, kol salınımı, bilek teması, iniş.
Çıktıyı kısa ve net tut: strengths, issues, drills (en fazla 5'er madde).
`;

    // Structured Outputs: sabit JSON şeması
    const schema = {
      type: "object",
      properties: {
        strengths: { type: "array", items: { type: "string" } },
        issues: { type: "array", items: { type: "string" } },
        drills: { type: "array", items: { type: "string" } },
      },
      required: ["strengths", "issues", "drills"],
      additionalProperties: false,
    };

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
      response_format: {
        type: "json_schema",
        json_schema: { name: "vb_report", schema, strict: true },
      },
    });

    // JSON çıktıyı güvenli biçimde çek
    let report: VbReport = { strengths: [], issues: [], drills: [] };
    for (const block of resp.output ?? []) {
      for (const c of block.content) {
        if (c.type === "output_json") {
          report = c.parsed as VbReport;
        }
      }
    }

    return NextResponse.json(report);
  } catch (err: any) {
    console.error("Analysis failed:", err);
    return NextResponse.json(
      { error: err.message ?? "Analysis failed" },
      { status: 500 },
    );
  }
}
