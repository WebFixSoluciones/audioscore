import { describe, expect, it } from "vitest";
import {
  iatpeAnalysisResultSchema,
  channelPlanSchema,
  spectralProfileSchema,
  audioFormatInfoSchema,
} from "@/lib/audio/iatpe/types";

describe("IATPE Domain Contracts & Schemas", () => {
  it("valida la información de formato de audio nativo", () => {
    const format = {
      codec: "mp3",
      container: "mp3",
      isLossless: false,
      durationSeconds: 120.5,
      channels: 2,
      sampleRate: 44100,
      bitrateKbps: 320,
    };
    const parsed = audioFormatInfoSchema.parse(format);
    expect(parsed.codec).toBe("mp3");
    expect(parsed.isLossless).toBe(false);
  });

  it("valida el perfil espectral de micro-sonidos", () => {
    const spectral = {
      rms: 0.15,
      dynamicRangeDb: 42.5,
      spectralCentroid: 2450.8,
      subtleEventsCount: 14,
      primaryFrequencies: [440, 880, 1320],
      estimatedPitches: [69, 81, 88],
    };
    const parsed = spectralProfileSchema.parse(spectral);
    expect(parsed.primaryFrequencies).toHaveLength(3);
    expect(parsed.estimatedPitches).toEqual([69, 81, 88]);
  });

  it("valida un plan de despacho de 1 solo canal para instrumento solista", () => {
    const soloPlan = {
      mode: "solo" as const,
      isSolo: true,
      channelCount: 1,
      primaryInstrument: "piano",
      confidence: 0.94,
      channels: [
        {
          id: "solo-piano",
          label: "Piano Solo",
          instrument: "piano",
          sourceAction: "bypass_separation" as const,
          program: 0,
        },
      ],
      decisionReason: "Evidencia acústica contundente de piano solo sin percusión ni bajo",
    };
    const parsed = channelPlanSchema.parse(soloPlan);
    expect(parsed.isSolo).toBe(true);
    expect(parsed.channelCount).toBe(1);
    expect(parsed.channels[0].sourceAction).toBe("bypass_separation");
  });

  it("valida un plan de despacho multi-canal para ensamble o banda", () => {
    const ensemblePlan = {
      mode: "ensemble" as const,
      isSolo: false,
      channelCount: 3,
      primaryInstrument: "vocals",
      confidence: 0.88,
      channels: [
        {
          id: "vocals",
          label: "Voz",
          instrument: "vocals",
          sourceAction: "demucs_stem" as const,
          program: 53,
        },
        {
          id: "piano",
          label: "Piano",
          instrument: "piano",
          sourceAction: "demucs_stem" as const,
          program: 0,
        },
        {
          id: "drums",
          label: "Batería",
          instrument: "drums",
          sourceAction: "demucs_stem" as const,
          program: 0,
        },
      ],
      decisionReason: "Mezcla polifónica con componentes vocales y rítmicos simultáneos",
    };
    const parsed = channelPlanSchema.parse(ensemblePlan);
    expect(parsed.isSolo).toBe(false);
    expect(parsed.channelCount).toBe(3);
  });

  it("valida el resultado integral de IATPE", () => {
    const fullResult = {
      format: {
        codec: "flac",
        container: "flac",
        isLossless: true,
        durationSeconds: 180,
        channels: 2,
        sampleRate: 96000,
      },
      spectral: {
        rms: 0.12,
        dynamicRangeDb: 60.1,
        spectralCentroid: 1800,
        subtleEventsCount: 22,
        primaryFrequencies: [261.63, 329.63, 392.0],
        estimatedPitches: [60, 64, 67],
      },
      googleClassification: {
        topCandidate: "acoustic_guitar",
        topScore: 0.91,
        candidates: [
          { label: "Guitar", category: "acoustic_guitar", activation: 0.91, audioSetId: "/m/0342h" },
        ],
        googleGeminiReview: "Guitarra clásica solista en registro medio",
      },
      channelPlan: {
        mode: "solo" as const,
        isSolo: true,
        channelCount: 1,
        primaryInstrument: "guitar",
        confidence: 0.91,
        channels: [
          {
            id: "solo-guitar",
            label: "Guitarra Acústica",
            instrument: "guitar",
            sourceAction: "bypass_separation" as const,
            program: 24,
          },
        ],
        decisionReason: "Guitarra solista única",
      },
      timingsMs: {
        formatProbeMs: 8,
        spectralAnalysisMs: 45,
        classificationMs: 120,
        dispatchMs: 2,
        totalMs: 175,
      },
    };
    const parsed = iatpeAnalysisResultSchema.parse(fullResult);
    expect(parsed.channelPlan.isSolo).toBe(true);
    expect(parsed.timingsMs.totalMs).toBe(175);
  });
});

