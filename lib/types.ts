export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
export type Resolution = "480p" | "720p" | "1080p";
export type VideoStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type GenerationRequest = {
  prompt: string;
  ratio: AspectRatio;
  duration: number;
  resolution: Resolution;
  generateAudio: boolean;
  firstFrameUrl?: string;
};

export type VideoJob = {
  id: string;
  provider_task_id: string;
  prompt: string;
  status: VideoStatus;
  ratio: string;
  duration: number;
  resolution: string;
  provider_video_url: string | null;
  stored_video_url: string | null;
  error_message: string | null;
  created_at: string;
};

export type StreamStatus = {
  id: string;
  status: VideoStatus;
  videoUrl: string | null;
  storedVideoUrl: string | null;
  error: string | null;
  createdAt: string | null;
};
