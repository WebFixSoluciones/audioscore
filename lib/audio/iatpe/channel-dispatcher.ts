import type { ChannelPlan, ChannelItem, GoogleClassificationResult, SpectralProfile } from "./types";

interface InstrumentMapping {
  canonical: string;
  label: string;
  program: number;
}

const INSTRUMENT_MAP: Record<string, InstrumentMapping> = {
  piano: { canonical: "piano", label: "Piano", program: 0 },
  electric_piano: { canonical: "piano", label: "Piano Eléctrico", program: 4 },
  keyboard: { canonical: "piano", label: "Teclado", program: 0 },
  acoustic_guitar: { canonical: "guitar", label: "Guitarra Acústica", program: 24 },
  guitar: { canonical: "guitar", label: "Guitarra", program: 24 },
  electric_guitar: { canonical: "guitar", label: "Guitarra Eléctrica", program: 27 },
  bass: { canonical: "bass", label: "Bajo", program: 32 },
  bass_guitar: { canonical: "bass", label: "Bajo Eléctrico", program: 33 },
  double_bass: { canonical: "bass", label: "Contrabajo", program: 43 },
  singing: { canonical: "vocals", label: "Voz", program: 53 },
  choir: { canonical: "vocals", label: "Coro", program: 52 },
  vocal: { canonical: "vocals", label: "Voz", program: 53 },
  drum_kit: { canonical: "drums", label: "Batería", program: 0 },
  drums: { canonical: "drums", label: "Batería", program: 0 },
  percussion: { canonical: "drums", label: "Percusión", program: 0 },
  violin: { canonical: "other", label: "Violín", program: 40 },
  strings: { canonical: "other", label: "Cuerdas", program: 48 },
  synthesizer: { canonical: "other", label: "Sintetizador", program: 80 },
  sax: { canonical: "other", label: "Saxofón", program: 65 },
  flute: { canonical: "other", label: "Flauta", program: 73 },
  // Micro-sonidos y sonidos acústicos singulares (Google AI AudioSet / Gemini)
  whistle: { canonical: "whistle", label: "NUEVO / SILBIDO", program: 78 },
  whistling: { canonical: "whistle", label: "NUEVO / SILBIDO", program: 78 },
  silbido: { canonical: "whistle", label: "NUEVO / SILBIDO", program: 78 },
  finger_snap: { canonical: "snap", label: "NUEVO / CHASQUIDO DEDOS", program: 115 },
  snapping: { canonical: "snap", label: "NUEVO / CHASQUIDO DEDOS", program: 115 },
  chasquido: { canonical: "snap", label: "NUEVO / CHASQUIDO DEDOS", program: 115 },
  tap: { canonical: "tap", label: "NUEVO / TAP MESA", program: 115 },
  tapping: { canonical: "tap", label: "NUEVO / TAP MESA", program: 115 },
  knock: { canonical: "tap", label: "NUEVO / GOLPE MADERA", program: 115 },
  toque: { canonical: "tap", label: "NUEVO / TAP MESA", program: 115 },
  clap: { canonical: "clapping", label: "NUEVO / APLAUSOS", program: 126 },
  clapping: { canonical: "clapping", label: "NUEVO / APLAUSOS", program: 126 },
  aplauso: { canonical: "clapping", label: "NUEVO / APLAUSOS", program: 126 },
  beatbox: { canonical: "beatbox", label: "NUEVO / BEATBOX", program: 118 },
};

function resolveCanonical(category: string, label: string): InstrumentMapping {
  const normCategory = category.toLowerCase().replace(/[\s-]+/g, "_");
  const normLabel = label.toLowerCase().replace(/[\s-]+/g, "_");

  for (const [key, mapping] of Object.entries(INSTRUMENT_MAP)) {
    if (normCategory.includes(key) || normLabel.includes(key)) {
      return mapping;
    }
  }

  // Si es un sonido novedoso detectado por IA que no existe en el catálogo convencional:
  const cleanLabel = label.trim();
  const dynamicLabel = cleanLabel.toUpperCase().startsWith("NUEVO /")
    ? cleanLabel
    : `NUEVO / ${cleanLabel.toUpperCase() || "SONIDO SINGULAR"}`;

  return { canonical: normCategory || "other", label: dynamicLabel, program: 0 };
}

