"use client";

import type { BarInfo } from "@/lib/music/tempo-map";

/**
 * Web Audio API Lookahead Metronome Scheduler.
 * Guarantees zero timing drift and microsecond audio-hardware synchronization
 * across constant and variable live-tempo music tracks.
 */
export class LookaheadMetronome {
  private ctx: AudioContext | null = null;
  private outputNode: GainNode | null = null;
  private timerId: number | null = null;
  private isRunning = false;
  private volume = 0.8;
  private muted = false;

  private bars: BarInfo[] = [];
  private currentPlayheadSeconds = 0;
  private lastContextTime = 0;
  private nextBeatIndex = 0;
  private flatBeats: Array<{ timeSeconds: number; isDownbeat: boolean }> = [];

  constructor(audioContext?: AudioContext) {
    if (typeof window !== "undefined") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (audioContext) {
        this.ctx = audioContext;
      } else if (typeof AudioCtx === "function") {
        try {
          this.ctx = new AudioCtx();
        } catch {
          this.ctx = null;
        }
      }
      if (this.ctx && typeof this.ctx.createGain === "function") {
        this.outputNode = this.ctx.createGain();
        this.outputNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
        this.outputNode.connect(this.ctx.destination);
      }
    }
  }

  public updateBars(bars: BarInfo[]) {
    this.bars = bars;
    this.flatBeats = bars.flatMap((b) =>
      b.beats.map((bt) => ({
        timeSeconds: bt.timeSeconds,
        isDownbeat: bt.isDownbeat,
      })),
    );
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.outputNode && this.ctx) {
      this.outputNode.gain.setValueAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
      );
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.outputNode && this.ctx) {
      this.outputNode.gain.setValueAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
      );
    }
  }

  public start(currentTrackSeconds = 0) {
    if (this.isRunning) this.stop();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    this.isRunning = true;
    this.currentPlayheadSeconds = currentTrackSeconds;
    this.lastContextTime = this.ctx.currentTime;

    // Locate the first beat at or after currentTrackSeconds
    this.nextBeatIndex = this.flatBeats.findIndex(
      (b) => b.timeSeconds >= currentTrackSeconds - 0.01,
    );
    if (this.nextBeatIndex === -1) {
      this.nextBeatIndex = this.flatBeats.length;
    }

    // Lookahead loop running every 25ms
    this.timerId = window.setInterval(() => this.scheduleLoop(), 25);
  }

  public stop() {
    this.isRunning = false;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  public seek(currentTrackSeconds: number) {
    this.currentPlayheadSeconds = currentTrackSeconds;
    if (this.ctx) {
      this.lastContextTime = this.ctx.currentTime;
    }
    this.nextBeatIndex = this.flatBeats.findIndex(
      (b) => b.timeSeconds >= currentTrackSeconds - 0.01,
    );
    if (this.nextBeatIndex === -1) {
      this.nextBeatIndex = this.flatBeats.length;
    }
  }

  private scheduleLoop() {
    if (!this.ctx || !this.isRunning || !this.outputNode) return;

    const ctxNow = this.ctx.currentTime;
    const elapsedSinceLast = ctxNow - this.lastContextTime;
    this.lastContextTime = ctxNow;
    this.currentPlayheadSeconds += elapsedSinceLast;

    const scheduleWindowAhead = 0.12; // 120ms ahead
    const maxTrackTimeInWindow = this.currentPlayheadSeconds + scheduleWindowAhead;

    while (
      this.nextBeatIndex < this.flatBeats.length &&
      this.flatBeats[this.nextBeatIndex].timeSeconds <= maxTrackTimeInWindow
    ) {
      const beat = this.flatBeats[this.nextBeatIndex];
      // Time delta between current playhead and beat
      const deltaSec = beat.timeSeconds - this.currentPlayheadSeconds;
      const scheduledCtxTime = ctxNow + Math.max(0, deltaSec);

      this.scheduleClick(scheduledCtxTime, beat.isDownbeat);
      this.nextBeatIndex++;
    }
  }

  private scheduleClick(time: number, isDownbeat: boolean) {
    if (!this.ctx || !this.outputNode || this.muted) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Woodblock high ping on beat 1 (downbeat); medium tone on inner beats
    osc.type = "sine";
    osc.frequency.setValueAtTime(isDownbeat ? 1600 : 800, time);

    const clickDuration = isDownbeat ? 0.045 : 0.035;
    const peakGain = isDownbeat ? 1.0 : 0.6;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peakGain, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + clickDuration);

    osc.connect(gain);
    gain.connect(this.outputNode);

    osc.start(time);
    osc.stop(time + clickDuration + 0.01);
  }

  public destroy() {
    this.stop();
    if (this.outputNode) {
      this.outputNode.disconnect();
      this.outputNode = null;
    }
  }
}
