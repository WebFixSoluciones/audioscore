import type { MusicDocument } from "@/lib/music/types";
import type { ChannelMix } from "@/lib/audio/mixer";
import type { LocalAnalysisOptions } from "./options";
export type LocalJob = {
  id: string;
  title: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  stage: string;
  createdAt: string;
  error?: string;
  ownerUid?: string;
  savedAt?: string;
  durationSeconds?: number;
  sourceCount?: number;
  analysisOptions?: LocalAnalysisOptions;
};
export type LocalResult = {
  document: MusicDocument;
  urls: Record<string, string>;
  originalUrl: string;
  peaks: number[];
  mix?: Record<string, ChannelMix>;
  analysisOptions?: LocalAnalysisOptions;
};
