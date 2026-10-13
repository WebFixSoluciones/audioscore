import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseBuffer } from "music-metadata";
import type { LocalResult } from "../../lib/audio/local/types";
test.skip(
  process.env.LOCAL_E2E !== "1" || !process.env.LOCAL_AUTH_STATE,
  "Requires npm run local, an authenticated owner state and a real audio fixture.",
);
test.use({ storageState: process.env.LOCAL_AUTH_STATE });

test("local separation, persistent stems, SVG notation, tablature and independent practice", async ({
  page,
}) => {
  test.setTimeout(1200000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const privateService = await page.request.get("http://127.0.0.1:8765/health");
  expect(privateService.status()).toBe(403);
  await page.goto("http://audioscore.localhost:3000/studio");
  await expect(page.getByText("Trabaja con tu audio.")).toBeVisible();
  const path = process.env.LOCAL_AUDIO_FIXTURE || ".tmp/faded-first-12s.wav";
  const audio = await readFile(path);
  const metadata = await parseBuffer(
    audio,
    { mimeType: "audio/wav" },
    { duration: true },
  );
  let jobId = process.env.LOCAL_REUSE_ID || "";
  if (jobId) {
    await page.goto(`http://localhost:3000/dashboard/projects/local/${jobId}`);
  } else {
    await page
      .getByLabel("Abrir archivo de audio")
      .setInputFiles({
        name: "Faded - prueba local.wav",
        mimeType: "audio/wav",
        buffer: audio,
      });
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/local/jobs") &&
        response.request().method() === "POST" &&
        response.status() === 202,
    );
    await page.getByRole("button", { name: "Separar y transcribir" }).click();
    jobId = (await (await created).json()).job.id;
  }
  await expect(page.locator(".score-view svg").first()).toBeVisible({
    timeout: 900000,
  });
  const result = (await (
    await page.request.get(
      `http://localhost:3000/api/local/jobs/${jobId}/result`,
    )
  ).json()) as LocalResult;
  expect(result.document.events.length).toBeGreaterThan(0);
  expect(Object.keys(result.urls).length).toBeGreaterThan(0);
  expect(result.document.analysis?.musicalMetadata?.method).toContain(
    "librosa",
  );
  for (const url of Object.values(result.urls)) {
    const response = await page.request.get(`http://localhost:3000${url}`);
    expect(response.ok()).toBe(true);
    const stem = await parseBuffer(
      await response.body(),
      { mimeType: "audio/wav" },
      { duration: true },
    );
    expect(
      Math.abs(stem.format.duration! - metadata.format.duration!),
    ).toBeLessThan(0.05);
    const range = await page.request.get(`http://localhost:3000${url}`, {
      headers: { range: "bytes=0-43" },
    });
    expect(range.status()).toBe(206);
    expect((await range.body()).length).toBe(44);
  }
  await expect(page.locator(".score-view svg").first()).toBeVisible({
    timeout: 60000,
  });
  if (!process.env.LOCAL_REUSE_ID) {
    await page
      .getByRole("button", { name: "Guardar como proyecto", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Guardar cambios", exact: true }),
    ).toBeVisible();
  }
  await page.goto("http://localhost:3000/dashboard/projects");
  await page.locator(`a[href="/dashboard/projects/local/${jobId}"]`).click();
  await expect(page.locator(".score-view svg").first()).toBeVisible({
    timeout: 60000,
  });
  const guitar = result.document.sources.find(
    (s) =>
      s.program === 24 &&
      result.document.events.some((e) => e.sourceId === s.id),
  );
  if (guitar) {
    await page
      .locator(".track-title")
      .filter({ hasText: guitar.nameEs })
      .click();
    await page.getByRole("button", { name: "Tablatura", exact: true }).click();
    await expect(page.locator(".tablature-view svg")).toBeVisible({
      timeout: 45000,
    });
  }
  await page.getByLabel("Velocidad de práctica").selectOption("0.75");
  await page.getByLabel("Semitonos de práctica").selectOption("2");
  await page.getByRole("button", { name: "Preparar escucha" }).click();
  await expect(page.getByLabel("Audio de práctica")).toBeVisible({
    timeout: 60000,
  });
  const practiceUrl = await page
    .getByLabel("Audio de práctica")
    .getAttribute("src");
  const practice = await page.request.get(
    `http://localhost:3000${practiceUrl}`,
  );
  expect(practice.ok()).toBe(true);
  const changed = await parseBuffer(
    await practice.body(),
    { mimeType: "audio/wav" },
    { duration: true },
  );
  expect(
    Math.abs(changed.format.duration! - metadata.format.duration! / 0.75),
  ).toBeLessThan(0.15);
  await page.getByRole("button", { name: "Partitura", exact: true }).click();
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF ↓", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  expect(errors).toEqual([]);
});
