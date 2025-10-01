// lib/frames.ts
import { spawn } from "child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const ffmpegPath = ffmpegInstaller.path;

export async function extractJpegFramesBase64(
  videoPath: string,
  opts: { fps?: string; maxFrames?: number; width?: number } = {}
): Promise<{ type: "input_image"; image_url: string }[]> {
  const { fps = "1", maxFrames = 8, width = 640 } = opts;

  return new Promise((resolve, reject) => {
    const args = [
      "-i", videoPath,
      "-vf", `fps=${fps},scale=${width}:-1`,
      "-vframes", maxFrames.toString(),
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1"
    ];

    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "inherit"] });

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));

    ffmpeg.on("error", (err) => reject(err));

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}`));
      }

      const buffer = Buffer.concat(chunks);

      // Kareleri ayır (JPEG magic number: ff d8 ff)
      const frames: Buffer[] = [];
      let start = -1;
      for (let i = 0; i < buffer.length - 2; i++) {
        if (buffer[i] === 0xff && buffer[i + 1] === 0xd8 && buffer[i + 2] === 0xff) {
          if (start !== -1) {
            frames.push(buffer.slice(start, i));
          }
          start = i;
        }
      }
      if (start !== -1) {
        frames.push(buffer.slice(start));
      }

      const base64Frames = frames.map((buf) => ({
        type: "input_image" as const,
        image_url: `data:image/jpeg;base64,${buf.toString("base64")}`
      }));

      resolve(base64Frames);
    });
  });
}
