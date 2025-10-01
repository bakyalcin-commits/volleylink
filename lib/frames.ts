// lib/frames.ts
// Kare çıkarma: ffmpeg-static + child_process
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

type ExtractOpts = {
  /** ffmpeg fps filtresi; örn "2" (2 fps) veya "0.5" (2 sn'de 1 kare) */
  fps?: string;
  /** maksimum kare sayısı (1..64) */
  maxFrames?: number;
  /** jpeg genişliği (yükseklik orantılı) 256..1920 */
  width?: number;
};

export async function extractJpegFramesBase64(
  videoPath: string,
  opts: ExtractOpts = {}
): Promise<{ image_url: string }[]> {
  const fps = opts.fps ?? "2"; // default: 2 fps
  const maxFrames = Math.max(1, Math.min(opts.maxFrames ?? 24, 64));
  const width = Math.max(256, Math.min(opts.width ?? 896, 1920));

  // ffmpeg yolunu çöz
  const ffmpegPath =
    process.env.FFMPEG_PATH ||
    (require("ffmpeg-static") as string) ||
    "ffmpeg";

  // temp klasörü
  const outDir = path.join("/tmp", "vb_frames_" + Date.now());
  await fs.mkdir(outDir, { recursive: true });

  // ffmpeg komutu
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        videoPath,
        "-vf",
        `fps=${fps},scale=${width}:-2`,
        "-frames:v",
        String(maxFrames),
        path.join(outDir, "f_%03d.jpg")
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `ffmpeg exited with code ${code}`));
    });
  });

  // dosyaları sırayla oku → base64 url listesi
  const files = (await fs.readdir(outDir))
    .filter((f) => f.endsWith(".jpg"))
    .sort();

  const frames: { image_url: string }[] = [];
  for (const f of files) {
    const abs = path.join(outDir, f);
    const bin = await fs.readFile(abs);
    frames.push({ image_url: `data:image/jpeg;base64,${bin.toString("base64")}` });
  }

  // temizlik
  try {
    await fs.rm(outDir, { recursive: true, force: true });
  } catch {}

  return frames;
}
