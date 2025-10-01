import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export async function extractJpegFramesBase64(
  inputPath: string,
  opts: { fps?: string; maxFrames?: number; width?: number } = {}
): Promise<{ type: "input_image"; image_base64: string }[]> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-vf", `fps=${opts.fps || "1/2"},scale=${opts.width || 768}:-1`,
      "-vframes", String(opts.maxFrames || 8),
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1"
    ];

    const ffmpeg = spawn(ffmpegPath!, args);
    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.on("close", () => {
      const buf = Buffer.concat(chunks);
      // burada frame’leri split edip base64’e dönüştür
      // (basit hali: tek jpeg için)
      const base64 = buf.toString("base64");
      resolve([{ type: "input_image", image_base64: base64 }]);
    });
    ffmpeg.on("error", reject);
  });
}