describe("IATPE Stream Decoder (Zero Intermediate WAV)", () => {
  it("decodifica audio en memoria a Float32 sin escribir archivos WAV intermedios", async () => {
    const { probeAudioFormat, streamAudioToFloat32 } = await import(
      "@/lib/audio/iatpe/stream-decoder"
    );
    const { createTemporaryDirectory, removeTemporaryDirectory } = await import(
      "@/lib/utils/temporary-directory"
    );
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const rate = 16000;
    const samples = rate * 2;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); // PCM
    wav.writeUInt16LE(1, 22); // mono
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) {
      wav.writeInt16LE(
        Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 10000),
        44 + i * 2,
      );
    }

    const folder = await createTemporaryDirectory("test");
    try {
      const filePath = join(folder, "test-signal.wav");
      await writeFile(filePath, wav);

      const format = await probeAudioFormat(filePath);
      expect(format.durationSeconds).toBeCloseTo(2, 1);
      expect(format.channels).toBe(1);
      expect(format.isLossless).toBe(true);

      const decoded = await streamAudioToFloat32(filePath, {
        targetSampleRate: 16000,
        channels: 1,
        maxDurationSeconds: 10,
      });

      expect(decoded.sampleRate).toBe(16000);
      expect(decoded.samples).toBeInstanceOf(Float32Array);
      expect(decoded.samples.length).toBeGreaterThan(16000 * 1.8);
      // Verify energy in the decoded Float32 samples
      let sumSq = 0;
      for (let i = 0; i < decoded.samples.length; i++) {
        sumSq += decoded.samples[i] * decoded.samples[i];
      }
      const rms = Math.sqrt(sumSq / decoded.samples.length);
      expect(rms).toBeGreaterThan(0.1);
    } finally {
      await removeTemporaryDirectory(folder);
    }
  });
});

describe("IATPE Spectral & Micro-Sound Engine", () => {
  it("extrae RMS, rango dinámico, eventos de micro-sonido y frecuencias fundamentales", async () => {
    const { analyzeSpectralProfile } = await import(
      "@/lib/audio/iatpe/spectral-engine"
    );

    const rate = 22050;
    const duration = 1.0;
    const samples = new Float32Array(rate * duration);

    // Generar señal con nota A4 (440 Hz) y armónico A5 (880 Hz)
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate;
      // Añadir un ataque a los 0.2s y otro a los 0.6s
      const env = (t > 0.2 && t < 0.4 ? 0.8 : 0) + (t > 0.6 && t < 0.9 ? 0.5 : 0.05);
      samples[i] =
        env *
        (0.7 * Math.sin(2 * Math.PI * 440 * t) +
          0.3 * Math.sin(2 * Math.PI * 880 * t));
    }

    const profile = analyzeSpectralProfile(samples, rate);
    expect(profile.rms).toBeGreaterThan(0.01);
    expect(profile.dynamicRangeDb).toBeGreaterThan(10);
    expect(profile.subtleEventsCount).toBeGreaterThanOrEqual(2);
    expect(profile.primaryFrequencies.length).toBeGreaterThan(0);
    // 440 Hz -> MIDI 69
    expect(profile.estimatedPitches).toContain(69);
  });
});

describe("IATPE Google AI Sound Classifier", () => {
  it("clasifica instrumentos a partir de predicciones de AudioSet y razonador Google AI", async () => {
    const { classifyAudioWithGoogleAI } = await import(
      "@/lib/audio/iatpe/google-classifier"
    );

    // Mock scores representing strong piano activation (index 148 in AudioSet)
    const mockScores = [
      Array.from({ length: 521 }, (_, i) => (i === 148 ? 0.85 : 0.01)),
      Array.from({ length: 521 }, (_, i) => (i === 148 ? 0.90 : 0.02)),
      Array.from({ length: 521 }, (_, i) => (i === 148 ? 0.82 : 0.01)),
    ];

    const result = await classifyAudioWithGoogleAI({
      precomputedScores: mockScores,
    });

    expect(result.topCandidate.toLowerCase()).toContain("piano");
    expect(result.topScore).toBeGreaterThan(0.7);
    expect(result.candidates.length).toBeGreaterThan(0);
  });
});

