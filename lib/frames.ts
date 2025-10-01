// lib/frames.ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

type ExtractOpts = {
  fps?: string;      // örn "2" ya da "0.5"
  maxFrames?: number;
  width?: number;    // hedef genişlik
};

export async function extractJpegFramesBase64(
  videoPath: string,
  opts: ExtractOpts = {}
): Promise<{ image_url: string }[]> {
  const fps = opts.fps ?? "2";
  const maxFrames = Math.max(1, Math.min(opts.maxFrames ?? 24, 64));
  const width = Math.max(256, Math.min(opts.width ?? 896, 1920));

  const ffmpegPath =
    process.env.FFMPEG_PATH ||
    (require("ffmpeg-static") as string) ||
    "ffmpeg";

  const outDir = path.join("/tmp", "vb_frames_" + Date.now());
  await fs.mkdir(outDir, { recursive: true });

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

  const files = (await fs.readdir(outDir)).filter(f => f.endsWith(".jpg")).sort();

  const frames: { image_url: string }[] = [];
  for (const f of files) {
    const bin = await fs.readFile(path.join(outDir, f));
    frames.push({ image_url: `data:image/jpeg;base64,${bin.toString("base64")}` });
  }

  try { await fs.rm(outDir, { recursive: true, force: true }); } catch {}
  return frames;
}
