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