describe("IATPE Dynamic Channel Dispatcher", () => {
  it("despacha exactamente 1 canal con bypass de separación cuando se detecta un instrumento solista", async () => {
    const { dispatchChannels } = await import(
      "@/lib/audio/iatpe/channel-dispatcher"
    );

    const classification = {
      topCandidate: "Piano",
      topScore: 0.88,
      candidates: [
        { label: "Piano", category: "piano", activation: 0.88 },
        { label: "Keyboard", category: "keyboard", activation: 0.22 },
      ],
    };

    const spectral = {
      rms: 0.15,
      dynamicRangeDb: 40,
      spectralCentroid: 2200,
      subtleEventsCount: 15,
      primaryFrequencies: [440, 880],
      estimatedPitches: [69, 81],
    };

    const plan = dispatchChannels(classification, spectral);

    expect(plan.isSolo).toBe(true);
    expect(plan.mode).toBe("solo");
    expect(plan.channelCount).toBe(1);
    expect(plan.channels).toHaveLength(1);
    expect(plan.channels[0].sourceAction).toBe("bypass_separation");
    expect(plan.channels[0].instrument).toBe("piano");
    expect(plan.decisionReason).toContain("solista");
  });

  it("despacha N canales cuando se detecta un ensamble o mezcla polifónica", async () => {
    const { dispatchChannels } = await import(
      "@/lib/audio/iatpe/channel-dispatcher"
    );

    const classification = {
      topCandidate: "Singing",
      topScore: 0.85,
      candidates: [
        { label: "Singing", category: "singing", activation: 0.85 },
        { label: "Drum kit", category: "drum_kit", activation: 0.72 },
        { label: "Bass guitar", category: "bass_guitar", activation: 0.65 },
        { label: "Acoustic guitar", category: "acoustic_guitar", activation: 0.55 },
      ],
    };

    const spectral = {
      rms: 0.25,
      dynamicRangeDb: 35,
      spectralCentroid: 3100,
      subtleEventsCount: 45,
      primaryFrequencies: [110, 220, 880, 1760],
      estimatedPitches: [45, 57, 69, 81],
    };

    const plan = dispatchChannels(classification, spectral);

    expect(plan.isSolo).toBe(false);
    expect(plan.mode).toBe("ensemble");
    expect(plan.channelCount).toBeGreaterThanOrEqual(3);
    expect(plan.channels.some((c) => c.instrument === "vocals")).toBe(true);
    expect(plan.channels.some((c) => c.instrument === "drums")).toBe(true);
    expect(plan.channels.every((c) => c.sourceAction === "demucs_stem")).toBe(true);
  });

  it("despacha dinámicamente NUEVO / SILBIDO y NUEVO / TAP MESA para micro-sonidos singulares", async () => {
    const { dispatchChannels } = await import(
      "@/lib/audio/iatpe/channel-dispatcher"
    );

    // 1. Silbido solista
    const whistleClassification = {
      topCandidate: "Whistling",
      topScore: 0.92,
      candidates: [
        { label: "Silbido", category: "whistle", activation: 0.92 },
      ],
    };
    const whistlePlan = dispatchChannels(whistleClassification);
    expect(whistlePlan.isSolo).toBe(true);
    expect(whistlePlan.channels[0].label).toBe("NUEVO / SILBIDO");
    expect(whistlePlan.channels[0].sourceAction).toBe("bypass_separation");
    expect(whistlePlan.channels[0].program).toBe(78);

    // 2. Toques en mesa (tap percusivo)
    const tapClassification = {
      topCandidate: "Tap",
      topScore: 0.88,
      candidates: [
        { label: "Toques en mesa", category: "tap", activation: 0.88 },
      ],
    };
    const tapPlan = dispatchChannels(tapClassification);
    expect(tapPlan.isSolo).toBe(true);
    expect(tapPlan.channels[0].label).toBe("NUEVO / TAP MESA");
    expect(tapPlan.channels[0].sourceAction).toBe("bypass_separation");

    // 3. Chasquido de dedos
    const snapClassification = {
      topCandidate: "Finger snap",
      topScore: 0.86,
      candidates: [
        { label: "Chasquido de dedos", category: "finger_snap", activation: 0.86 },
      ],
    };
    const snapPlan = dispatchChannels(snapClassification);
    expect(snapPlan.isSolo).toBe(true);
    expect(snapPlan.channels[0].label).toBe("NUEVO / CHASQUIDO DEDOS");
    expect(snapPlan.channels[0].sourceAction).toBe("bypass_separation");

    // 4. Sonido novedoso no convencional detectado por IA (ej. copa de cristal)
    const novelClassification = {
      topCandidate: "Copa de cristal",
      topScore: 0.80,
      candidates: [
        { label: "Copa de cristal", category: "glass_cup_hit", activation: 0.80 },
      ],
    };
    const novelPlan = dispatchChannels(novelClassification);
    expect(novelPlan.isSolo).toBe(true);
    expect(novelPlan.channels[0].label).toBe("NUEVO / COPA DE CRISTAL");
    expect(novelPlan.channels[0].sourceAction).toBe("bypass_separation");
  });
});

describe("IATPE Integrated Audio Engine Orchestrator", () => {
  it("ejecuta el análisis integral sin archivos temporales y genera un resultado IATPE válido", async () => {
    const { runIatpeAnalysis } = await import("@/lib/audio/iatpe/engine");
    const { createTemporaryDirectory, removeTemporaryDirectory } = await import(
      "@/lib/utils/temporary-directory"
    );
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const rate = 16000;
    const samples = rate * 2;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); // PCM
    wav.writeUInt16LE(1, 22); // mono
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) {
      wav.writeInt16LE(
        Math.round(Math.sin((i * 2 * Math.PI * 523.25) / rate) * 12000), // C5
        44 + i * 2,
      );
    }

    const folder = await createTemporaryDirectory("test");
    try {
      const filePath = join(folder, "synth-lead.wav");
      await writeFile(filePath, wav);

      const result = await runIatpeAnalysis(filePath, { maxDurationSeconds: 5 });

      expect(result.format.durationSeconds).toBeCloseTo(2, 1);
      expect(result.spectral.rms).toBeGreaterThan(0.05);
      expect(result.channelPlan.channels.length).toBeGreaterThanOrEqual(1);
      expect(result.timingsMs.totalMs).toBeGreaterThan(0);
    } finally {
      await removeTemporaryDirectory(folder);
    }
  });
});






