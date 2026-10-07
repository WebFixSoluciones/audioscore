import { it, expect } from "vitest";
import { renderNotation } from "@/lib/music/score-converter";
import { writeMusicXML } from "@/lib/music/musicxml";
import { fixture } from "./fixtures";
it("Verovio genera SVG, MEI y un PDF real desde el mismo MusicXML", async () => {
  const xml = writeMusicXML(fixture());
  expect((await renderNotation(xml, "svg")).toString()).toContain("<svg");
  expect((await renderNotation(xml, "mei")).toString()).toContain("<mei");
  const pdf = await renderNotation(xml, "pdf");
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.length).toBeGreaterThan(1000);
});
