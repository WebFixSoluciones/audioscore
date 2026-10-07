import { describe, expect, it } from "vitest";
import catalog from "../lib/audio/transcription/audioset-catalog.json";
import classes from "../public/models/yamnet/classes.json";
import { instrumentPredictions } from "../lib/audio/transcription/instruments";
import { isPianoRecording } from "../lib/audio/transcription/refinement";

const frame = (entries: Record<number, number>) => {
  const scores = Array<number>(521).fill(0);
  for (const [index, score] of Object.entries(entries))
    scores[Number(index)] = score;
  return scores;
};
describe("AudioSet instrument catalog", () => {
  it("uses official model IDs and references for every supported musical category", () => {
    expect(catalog.length).toBe(87);
    expect(new Set(catalog.map((entry) => entry.audiosetId)).size).toBe(
      catalog.length,
    );
    for (const entry of catalog) {
      expect(classes[entry.index].mid).toBe(entry.audiosetId);
      expect(classes[entry.index].label).toBe(entry.label);
      expect(entry.referenceUrl).toMatch(
        /^https:\/\/research\.google\.com\/audioset\/ontology\/[a-z0-9_]+\.html$/,
      );
    }
    expect(catalog.find((entry) => entry.index === 206)?.labelEs).toBe(
      "Didgeridoo",
    );
    expect(catalog.find((entry) => entry.index === 24)?.kind).toBe("voice");
  });
  it("prefers specific instruments to ancestors and preserves distinct instruments", () => {
    const scores = frame({ 133: 0.9, 147: 0.8, 148: 0.7, 206: 0.55 });
    const result = instrumentPredictions([scores, scores, scores]);
    expect(result.map((entry) => entry.label)).toEqual(["Piano", "Didgeridoo"]);
    expect(result[0].audiosetId).toBe("/m/05r5c");
    expect(result[0].referenceUrl).toContain("piano_1.html");
  });
  it("keeps family uncertainty and separates techniques from instrument identities", () => {
    const scores = frame({ 147: 0.8, 141: 0.65 });
    const result = instrumentPredictions([scores, scores]);
    expect(
      result.find((entry) => entry.label === "Keyboard (musical)")?.kind,
    ).toBe("family");
    expect(result.find((entry) => entry.label === "Strum")?.kind).toBe(
      "technique",
    );
    expect(
      isPianoRecording([
        { label: "Piano", labelEs: "Piano", score: 0.7 },
        ...result,
      ]),
    ).toBe(true);
  });
  it("does not label unsupported, weak or invalid evidence as an instrument", () => {
    expect(instrumentPredictions([])).toEqual([]);
    expect(
      instrumentPredictions([
        frame({ 0: 0.9, 148: 0.09 }),
        frame({ 0: 0.9, 148: 0.01 }),
      ]),
    ).toEqual([]);
    expect(
      instrumentPredictions([
        frame({ 148: Number.NaN }),
        frame({ 148: Number.NaN }),
      ]),
    ).toEqual([]);
    expect(
      instrumentPredictions([
        frame({ 148: 0.8 }),
        frame({ 148: 0 }),
        frame({ 148: 0 }),
      ]),
    ).toEqual([]);
  });
});
