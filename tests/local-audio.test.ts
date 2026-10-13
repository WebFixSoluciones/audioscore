import { describe, expect, it } from "vitest";
import { localAccessAllowed } from "@/lib/audio/local/access";
import { assignFrets, tablatureAttacks } from "@/lib/music/tablature";
import { fixture } from "./fixtures";
describe("private local engine access", () => {
  it("admits loopback with matching origin only when explicitly enabled", () => {
    const url = "http://audioscore.localhost:3000/api/local/jobs";
    expect(
      localAccessAllowed(
        new Request(url, {
          headers: { origin: "http://audioscore.localhost:3000" },
        }),
        true,
      ),
    ).toBe(true);
    expect(
      localAccessAllowed(
        new Request("http://127.0.0.1:3000/api/local/jobs", {
          headers: {
            host: "audioscore.localhost:3000",
            origin: "http://audioscore.localhost:3000",
          },
        }),
        true,
      ),
    ).toBe(true);
    expect(localAccessAllowed(new Request(url), false)).toBe(false);
    expect(
      localAccessAllowed(
        new Request("https://audioscore.vercel.app/api/local/jobs"),
        true,
      ),
    ).toBe(false);
    expect(
      localAccessAllowed(
        new Request(url, { headers: { origin: "https://evil.example" } }),
        true,
      ),
    ).toBe(false);
    expect(
      localAccessAllowed(
        new Request(url, { headers: { "sec-fetch-site": "cross-site" } }),
        true,
      ),
    ).toBe(false);
  });
});
describe("standard tuning guitar and bass tablature", () => {
  it("places simultaneous pitches on different strings and conserves their pitch", () => {
    const pitches = [64, 67, 72];
    const positions = assignFrets(pitches)!;
    expect(positions).toHaveLength(3);
    expect(new Set(positions.map((p) => p.str)).size).toBe(3);
    const tuning = [64, 59, 55, 50, 45, 40];
    expect(
      positions.map((p) => tuning[p.str - 1] + p.fret).sort((a, b) => a - b),
    ).toEqual(pitches);
  });
  it("rejects out-of-range notes and impossible chords rather than inventing frets", () => {
    expect(assignFrets([21])).toBeUndefined();
    expect(assignFrets([40, 41, 42, 43, 44, 45, 46])).toBeUndefined();
    expect(assignFrets([28], true)).toEqual([{ str: 4, fret: 0 }]);
  });
  it("groups chord attacks without changing the audio/MIDI document", () => {
    const doc = fixture();
    doc.sources[0].program = 24;
    doc.events.push({ ...doc.events[0], id: "chord", midiNote: 64 });
    const before = structuredClone(doc);
    const groups = tablatureAttacks(doc, doc.sources[0]);
    expect(groups[0].positions).toHaveLength(2);
    expect(doc).toEqual(before);
  });
});
