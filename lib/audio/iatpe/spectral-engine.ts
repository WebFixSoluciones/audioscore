import type { SpectralProfile } from "./types";

/**
 * Radix-2 in-place Cooley-Tukey FFT for power-of-two size arrays.
 */
function fftRadix2(re: Float64Array, im: Float64Array) {
  const n = re.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempRe = re[i];
      re[i] = re[j];
      re[j] = tempRe;
      const tempIm = im[i];
      im[i] = im[j];
      im[j] = tempIm;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computations
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * wRe - im[i + k + half] * wIm;
        const vIm = re[i + k + half] * wIm + im[i + k + half] * wRe;

        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;

        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }
}

export function frequencyToMidiPitch(freq: number): number {
  if (freq <= 0 || !Number.isFinite(freq)) return 0;
  const pitch = Math.round(69 + 12 * Math.log2(freq / 440));
  return Math.max(0, Math.min(127, pitch));
}

export function analyzeSpectralProfile(
  samples: Float32Array,
  sampleRate: number,
): SpectralProfile {
  if (samples.length === 0) {
    return {
      rms: 0,
      dynamicRangeDb: 0,
      spectralCentroid: 0,
      subtleEventsCount: 0,
      primaryFrequencies: [],
      estimatedPitches: [],
    };
  }

  // 1. RMS y Rango Dinámico
  let sumSq = 0;
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const absVal = Math.abs(samples[i]);
    if (absVal > maxAbs) maxAbs = absVal;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  const floorVal = Math.max(0.00001, rms * 0.001);
  const dynamicRangeDb = Math.max(
    0,
    Math.min(120, 20 * Math.log10(Math.max(floorVal, maxAbs) / floorVal)),
  );

  // 2. Detección de Eventos de Micro-Sonido (Onsets sutiles)
  const hopSize = Math.max(64, Math.floor(sampleRate / 100)); // 10ms hops
  const windowSize = hopSize * 2;
  const numFrames = Math.floor((samples.length - windowSize) / hopSize);
  const frameEnergies = new Float32Array(Math.max(1, numFrames));

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    let frameSum = 0;
    for (let i = 0; i < windowSize; i++) {
      const s = samples[start + i];
      frameSum += s * s;
    }
    frameEnergies[f] = Math.sqrt(frameSum / windowSize);
  }

  let subtleEventsCount = 0;
  let lastEventFrame = -100;
  const energyThreshold = Math.max(0.0005, rms * 0.15);

  for (let f = 1; f < numFrames; f++) {
    const energyDelta = frameEnergies[f] - frameEnergies[f - 1];
    if (
      energyDelta > energyThreshold &&
      f - lastEventFrame >= 5 &&
      frameEnergies[f] > energyThreshold
    ) {
      subtleEventsCount++;
      lastEventFrame = f;
    }
  }

  // 3. Análisis Espectral (FFT y Centroide)
  const fftSize = 2048;
  const halfFft = fftSize / 2;
  const accumulatedMagnitudes = new Float64Array(halfFft);
  let analyzedWindows = 0;

  // Analizar ventanas de energía representativas
  const stride = Math.max(1, Math.floor(samples.length / (fftSize * 8)));
  for (
    let start = 0;
    start <= samples.length - fftSize;
    start += fftSize * stride
  ) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);

    // Ventana Hann
    for (let i = 0; i < fftSize; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
      re[i] = samples[start + i] * w;
    }

    fftRadix2(re, im);

    for (let k = 0; k < halfFft; k++) {
      accumulatedMagnitudes[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    analyzedWindows++;
    if (analyzedWindows >= 16) break;
  }

  // Centroide espectral
  let numCentroid = 0;
  let denCentroid = 0;
  for (let k = 1; k < halfFft; k++) {
    const freq = (k * sampleRate) / fftSize;
    const mag = accumulatedMagnitudes[k];
    numCentroid += freq * mag;
    denCentroid += mag;
  }
  const spectralCentroid = denCentroid > 1e-6 ? numCentroid / denCentroid : 0;

  // Encontrar picos de frecuencia dominante
  const peaks: { freq: number; mag: number }[] = [];
  const minBin = Math.max(1, Math.floor((40 * fftSize) / sampleRate)); // >= 40 Hz
  const maxBin = Math.min(halfFft - 2, Math.floor((4500 * fftSize) / sampleRate)); // <= 4500 Hz

  for (let k = minBin; k <= maxBin; k++) {
    const current = accumulatedMagnitudes[k];
    if (
      current > accumulatedMagnitudes[k - 1] &&
      current > accumulatedMagnitudes[k + 1] &&
      current > denCentroid * 0.005
    ) {
      const freq = (k * sampleRate) / fftSize;
      peaks.push({ freq, mag: current });
    }
  }

  peaks.sort((a, b) => b.mag - a.mag);
  const primaryFrequencies = peaks
    .slice(0, 10)
    .map((p) => Math.round(p.freq * 10) / 10);

  const pitchesSet = new Set<number>();
  for (const f of primaryFrequencies) {
    const p = frequencyToMidiPitch(f);
    if (p >= 21 && p <= 108) {
      pitchesSet.add(p);
    }
  }
  const estimatedPitches = Array.from(pitchesSet).slice(0, 10);

  return {
    rms: Math.round(rms * 10000) / 10000,
    dynamicRangeDb: Math.round(dynamicRangeDb * 10) / 10,
    spectralCentroid: Math.round(spectralCentroid * 10) / 10,
    subtleEventsCount,
    primaryFrequencies,
    estimatedPitches,
  };
}
