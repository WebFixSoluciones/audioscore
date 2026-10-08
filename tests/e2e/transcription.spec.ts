import { test, expect } from "@playwright/test";
import { Midi } from "@tonejs/midi";
import { musicalAudioFixture } from "../audio-fixtures";

test("transcribe audio con el modelo real sin cuenta y exporta sus notas", async ({
  page,
}) => {
  test.setTimeout(180000);
  const fixture = musicalAudioFixture();
  await page.goto("/studio");
  await page.getByLabel("Abrir archivo de audio").setInputFiles({
    name: "acorde-real.wav",
    mimeType: "audio/wav",
    buffer: fixture.wav,
  });
  await page
    .getByRole("button", { name: "Analizar y transcribir", exact: true })
    .click();
  await expect(page.getByText(/\d+ notas detectadas\./)).toBeVisible({
    timeout: 150000,
  });
  await expect(page.locator(".score-view svg").first()).toBeVisible({
    timeout: 45000,
  });
  const channels = page.getByRole("region", {
    name: "Instrumentos detectados",
  });
  if (await page.locator(".instrument-predictions .micro-tag").count()) {
    await expect(channels).toBeVisible();
    await expect(
      channels
        .getByText("Separación pendiente · sin notas individuales")
        .first(),
    ).toBeVisible();
    await expect(channels.getByRole("button")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Piano roll", exact: true }).click();
  const labels = await page
    .locator(".midi-note")
    .evaluateAll((notes) =>
      notes.map((note) => note.getAttribute("aria-label")),
    );
  const pitches = labels.map((label) =>
    Number(label?.match(/^Nota (\d+),/)?.[1]),
  );
  for (const pitch of fixture.expectedPitches) expect(pitches).toContain(pitch);
  await expect(
    page.getByRole("heading", { name: "Instrumentos probables" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Explorar instrumentos en AudioSet" }),
  ).toHaveAttribute(
    "href",
    "https://research.google.com/audioset/ontology/musical_instrument_1.html",
  );
  const references = page.locator(".instrument-predictions a");
  for (const reference of await references.all()) {
    await expect(reference).toHaveAttribute(
      "href",
      /^https:\/\/research\.google\.com\/audioset\/ontology\/[a-z0-9_]+\.html$/,
    );
  }
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "MIDI ↓", exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const midi = new Midi(Buffer.concat(chunks));
  const exported = midi.tracks.flatMap((track) =>
    track.notes.map((note) => note.midi),
  );
  for (const pitch of fixture.expectedPitches)
    expect(exported).toContain(pitch);
  await page.getByRole("button", { name: "Partitura", exact: true }).click();
  await expect(page.locator(".score-view svg").first()).toBeVisible({
    timeout: 30000,
  });
});
