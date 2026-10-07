import { expect, it } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { probeAudio, audioPeaks, transcodeAudio } from "@/lib/audio/ffmpeg";
import {
  removeTemporaryDirectory,
  createTemporaryDirectory,
} from "@/lib/utils/temporary-directory";
it("FFmpeg decodifica un WAV real, genera peaks y recorta sin simular metadatos", async () => {
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
      Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 7000),
      44 + i * 2,
    );
  const folder = await createTemporaryDirectory("test");
  try {
    const path = join(folder, "fixture.wav"),
      result = join(folder, "region.wav");
    await writeFile(path, wav);
    expect((await probeAudio(path)).durationSeconds).toBeCloseTo(2);
    const peaks = await audioPeaks(path);
    expect(peaks.rms).toBeGreaterThan(0.1);
    expect(peaks.peaks.length).toBeGreaterThan(100);
    await transcodeAudio(path, result, "wav", [0.5, 1.5]);
    expect((await probeAudio(result)).durationSeconds).toBeCloseTo(1);
    expect((await readFile(result)).subarray(0, 4).toString()).toBe("RIFF");
    const silent = Buffer.from(wav);
    silent.fill(0, 44);
    await writeFile(path, silent);
    await expect(audioPeaks(path)).rejects.toThrow("silencio");
  } finally {
    await removeTemporaryDirectory(folder);
  }
}, 120000);
