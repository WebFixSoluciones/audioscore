"use client";

/**
 * Web Audio Lookahead Metronome with Zero Duplicate Clicks (Delivery 5).
 * - Guarantees at most ONE click per beat (`scheduledBeatKeys` set).
 * - Immediately cancels and disconnects all pending scheduled OscillatorNodes on
 *   `pause()`, `stop()`, `seek()`, or `setBars()`, eliminating duplicate/ghost clicks
 *   when transport updates.
 * - Synthesizes woodblock clicks at 1600 Hz (downbeat) and 800 Hz (sub-beats).
 */
import type { BarGridEntry, BarInfo } from "../music/tempo-map";

export interface MetronomeBeatEvent {
  barNumber: number;
  beatIndexInBar: number;
  isDownbeat: boolean;
  isPickupBar: boolean;
  songTimeSeconds: number;
}

interface ActiveScheduledNode {
  beatKey: string;
  songTimeSeconds: number;
  stop: () => void;
}

export class LookaheadMetronome {
  private audioCtx: AudioContext | null = null;
  private bars: BarGridEntry[] = [];
  private flatBeats: MetronomeBeatEvent[] = [];
  private scheduledBeatKeys = new Set<string>();
  private activeNodes: ActiveScheduledNode[] = [];
  private timerId: ReturnType<typeof setInterval> | null = null;
  private isPlaying = false;
  private anchorAudioTime = 0;
  private anchorSongSeconds = 0;
  private playbackRate = 1.0;
  private volume = 0.8;
  private muted = false;
  private outputGainNode: GainNode | null = null;
  private readonly lookaheadIntervalMs = 25;
  private readonly scheduleAheadSeconds = 0.12;

  constructor(barsOrAudioCtx?: BarGridEntry[] | BarInfo[] | AudioContext) {
    if (barsOrAudioCtx && Array.isArray(barsOrAudioCtx)) {
      this.setBars(barsOrAudioCtx as BarGridEntry[]);
    } else if (barsOrAudioCtx && typeof (barsOrAudioCtx as AudioContext).currentTime === "number") {
      this.audioCtx = barsOrAudioCtx as AudioContext;
    }
  }

  public get isRunning(): boolean {
    return this.isPlaying;
  }

  public updateBars(bars: BarGridEntry[] | BarInfo[]): void {
    this.setBars(bars as BarGridEntry[]);
  }

