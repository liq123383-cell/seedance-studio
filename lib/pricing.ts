import type { AspectRatio, Resolution } from "./types";

const DIMENSIONS: Record<Resolution, Record<string, [number, number]>> = {
  "480p": {
    "16:9": [854, 480],
    "4:3": [752, 560],
    "1:1": [640, 640],
    "3:4": [560, 752],
    "9:16": [480, 854],
    "21:9": [992, 432]
  },
  "720p": {
    "16:9": [1280, 720],
    "4:3": [1112, 834],
    "1:1": [960, 960],
    "3:4": [834, 1112],
    "9:16": [720, 1280],
    "21:9": [1470, 630]
  },
  "1080p": {
    "16:9": [1920, 1080],
    "4:3": [1664, 1248],
    "1:1": [1440, 1440],
    "3:4": [1248, 1664],
    "9:16": [1080, 1920],
    "21:9": [2206, 946]
  }
};

// Seedance 2.5 official list price for requests without an input video.
const PRICE_PER_MILLION_TOKENS: Record<Resolution, number> = {
  "480p": 70,
  "720p": 70,
  "1080p": 77
};

export function estimateSeedanceTokens(
  resolution: Resolution,
  ratio: AspectRatio | "adaptive",
  duration: number,
  fps = 24
) {
  const safeRatio = ratio === "adaptive" ? "16:9" : ratio;
  const [width, height] = DIMENSIONS[resolution][safeRatio] ?? DIMENSIONS[resolution]["16:9"];
  return (duration * width * height * fps) / 1024;
}

export function estimateSeedanceCost(
  resolution: Resolution,
  ratio: AspectRatio | "adaptive",
  duration: number
) {
  const tokens = estimateSeedanceTokens(resolution, ratio, duration);
  return (tokens * PRICE_PER_MILLION_TOKENS[resolution]) / 1_000_000;
}

export function formatCny(value: number) {
  return `¥${value.toFixed(2)}`;
}
