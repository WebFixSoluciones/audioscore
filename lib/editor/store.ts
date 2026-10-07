"use client";
import { create } from "zustand";
import {
  emptyDocument,
  type MusicDocument,
  type MusicalEvent,
} from "@/lib/music/types";
import { ticksToSeconds } from "@/lib/music/tempo-map";
import { quantizeEvents } from "@/lib/music/quantization";
type EditorStore = {
  document: MusicDocument;
  past: MusicDocument[];
  future: MusicDocument[];
  selectedId?: string;
  sourceId?: string;
  currentTime: number;
  playing: boolean;
  mode: "audio" | "midi" | "compare" | "stems";
  region?: [number, number];
  loop: boolean;
  load: (doc: MusicDocument) => void;
  edit: (update: (doc: MusicDocument) => MusicDocument) => void;
  select: (id?: string) => void;
  selectSource: (id?: string) => void;
  seek: (time: number) => void;
  setPlaying: (v: boolean) => void;
  setMode: (mode: EditorStore["mode"]) => void;
  setRegion: (region?: [number, number]) => void;
  setLoop: (v: boolean) => void;
  updateNote: (id: string, patch: Partial<MusicalEvent>) => void;
  deleteNote: (id: string) => void;
  undo: () => void;
  redo: () => void;
  quantize: () => void;
};
export function reconcileTiming(doc: MusicDocument): MusicDocument {
  const events = doc.events.map((e) => {
    const startSeconds = ticksToSeconds(e.startTick, doc.tempoMap);
    return {
      ...e,
      startSeconds,
      durationSeconds:
        ticksToSeconds(e.startTick + e.durationTicks, doc.tempoMap) -
        startSeconds,
    };
  });
  return {
    ...doc,
    events,
    durationSeconds: Math.max(
      doc.durationSeconds,
      ...events.map((e) => e.startSeconds + e.durationSeconds),
      0,
    ),
  };
}
export const useEditor = create<EditorStore>((set, get) => ({
  document: emptyDocument(),
  past: [],
  future: [],
  currentTime: 0,
  playing: false,
  mode: "audio",
  loop: false,
  load: (doc) =>
    set({
      document: doc,
      past: [],
      future: [],
      selectedId: undefined,
      sourceId: doc.sources[0]?.id,
      currentTime: 0,
      playing: false,
    }),
  edit: (update) =>
    set((s) => ({
      document: {
        ...reconcileTiming(update(structuredClone(s.document))),
        revision: s.document.revision + 1,
      },
      past: [...s.past.slice(-49), s.document],
      future: [],
    })),
  select: (selectedId) => set({ selectedId }),
  selectSource: (sourceId) => set({ sourceId }),
  seek: (currentTime) => set({ currentTime }),
  setPlaying: (playing) => set({ playing }),
  setMode: (mode) => set({ mode, playing: false }),
  setRegion: (region) => set({ region }),
  setLoop: (loop) => set({ loop }),
  updateNote: (id, patch) =>
    get().edit((doc) => ({
      ...doc,
      events: doc.events.map((e) =>
        e.id === id
          ? { ...e, ...patch, isHumanReviewed: true, confidence: 1 }
          : e,
      ),
    })),
  deleteNote: (id) => {
    get().edit((doc) => ({
      ...doc,
      events: doc.events.filter((e) => e.id !== id),
    }));
    set({ selectedId: undefined });
  },
  undo: () =>
    set((s) =>
      s.past.length
        ? {
            document: s.past[s.past.length - 1],
            past: s.past.slice(0, -1),
            future: [s.document, ...s.future],
          }
        : {},
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? {
            document: s.future[0],
            past: [...s.past, s.document],
            future: s.future.slice(1),
          }
        : {},
    ),
  quantize: () =>
    get().edit((doc) => ({
      ...doc,
      events: quantizeEvents(doc.events, doc, 4, get().region),
    })),
}));
