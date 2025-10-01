// lib/frames.ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as os from "node:os";

// FFmpeg komutunu çalıştır
function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args);
    let stderr = "";
    p.stderr?.on("data", d => (stderr += d.toString()));
    p.on("error", (err) => reject(new Error(`FFmpeg spawn hatası: ${(err as Error).message}`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exit code ${code}`))));
  });
}

// Platforma uygun ffmpeg binary yolu (@ffmpeg-installer/ffmpeg)
async function ffmpegPath(): Promise<string> {
  const mod = await import("@ffmpeg-installer/ffmpeg"); // dinamik import
  return (mod as any).path as string;
}

/**
 * Sahne algılı kare çıkarma:
 * - 2 sn başını atlar (ss)
 * - scene cut ile anlamlı değişimleri seçer
 * - çok karanlık/bozuk kareleri eleyip en fazla maxFrames kadar kare döndürür
 * - base64 JPEG döner (OpenAI vision input_image için)
 */
export async function extractJpegFramesBase64(
  inputPath: string,
  opts?: { maxFrames?: number; width?: number; scene?: number; ss?: number }
) {
  const maxFrames = opts?.maxFrames ?? 8;
  const width = opts?.width ?? 640;
  const scene = opts?.scene ?? 0.25; // sahne eşiği
  const ss = opts?.ss ?? 2;          // başlangıç ofseti (s)

  const outDir = path.join(os.tmpdir(), `frames_${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  const ff = await ffmpegPath();

  // 1) Sahne değişimine göre kareleri çıkar
  const pattern = path.join(outDir, "f_%04d.jpg");
  const vf = [
    `select='gt(scene,${scene})'`, // sahne değişimi
    `scale=${width}:-1`,
    "yadif=0:-1:0",                 // varsa interlace düzelt
  ].join(",");

  const args1 = [
    "-ss", String(ss),
    "-i", inputPath,
    "-vf", vf,
    "-vsync", "vfr",
    "-qscale:v", "3",
    pattern,
    "-hide_banner",
    "-loglevel", "error",
  ];
  await run(ff, args1);

  // 2) Çok karanlık/bozuk kareleri ayıkla (basit boyut eşiği)
  const filesAll = (await fs.readdir(outDir)).filter(f => f.endsWith(".jpg")).sort();
  const kept: string[] = [];
  for (const f of filesAll) {
    const p = path.join(outDir, f);
    const stat = await fs.stat(p);
    if (stat.size < 10 * 1024) continue; // 10KB altı genelde kullanılmaz
    kept.push(p);
    if (kept.length >= maxFrames) break;
  }

  // 3) Hiç sahne yakalanamadıysa → düzenli sampling fallback
  if (kept.length === 0) {
    const fallbackPattern = path.join(outDir, "r_%04d.jpg");
    const args2 = [
      "-ss", String(ss),
      "-i", inputPath,
      "-vf", `fps=2,scale=${width}:-1`,
      "-qscale:v", "3",
      fallbackPattern,
      "-hide_banner",
      "-loglevel", "error",
    ];
    await run(ff, args2);
    const fb = (await fs.readdir(outDir)).filter(f => f.startsWith("r_")).sort().slice(0, maxFrames);
    for (const f of fb) kept.push(path.join(outDir, f));
  }

  // 4) Base64 olarak döndür
  const images: { type: "input_image"; image_url: string; detail: "low" }[] = [];
  for (const p of kept) {
    const b = await fs.readFile(p);
    images.push({
      type: "input_image",
      image_url: `data:image/jpeg;base64,${b.toString("base64")}`,
      detail: "low",
    });
  }
  return images;
}