const SOLO_MICROSOUND_KEYS = new Set([
  "whistle",
  "whistling",
  "silbido",
  "finger_snap",
  "snapping",
  "chasquido",
  "tap",
  "tapping",
  "knock",
  "toque",
  "clap",
  "clapping",
  "aplauso",
  "beatbox",
]);

const STANDARD_ENSEMBLE_STEMS: Array<{
  id: string;
  label: string;
  instrument: string;
  program: number;
}> = [
  { id: "vocals", label: "Voz Líder", instrument: "vocals", program: 53 },
  { id: "drums", label: "Batería / Percusión", instrument: "drums", program: 0 },
  { id: "bass", label: "Bajo", instrument: "bass", program: 32 },
  { id: "other", label: "Otros Instrumentos", instrument: "other", program: 0 },
];

export function dispatchChannels(
  classification: GoogleClassificationResult,
  spectral?: SpectralProfile,
): ChannelPlan {
  const candidates = classification.candidates || [];

  // Agrupar candidatos por familia canónica
  const familyScores = new Map<string, { mapping: InstrumentMapping; maxScore: number }>();

  for (const candidate of candidates) {
    const mapping = resolveCanonical(candidate.category, candidate.label);
    const existing = familyScores.get(mapping.canonical);
    if (!existing || candidate.activation > existing.maxScore) {
      familyScores.set(mapping.canonical, { mapping, maxScore: candidate.activation });
    }
  }

  const sortedFamilies = Array.from(familyScores.values()).sort(
    (a, b) => b.maxScore - a.maxScore,
  );

  const top = sortedFamilies[0];

  // Caso 1: Detección explícita de Micro-Sonido singular (Chasquido, Silbido, Tap en mesa, etc.)
  const isMicroSoundCandidate =
    top &&
    (SOLO_MICROSOUND_KEYS.has(top.mapping.canonical) ||
      top.mapping.label.startsWith("NUEVO /"));

  const hasRhythmSection =
    familyScores.has("drums") || familyScores.has("bass");

  if (isMicroSoundCandidate && !hasRhythmSection && top.maxScore >= 0.35) {
    const channel: ChannelItem = {
      id: `solo-${top.mapping.canonical}`,
      label: top.mapping.label,
      instrument: top.mapping.canonical,
      sourceAction: "bypass_separation",
      program: top.mapping.program,
    };

    return {
      mode: "solo",
      isSolo: true,
      channelCount: 1,
      primaryInstrument: top.mapping.canonical,
      confidence: top.maxScore,
      channels: [channel],
      decisionReason: `Sonido singular acústico o micro-sonido identificado (${top.mapping.label}). Asignado a 1 canal directo sin separación.`,
      recommendedEngine: "bs_roformer",
    };
  }

  // Caso 2: Instrumento solista monofónico/aislado REAL (sin batería, sin bajo, sin voz de fondo)
  // Requiere alta confianza (>= 0.82) y ausencia de acompañamiento rítmico/armónico
  const isIsolatedSoloInstrument =
    top &&
    sortedFamilies.length === 1 &&
    top.maxScore >= 0.82 &&
    !hasRhythmSection &&
    top.mapping.canonical !== "other" &&
    (!spectral || spectral.primaryFrequencies.length <= 6);

  if (isIsolatedSoloInstrument) {
    const channel: ChannelItem = {
      id: `solo-${top.mapping.canonical}`,
      label: `${top.mapping.label} Solo`,
      instrument: top.mapping.canonical,
      sourceAction: "bypass_separation",
      program: top.mapping.program,
    };

    return {
      mode: "solo",
      isSolo: true,
      channelCount: 1,
      primaryInstrument: top.mapping.canonical,
      confidence: top.maxScore,
      channels: [channel],
      decisionReason: `Instrumento solista aislado confirmado (${top.mapping.label}). Se crea canal único sin separación al no haber acompañamiento de fondo.`,
      recommendedEngine: "bs_roformer",
    };
  }

  // Caso 3: Ensamble / Mezcla Polifónica / Pista Musical Completa (Bomba, Cumbia, Salsa, Folk, Rock, etc.)
  // Cualquier pista musical con percusión, bajo, múltiples instrumentos o sin candidatos individuales
  // DEBE pasar obligatoriamente por la separación de pistas (BS-RoFormer / Demucs).

  // Determinar motor recomendado de forma autónoma por IATPE:
  let recommendedEngine: "bs_roformer" | "demucs" | "ensemble" = "bs_roformer";
  if (familyScores.has("guitar") && familyScores.has("piano")) {
    recommendedEngine = "demucs"; // Demucs 6-stems especializado en aislar guitarra y piano
  } else if (sortedFamilies.length >= 4) {
    recommendedEngine = "ensemble"; // Ensamble quirúrgico multi-fuente
  } else {
    recommendedEngine = "bs_roformer"; // SOTA Band-Split RoFormer por defecto
  }

  // Construir canales de stems para el ensamble
  // Partimos de los 4 stems esenciales (Voz, Batería/Percusión, Bajo, Otros)
  const channels: ChannelItem[] = STANDARD_ENSEMBLE_STEMS.map((s) => ({
    id: s.id,
    label: s.label,
    instrument: s.instrument,
    sourceAction: "demucs_stem",
    program: s.program,
  }));

  // Si se detectó guitarra o piano con relevancia, agregarlos a la estructura de canales
  if (familyScores.has("guitar") && !channels.some((c) => c.instrument === "guitar")) {
    channels.push({
      id: "guitar",
      label: "Guitarra",
      instrument: "guitar",
      sourceAction: "demucs_stem",
      program: 24,
    });
  }
  if (familyScores.has("piano") && !channels.some((c) => c.instrument === "piano")) {
    channels.push({
      id: "piano",
      label: "Piano",
      instrument: "piano",
      sourceAction: "demucs_stem",
      program: 0,
    });
  }

  // Si se identificaron micro-sonidos dentro de la mezcla (ej. un silbido o un chasquido dentro de la canción):
  for (const f of sortedFamilies) {
    if (
      SOLO_MICROSOUND_KEYS.has(f.mapping.canonical) ||
      f.mapping.label.startsWith("NUEVO /")
    ) {
      if (!channels.some((c) => c.instrument === f.mapping.canonical)) {
        channels.push({
          id: f.mapping.canonical,
          label: f.mapping.label,
          instrument: f.mapping.canonical,
          sourceAction: "demucs_stem",
          program: f.mapping.program,
        });
      }
    }
  }

  const primaryInstrument = top ? top.mapping.canonical : "other";
  const confidence = top ? top.maxScore : 0.75;
  const detectedLabels = sortedFamilies.map((f) => f.mapping.label).join(", ");

  const decisionReason =
    candidates.length === 0
      ? "Mezcla polifónica multi-instrumental detectada (textura musical densa). Despachando separación de pistas completa con motor neuronal."
      : `Mezcla polifónica con fuentes identificadas (${detectedLabels || "Múltiples instrumentos"}). Despachando separación de pistas completa con ${recommendedEngine.toUpperCase()}.`;

  return {
    mode: "ensemble",
    isSolo: false,
    channelCount: channels.length,
    primaryInstrument,
    confidence,
    channels,
    decisionReason,
    recommendedEngine,
  };
}
