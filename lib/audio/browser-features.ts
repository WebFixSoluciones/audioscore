"use client";
import Meyda from "meyda";
export type AcousticFeatures = {
  rms: number;
  spectralCentroidHz: number;
  clippingPercent: number;
  sampleRate: number;
  duration: number;
};
export async function acousticFeatures(file: File): Promise<AcousticFeatures> {
  if (file.size > 50 * 1024 * 1024)
    throw new Error("El análisis local admite archivos de hasta 50 MB.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 900)
      throw new Error("El análisis local admite hasta 15 minutos de audio.");
    const samples = decoded.getChannelData(0);
    const size = 2048;
    Meyda.bufferSize = size;
    Meyda.sampleRate = decoded.sampleRate;
    let rms = 0,
      centroid = 0,
      clipped = 0,
      seen = 0,
      count = 0;
    const stride = Math.max(
      size,
      Math.floor(samples.length / (50 * size)) * size,
    );
    for (let at = 0; at + size <= samples.length; at += stride) {
      const window = samples.slice(at, at + size);
      const features = Meyda.extract(["rms", "spectralCentroid"], window) as {
        rms: number;
        spectralCentroid: number;
      } | null;
      if (!features) continue;
      rms += features.rms;
      centroid += (features.spectralCentroid * decoded.sampleRate) / size;
      count++;
      window.forEach((x) => {
        seen++;
        if (Math.abs(x) >= 0.999) clipped++;
      });
    }
    if (!count)
      throw new Error("El audio es demasiado corto para el análisis acústico.");
    return {
      rms: rms / count,
      spectralCentroidHz: centroid / count,
      clippingPercent: (clipped / Math.max(seen, 1)) * 100,
      sampleRate: decoded.sampleRate,
      duration: decoded.duration,
    };
  } finally {
    await context.close();
  }
}
