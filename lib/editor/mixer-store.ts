"use client";
import { create } from "zustand";
import { defaultMix, type ChannelMix } from "@/lib/audio/mixer";
import { useEditor } from "./store";
export const useMixer = create<{
  channels: Record<string, ChannelMix>;
  configure: (ids: string[], mix?: Record<string, ChannelMix>) => void;
  update: (id: string, patch: Partial<ChannelMix>) => void;
  reset: () => void;
}>((set) => ({
  channels: {},
  configure: (ids, mix) =>
    set({
      channels: Object.fromEntries(
        ids.map((id) => [id, { ...defaultMix, ...mix?.[id] }]),
      ),
    }),
  update: (id, patch) =>
    set((s) => ({
      channels: {
        ...s.channels,
        [id]: { ...(s.channels[id] ?? defaultMix), ...patch },
      },
    })),
  reset: () =>
    set((s) => ({
      channels: Object.fromEntries(
        Object.keys(s.channels).map((id) => [id, { ...defaultMix }]),
      ),
    })),
}));
export function activateStemMode() {
  const editor = useEditor.getState();
  if (editor.mode !== "stems") {
    const playing = editor.playing;
    editor.setMode("stems");
    editor.setPlaying(playing);
  }
}

import type { ActivityRegion, AudioAssetMetadata, MidiPort } from "../audio/iatpe/types";
import type { InstrumentTransposition } from "../music/musicxml";
import type { TrackedVoiceNote } from "../audio/transcription/stems";

export interface ScorePartEntity {
  id: string;
  name: string;
  family: "woodwinds" | "brass" | "strings" | "percussion" | "choir";
  globalChannelIndex: number; // 1..64
  midiPort: MidiPort; // A, B, C, D
  midiChannel: number; // 1..16
  transposition?: InstrumentTransposition;
  voiceIndex: number;
  sharedAudioAssetId: string;
  isolatedAudioAssetId?: string;
  gain: number; // 0.0 .. 1.5
  pan: number; // -1.0 .. +1.0
  muted: boolean;
  soloed: boolean;
  confidence: number;
  needsHumanReview: boolean;
  events: TrackedVoiceNote[];
}

export interface PlaybackRoute {
  partId: string;
  partName: string;
  activeMode: "shared_trunk" | "isolated_stem" | "synth_solo" | "muted";
  isSynthesizedPlayback: boolean;
  playbackBadgeLabel: string;
  targetAudioAssetId: string | null;
  effectiveGain: number;
}

export interface PooledAudioAssetExecution {
  assetId: string;
  file: string;
  activeInstancesCount: 1; // Strictly 1 instance in Web Audio to prevent trunk sum duplication
  pooledGain: number;
  pooledPan: number;
  contributingPartIds: string[];
}

export interface VirtualConsoleRoutingResult {
  partRoutes: PlaybackRoute[];
  activeTrunkAssets: PooledAudioAssetExecution[];
  synthesizedSoloPartIds: string[];
}

export function resolveVirtualConsoleRouting(
  assets: AudioAssetMetadata[],
  parts: ScorePartEntity[],
  activityRegions: ActivityRegion[] = []
): VirtualConsoleRoutingResult {
  const anySoloed = parts.some((p) => p.soloed);
  const partRoutes: PlaybackRoute[] = [];
  const trunkContributors = new Map<string, ScorePartEntity[]>();
  const synthesizedSoloPartIds: string[] = [];

// Count how many parts share each trunk asset
  const partsPerAsset = new Map<string, number>();
  for (const p of parts) {
    partsPerAsset.set(p.sharedAudioAssetId, (partsPerAsset.get(p.sharedAudioAssetId) ?? 0) + 1);
  }

for (const part of parts) {
    const isAudible = anySoloed ? part.soloed : !part.muted;
    if (!isAudible || part.gain <= 0) {
      partRoutes.push({
        partId: part.id,
        partName: part.name,
        activeMode: "muted",
        isSynthesizedPlayback: false,
        playbackBadgeLabel: "Silenciado",
        targetAudioAssetId: null,
        effectiveGain: 0,
      });
      continue;
    }

const sharesTrunkWithOthers = (partsPerAsset.get(part.sharedAudioAssetId) ?? 1) > 1;
    // Check if ALL sibling parts sharing the same trunk are also soloed
    const siblings = parts.filter((s) => s.sharedAudioAssetId === part.sharedAudioAssetId);
    const allSiblingsSoloed = siblings.every((s) => s.soloed);

// If user solos an individual part (e.g., Trumpet 1) that shares a trunk (`brass.wav`)
    // and has no dedicated isolated acoustic recording, route to synthesized MIDI/SoundFont solo!
    if (anySoloed && part.soloed && sharesTrunkWithOthers && !allSiblingsSoloed && !part.isolatedAudioAssetId) {
      synthesizedSoloPartIds.push(part.id);
      partRoutes.push({
        partId: part.id,
        partName: part.name,
        activeMode: "synth_solo",
        isSynthesizedPlayback: true,
        playbackBadgeLabel: "Solo Sintetizado (Atril Aislado)",
        targetAudioAssetId: null,
        effectiveGain: part.gain,
      });
      continue;
    }

if (part.isolatedAudioAssetId) {
      partRoutes.push({
        partId: part.id,
        partName: part.name,
        activeMode: "isolated_stem",
        isSynthesizedPlayback: false,
        playbackBadgeLabel: "Audio Aislado Real",
        targetAudioAssetId: part.isolatedAudioAssetId,
        effectiveGain: part.gain,
      });
      const list = trunkContributors.get(part.isolatedAudioAssetId) ?? [];
      list.push(part);
      trunkContributors.set(part.isolatedAudioAssetId, list);
    } else {
      partRoutes.push({
        partId: part.id,
        partName: part.name,
        activeMode: "shared_trunk",
        isSynthesizedPlayback: false,
        playbackBadgeLabel: "Stem Troncal Compartido (Pooled)",
        targetAudioAssetId: part.sharedAudioAssetId,
        effectiveGain: part.gain,
      });
      const list = trunkContributors.get(part.sharedAudioAssetId) ?? [];
      list.push(part);
      trunkContributors.set(part.sharedAudioAssetId, list);
    }
  }

// Build deduplicated PooledAudioAssetExecution: each AudioAsset is played AT MOST ONCE,
  // with its gain computed as the mean of its active contributing virtual desks (never sum!)
  const activeTrunkAssets: PooledAudioAssetExecution[] = [];
  for (const asset of assets) {
    const contributors = trunkContributors.get(asset.id);
    if (!contributors || contributors.length === 0) continue;

const meanGain =
      contributors.reduce((acc, p) => acc + p.gain, 0) / contributors.length;
    const meanPan =
      contributors.reduce((acc, p) => acc + p.pan, 0) / contributors.length;

activeTrunkAssets.push({
      assetId: asset.id,
      file: asset.file,
      activeInstancesCount: 1,
      pooledGain: Number(meanGain.toFixed(4)),
      pooledPan: Number(meanPan.toFixed(4)),
      contributingPartIds: contributors.map((c) => c.id),
    });
  }

return {
    partRoutes,
    activeTrunkAssets,
    synthesizedSoloPartIds,
  };
}
