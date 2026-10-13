import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { writeMXL } from "@/lib/music/mxl";
import { writeMusicXML } from "@/lib/music/musicxml";
import { localAnalysisOptionsSchema } from "@/lib/audio/local/options";
import { tempoMapFromBeats } from "@/lib/music/beat-tempo";
import { withTempoMap, ticksToSeconds } from "@/lib/music/tempo-map";
import { fixture } from "./fixtures";

describe("notation export and measured tempo", () => {
  it("exports a standard archive with MIME first and uncompressed, retaining the selected part", () => {
    const doc = fixture();
    const before = structuredClone(doc);
    const bytes = writeMXL(doc, doc.sources[0].id);
    const entries = unzipSync(bytes);
    expect(Object.keys(entries)[0]).toBe("mimetype");
    expect(
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
        8,
        true,
      ),
    ).toBe(0);
    expect(strFromU8(entries.mimetype)).toBe(
      "application/vnd.recordare.musicxml",
    );
    expect(strFromU8(entries["META-INF/container.xml"])).toContain(
      'full-path="score.musicxml"',
    );
    expect(strFromU8(entries["score.musicxml"])).toBe(
      writeMusicXML(doc, doc.sources[0].id),
    );
    expect(doc).toEqual(before);
  });
  it("retains a steady grid for weak beats and stable frame jitter", () => {
    const beats = Array.from(
      { length: 33 },
      (_, i) => i * 0.5 + (i % 2) * 0.01,
    );
    expect(tempoMapFromBeats(beats, 120, 0.8)).toHaveLength(1);
    expect(tempoMapFromBeats(beats, 120, 0.1)).toHaveLength(1);
    expect(tempoMapFromBeats([1, 0, 2], 120, 0.8)).toHaveLength(1);
  });
  it("follows a slowdown while preserving performed note times", () => {
    const beats = Array.from({ length: 25 }, (_, i) =>
      i <= 8 ? i * 0.5 : 4 + ((i - 8) * 2) / 3,
    );
    const map = tempoMapFromBeats(beats, 110, 0.8);
    expect(map.map((s) => s.bpm)).toEqual([120, 90, 90]);
    const doc = fixture();
    const result = withTempoMap(doc, map);
    expect(result.events[0].startSeconds).toBe(doc.events[0].startSeconds);
    expect(
      Math.abs(
        ticksToSeconds(result.events[0].startTick, map) -
          doc.events[0].startSeconds,
      ),
    ).toBeLessThan(0.01);
    const xml = writeMusicXML({ ...result, durationSeconds: 20 });
    expect(xml).toContain('tempo="90"');
  });
  it("accepts only bounded choices and never accepts a model path or command from the browser", () => {
    expect(localAnalysisOptionsSchema.parse({})).toEqual({
      quality: "balanced",
      reduceNoise: false,
      tempo: "steady",
      detectBars: true,
    });
    expect(
      localAnalysisOptionsSchema.safeParse({ quality: "ultra" }).success,
    ).toBe(false);
    expect(localAnalysisOptionsSchema.safeParse({ command: "x" }).success).toBe(
      false,
    );
  });
});
