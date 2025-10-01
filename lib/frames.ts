// lib/frames.ts
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * temp input mp4 ->  /tmp/frames_xxx -> base64 jpg dizi
 * Basit ve sağlam: ~ her 3 sn'de 1 kare, max N kare, ölçek küçült (768px genişlik)
 */
export async function extractJpegFramesBase64(
  inputPath: string,
  opts?: { fps?: string; maxFrames?: number; width?: number }
) {
  const fps = opts?.fps ?? "1/3";           // her 3sn'de 1 kare
  const maxFrames = opts?.maxFrames ?? 8;   // maliyet kontrol
  const width = opts?.width ?? 768;         // hız + token tasarrufu

  const outDir = path.join("/tmp", `frames_${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  // ffmpeg komutu:
  // -vf "fps=1/3,scale=768:-1" ile çerçeve/ölçek
  const args = [
    "-i", inputPath,
    "-vf", `fps=${fps},scale=${width}:-1`,
    "-qscale:v", "3",
    path.join(outDir, "f_%03d.jpg"),
    "-hide_banner",
    "-loglevel", "error"
  ];

  await run(ffmpegPath as string, args);

  // dosyaları sırala, maxFrames ile sınırla, base64'e çevir
  const files = (await fs.readdir(outDir))
    .filter(f => f.endsWith(".jpg"))
    .sort()
    .slice(0, maxFrames);

  const images: { type: "input_image"; image_url: string; detail: "low" }[] = [];
  for (const f of files) {
    const b = await fs.readFile(path.join(outDir, f));
    const b64 = b.toString("base64");
    images.push({
      type: "input_image",
      image_url: `data:image/jpeg;base64,${b64}`,
      detail: "low", // low = ucuz ve yeterli
    });
  }
  return images;
}

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args);
    let stderr = "";
    p.stderr?.on("data", d => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}
