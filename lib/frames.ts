// lib/frames.ts
import { spawn } from "child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const ffmpegPath = ffmpegInstaller.path;

/**
 * Videodan JPEG kareleri çıkarır ve base64 olarak döndürür.
 * Basit fps tabanlı sampling: varsayılan fps="2", en fazla 8 kare, width=640.
 */
export async function extractJpegFramesBase64(
  videoPath: string,
  opts: { fps?: string; maxFrames?: number; width?: number } = {}
): Promise<{ type: "input_image"; image_url: string; detail?: "low" | "high" }[]> {
  const { fps = "2", maxFrames = 8, width = 640 } = opts;

  return new Promise((resolve, reject) => {
    const args = [
      "-i", videoPath,
      "-vf", `fps=${fps},scale=${width}:-1`,
      "-vframes", String(maxFrames),
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1",
    ];

    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    let stderr = "";
    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (d) => (stderr += d.toString()));

    ffmpeg.on("error", (err) => reject(err));

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }

      const buffer = Buffer.concat(chunks);

      // JPEG ayırıcı: FF D8 FF
      const frames: Buffer[] = [];
      let start = -1;
      for (let i = 0; i < buffer.length - 2; i++) {
        if (buffer[i] === 0xff && buffer[i + 1] === 0xd8 && buffer[i + 2] === 0xff) {
          if (start !== -1) frames.push(buffer.slice(start, i));
          start = i;
        }
      }
      if (start !== -1) frames.push(buffer.slice(start));

      const base64Frames = frames.map((buf) => ({
        type: "input_image" as const,
        image_url: `data:image/jpeg;base64,${buf.toString("base64")}`,
        detail: "low" as const,
      }));

      resolve(base64Frames);
    });
  });
}