  public setVolume(val: number): void {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.outputGainNode && this.audioCtx) {
      this.outputGainNode.gain.setValueAtTime(this.muted ? 0 : this.volume, this.audioCtx.currentTime);
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.outputGainNode && this.audioCtx) {
      this.outputGainNode.gain.setValueAtTime(this.muted ? 0 : this.volume, this.audioCtx.currentTime);
    }
  }

  public setBars(bars: BarGridEntry[]): void {
    this.bars = bars;
    this.rebuildFlatBeats();
    this.cancelPendingNodes();
  }

  private rebuildFlatBeats(): void {
    const events: MetronomeBeatEvent[] = [];
    for (const bar of this.bars) {
      const beatTimes = bar.beatTimesSeconds || (bar.beats ? bar.beats.map((b) => b.timeSeconds) : []);
      beatTimes.forEach((t, idx) => {
        events.push({
          barNumber: bar.barNumber,
          beatIndexInBar: idx + 1,
          isDownbeat: idx === 0 && !bar.isPickupBar,
          isPickupBar: Boolean(bar.isPickupBar),
          songTimeSeconds: t,
        });
      });
    }
    this.flatBeats = events.sort((a, b) => a.songTimeSeconds - b.songTimeSeconds);
  }

  public start(currentSongSeconds: number = 0, audioCtx?: AudioContext, playbackRate: number = 1.0): void {
    if (audioCtx) {
      this.audioCtx = audioCtx;
    } else if (!this.audioCtx && typeof window !== "undefined") {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (typeof Ctx === "function") {
        try {
          this.audioCtx = new Ctx();
        } catch {
          this.audioCtx = null;
        }
      }
    }
    if (!this.audioCtx) return;

    if (!this.outputGainNode && typeof this.audioCtx.createGain === "function") {
      this.outputGainNode = this.audioCtx.createGain();
      this.outputGainNode.gain.setValueAtTime(this.muted ? 0 : this.volume, this.audioCtx.currentTime);
      this.outputGainNode.connect(this.audioCtx.destination);
    }

    this.cancelPendingNodes();
    this.playbackRate = Math.max(0.25, Math.min(2.0, playbackRate));
    this.anchorAudioTime = this.audioCtx.currentTime;
    this.anchorSongSeconds = currentSongSeconds;
    this.isPlaying = true;

    if (this.timerId !== null) {
      clearInterval(this.timerId);
    }
    this.scheduleWindow();
    this.timerId = setInterval(() => this.scheduleWindow(), this.lookaheadIntervalMs);
  }

  public seek(newSongSeconds: number): void {
    this.cancelPendingNodes();
    if (this.audioCtx && this.isPlaying) {
      this.anchorAudioTime = this.audioCtx.currentTime;
      this.anchorSongSeconds = newSongSeconds;
      this.scheduleWindow();
    } else {
      this.anchorSongSeconds = newSongSeconds;
    }
  }

  public pause(): void {
    this.isPlaying = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.cancelPendingNodes();
  }

  public stop(): void {
    this.pause();
    this.anchorSongSeconds = 0;
  }

  public destroy(): void {
    this.stop();
    if (this.outputGainNode) {
      try {
        this.outputGainNode.disconnect();
      } catch {}
      this.outputGainNode = null;
    }
  }

  public cancelPendingNodes(): void {
    for (const node of this.activeNodes) {
      try {
        node.stop();
      } catch {}
    }
    this.activeNodes = [];
    this.scheduledBeatKeys.clear();
  }

  public getCurrentSongSeconds(): number {
    if (!this.isPlaying || !this.audioCtx) {
      return this.anchorSongSeconds;
    }
    return this.anchorSongSeconds + (this.audioCtx.currentTime - this.anchorAudioTime) * this.playbackRate;
  }

  private scheduleWindow(): void {
    if (!this.isPlaying || !this.audioCtx) return;
    const nowAudio = this.audioCtx.currentTime;
    const songNow = this.getCurrentSongSeconds();
    const songHorizon = songNow + this.scheduleAheadSeconds * this.playbackRate;

    for (const beat of this.flatBeats) {
      if (beat.songTimeSeconds < songNow - 0.005) continue;
      if (beat.songTimeSeconds > songHorizon) break;

      const beatKey = `${beat.barNumber}:${beat.beatIndexInBar}:${beat.songTimeSeconds.toFixed(4)}`;
      if (this.scheduledBeatKeys.has(beatKey)) {
        continue;
      }

      const deltaSong = Math.max(0, beat.songTimeSeconds - songNow);
      const targetAudioTime = nowAudio + deltaSong / this.playbackRate;
      this.scheduledBeatKeys.add(beatKey);
      this.scheduleWoodblockClick(beatKey, beat, targetAudioTime);
    }
  }

  private scheduleWoodblockClick(beatKey: string, beat: MetronomeBeatEvent, whenAudioTime: number): void {
    if (!this.audioCtx) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(beat.isDownbeat ? 1600 : 800, whenAudioTime);

    const baseVol = this.muted ? 0 : this.volume;
    const peakGain = (beat.isDownbeat ? 0.35 : 0.20) * baseVol;

    gain.gain.setValueAtTime(0.0001, whenAudioTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain), whenAudioTime + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, whenAudioTime + 0.045);

    osc.connect(gain);
    if (this.outputGainNode) {
      gain.connect(this.outputGainNode);
    } else {
      gain.connect(this.audioCtx.destination);
    }
    osc.start(whenAudioTime);
    osc.stop(whenAudioTime + 0.05);

    const handle: ActiveScheduledNode = {
      beatKey,
      songTimeSeconds: beat.songTimeSeconds,
      stop: () => {
        try {
          osc.stop();
        } catch {}
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      },
    };
    this.activeNodes.push(handle);
  }
}
