import { test, expect } from "@playwright/test";
import { writeMidi } from "../../lib/music/midi-writer";
import { fixture } from "../fixtures";
test("edición manual, historial, partitura y exportación real", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Crear pista" }).click();
  await page.locator(".note-grid").dblclick({ position: { x: 120, y: 98 } });
  await expect(page.getByLabel("Pitch MIDI")).toBeVisible();
  const originalPitch = await page.getByLabel("Pitch MIDI").inputValue();
  await page.getByLabel("Pitch MIDI").fill("64");
  await expect(page.getByLabel("Pitch MIDI")).toHaveValue("64");
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(page.getByLabel("Pitch MIDI")).toHaveValue(originalPitch);
  await page.getByRole("button", { name: "Rehacer", exact: true }).click();
  await expect(page.getByLabel("Pitch MIDI")).toHaveValue("64");
  await page.getByRole("button", { name: "Partitura", exact: true }).click();
  await expect(page.locator(".score-view svg").first()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "MIDI ↓", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.mid$/);
});
test("importa eventos del MIDI y deja la procedencia de hardware desconocida", async ({
  page,
}) => {
  await page.goto("/studio");
  await page.getByLabel("Importar archivo MIDI").setInputFiles({
    name: "fixture.mid",
    mimeType: "audio/midi",
    buffer: Buffer.from(writeMidi(fixture())),
  });
  await expect(page.getByText("2 eventos musicales")).toBeVisible();
  await expect(page.locator(".midi-note")).toHaveCount(2);
  await page.getByRole("button", { name: "Partitura", exact: true }).click();
  await expect(page.getByLabel("Pentagramas de la pista")).toHaveValue("piano");
  expect(
    await page
      .locator(".notation-toolbar")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 2),
  ).toBe(true);
  await expect(page.locator(".score-view svg").first()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "MUSICXML ↓", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain("<staves>2</staves>");
  await page.getByLabel("Pentagramas de la pista").selectOption("single");
  await expect(page.getByLabel("Pentagramas de la pista")).toHaveValue(
    "single",
  );
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(page.getByLabel("Pentagramas de la pista")).toHaveValue("piano");
});
test("abre un WAV real y crea waveform sin inventar notas", async ({
  page,
}) => {
  const rate = 22050,
    samples = rate * 2,
    wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 5000),
      44 + i * 2,
    );
  await page.goto("/studio");
  await page
    .getByLabel("Abrir archivo de audio")
    .setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: wav });
  await expect(page.getByText("tone.wav", { exact: true })).toBeVisible();
  await expect(page.getByText("Centroide espectral")).toBeVisible();
  await expect(page.locator(".midi-note")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reproducir", exact: true }),
  ).toBeEnabled();
});
