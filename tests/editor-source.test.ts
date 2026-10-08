import { expect, it } from "vitest";
import { useEditor } from "@/lib/editor/store";
import { fixture } from "./fixtures";
it("opens the part with notes when the first separated channel is empty", () => {
  const doc = fixture();
  doc.sources.unshift({
    ...doc.sources[0],
    id: "drums",
    name: "Drums",
    nameEs: "Batería",
    category: "percussive",
    channel: 10,
  });
  useEditor.getState().load(doc);
  expect(useEditor.getState().sourceId).toBe("piano");
});
