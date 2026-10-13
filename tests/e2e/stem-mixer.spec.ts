import { test, expect } from "@playwright/test";
test.skip(
  process.env.LOCAL_E2E !== "1" ||
    !process.env.LOCAL_AUTH_STATE ||
    !process.env.LOCAL_TEST_PROJECT_ID,
  "Requires npm run local, authenticated owner state and a saved piano/guitar example.",
);
test.use({ storageState: process.env.LOCAL_AUTH_STATE });
function pcm(bytes: Buffer) {
  for (let pos = 12; pos + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(pos + 4);
    if (bytes.toString("ascii", pos, pos + 4) === "data")
      return bytes.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  throw new Error("Missing WAV audio data");
}
test("real stems, shared transport, solo/mute and WAV mix preserve the user's controls", async ({
  page,
}) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const audios: HTMLMediaElement[] = [];
    Object.assign(window, { stemTestAudio: audios });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!audios.includes(this)) audios.push(this);
      return play
        .call(this)
        .then(() => new Promise<void>((resolve) => setTimeout(resolve, 120)));
    };
  });
  await page.goto("http://localhost:3000/studio");
  const job = { id: process.env.LOCAL_TEST_PROJECT_ID! };
  const result = await (
    await page.request.get(
      `http://localhost:3000/api/local/jobs/${job.id}/result`,
    )
  ).json();
  await page.goto(`http://localhost:3000/dashboard/projects/local/${job.id}`);
  const mixer = page.getByRole("region", {
    name: "Mezclador de pistas separadas",
  });
  await expect(mixer).toBeVisible();
  await expect(mixer.locator(".separated-track")).toHaveCount(
    Object.keys(result.urls).length,
  );
  await expect(mixer.locator(".track-wave svg")).toHaveCount(
    Object.keys(result.urls).length,
    { timeout: 90000 },
  );
  const waveforms = await (
    await page.request.get(`/api/local/jobs/${job.id}/waveforms`)
  ).json();
  expect(Object.keys(waveforms.peaks)).toHaveLength(
    Object.keys(result.urls).length,
  );
  expect(waveforms.peaks["demucs-piano"]).not.toEqual(
    waveforms.peaks["demucs-guitar"],
  );
  await mixer
    .getByRole("button", { name: "Solo de pista Piano", exact: true })
    .click();
  await expect(page.getByLabel("Modo de reproducción")).toHaveValue("stems");
  await expect(
    mixer.getByRole("button", { name: "Solo de pista Piano", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const volume = mixer.getByLabel("Volumen de pista Piano", { exact: true });
  await volume.focus();
  await volume.press("Home");
  for (let i = 0; i < 50; i++) await volume.press("ArrowRight");
  await expect(volume).toHaveValue("0.5");
  await mixer
    .getByRole("button", { name: "Escuchar mezcla", exact: true })
    .click();
  const snapshot = () =>
    page.evaluate(() => {
      const audios = (
        window as typeof window & { stemTestAudio: HTMLMediaElement[] }
      ).stemTestAudio.filter(
        (a) => a.src.includes("/files/") && !a.src.includes("original.wav"),
      );
      return {
        count: audios.length,
        playing: audios.every((a) => !a.paused),
        drift: audios.length
          ? Math.max(...audios.map((a) => a.currentTime)) -
            Math.min(...audios.map((a) => a.currentTime))
          : 99,
        time: audios[0]?.currentTime,
      };
    });
  await expect
    .poll(async () => (await snapshot()).count)
    .toBe(Object.keys(result.urls).length);
  await expect.poll(async () => (await snapshot()).playing).toBe(true);
  await expect.poll(async () => (await snapshot()).time).toBeGreaterThan(0.2);
  expect((await snapshot()).drift).toBeLessThan(0.15);
  await mixer
    .getByRole("button", { name: "Pausar mezcla", exact: true })
    .click();
  await mixer
    .getByRole("button", { name: "Escuchar mezcla", exact: true })
    .click();
  await mixer
    .getByRole("button", { name: "Pausar mezcla", exact: true })
    .click();
  await mixer
    .getByRole("button", { name: "Escuchar mezcla", exact: true })
    .click();
  await expect.poll(async () => (await snapshot()).playing).toBe(true);
  await expect.poll(async () => (await snapshot()).time).toBeGreaterThan(0.6);
  await mixer
    .getByRole("button", { name: "Pausar mezcla", exact: true })
    .click();
  const seek = mixer.getByLabel("Posición en Piano", { exact: true });
  await seek.press("End");
  await seek.press("ArrowLeft");
  await expect.poll(async () => (await snapshot()).time).toBeGreaterThan(11);
  const downloadReady = page.waitForEvent("download");
  await mixer
    .getByRole("button", { name: "Descargar mezcla", exact: true })
    .click();
  const download = await downloadReady;
  const path = await download.path();
  expect(path).toBeTruthy();
  const { readFile } = await import("node:fs/promises");
  const mixed = pcm(await readFile(path!));
  const original = pcm(
    await (await page.request.get(result.urls["demucs-piano"])).body(),
  );
  expect(mixed.length).toBe(original.length);
  let error = 0;
  for (let i = 0; i < mixed.length; i += 2)
    error = Math.max(
      error,
      Math.abs(mixed.readInt16LE(i) - original.readInt16LE(i) * 0.5),
    );
  expect(error).toBeLessThanOrEqual(1);
  const rightMix = await page.request.post(`/api/local/jobs/${job.id}/mix`, {
    data: {
      channels: Object.fromEntries(
        Object.keys(result.urls).map((id) => [
          id,
          {
            volume: 0.5,
            pan: id === "demucs-piano" ? 1 : 0,
            muted: false,
            solo: id === "demucs-piano",
          },
        ]),
      ),
    },
  });
  expect(rightMix.ok()).toBe(true);
  const rightUrl = (await rightMix.json()).url;
  const rightPcm = pcm(await (await page.request.get(rightUrl)).body());
  let leftLeak = 0;
  for (let i = 0; i < rightPcm.length; i += 4) {
    leftLeak = Math.max(leftLeak, Math.abs(rightPcm.readInt16LE(i)));
    const expected =
      (original.readInt16LE(i) + original.readInt16LE(i + 2)) * 0.5;
    if (Math.abs(rightPcm.readInt16LE(i + 2) - expected) > 1)
      throw new Error("Exported balance does not match listening");
  }
  expect(leftLeak).toBeLessThanOrEqual(1);
  await mixer
    .getByRole("button", { name: "Silenciar pista Piano", exact: true })
    .click();
  const muted = await page.request.post(`/api/local/jobs/${job.id}/mix`, {
    data: {
      channels: Object.fromEntries(
        Object.keys(result.urls).map((id) => [
          id,
          {
            volume: 0.5,
            pan: 0,
            muted: id === "demucs-piano",
            solo: id === "demucs-piano",
          },
        ]),
      ),
    },
  });
  expect(muted.status()).toBe(400);
  expect((await muted.json()).error).toContain("silenciada");
  await mixer
    .getByRole("button", { name: "Restablecer mezcla", exact: true })
    .click();
  await expect(volume).toHaveValue("0.75");
  await expect(
    mixer.getByRole("button", { name: "Solo de pista Piano", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    mixer.getByRole("button", { name: "Silenciar pista Piano", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  const downloadStem = await page.request.get(result.urls["demucs-piano"]);
  expect(downloadStem.ok()).toBe(true);
  const individualDownload = page.waitForEvent("download");
  await mixer
    .getByRole("link", { name: "Descargar pista Piano", exact: true })
    .click();
  expect((await individualDownload).suggestedFilename()).toBe("Piano.wav");
  await mixer.screenshot({ path: ".tmp/stem-mixer-desktop.png" });
  await page.setViewportSize({ width: 526, height: 900 });
  await expect(
    mixer.getByLabel("Volumen de pista Piano", { exact: true }),
  ).toBeVisible();
  const waveBox = await mixer.locator(".track-wave").first().boundingBox();
  expect(waveBox!.x + waveBox!.width).toBeLessThanOrEqual(526);
  await mixer.screenshot({ path: ".tmp/stem-mixer-mobile.png" });
  expect(errors).toEqual([]);
});
