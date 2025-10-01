// lib/openai.ts
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  // Build/deploy’da bariz kaysın diye erken fail
  throw new Error("OPENAI_API_KEY missing. Set it in .env.local and on Vercel.");
}

export const openai = new OpenAI({ apiKey });

// Vision için varsayılan model (demo için ucuz ve yeterli)
export const DEFAULT_VISION_MODEL = "gpt-4o-mini";

// İleride raporu tipleyebilmek için (kullanmak zorunda değilsin)
export type VbReport = {
  strengths: string[];
  issues: string[];
  drills: string[];
};
