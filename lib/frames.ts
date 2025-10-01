// lib/frames.ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

export async function extractJpegFramesBase64(
  inputPath: string,
  opts?: { fps?: string; maxFrames?: number; width?: number }
) {
  const fps = opts?.fps ?? "1/3";
  const maxFrames = opts?.maxFrames ?? 8;
  const width = opts?.width ?? 768;

  const outDir = path.join("/tmp", `frames_${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  const ff = ffmpegInstaller.path;   // ← garantili binary yolu
  console.log("FFMPEG PATH =>", ff);

  const args = [
    "-i", inputPath,
    "-vf", `fps=${fps},scale=${width}:-1`,
    "-qscale:v", "3",
    path.join(outDir, "f_%03d.jpg"),
    "-hide_banner",
    "-loglevel", "error",
  ];

  await run(ff, args);

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
      detail: "low",
    });
  }
  return images;
}

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args);
    let stderr = "";
    p.stderr?.on("data", d => (stderr += d.toString()));
    p.on("error", (err) =>
      reject(new Error(`FFmpeg spawn hatası: ${(err as Error).message}`))
    );
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `FFmpeg exit code ${code}`));
    });
  });
}
