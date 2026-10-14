import type { ChannelPlan, ChannelItem, GoogleClassificationResult, SpectralProfile } from "./types";

interface InstrumentMapping {
  canonical: string;
  label: string;
  program: number;
  family: string;
  parentTrunk: "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";
}

const INSTRUMENT_MAP: Record<string, InstrumentMapping> = {
  // Teclados y Armonía
  piano: { canonical: "piano", label: "Piano", program: 0, family: "piano", parentTrunk: "piano" },
  electric_piano: { canonical: "piano", label: "Piano Eléctrico", program: 4, family: "piano", parentTrunk: "piano" },
  organ: { canonical: "organ", label: "Órgano", program: 16, family: "harmony", parentTrunk: "piano" },
  keyboard: { canonical: "piano", label: "Teclado", program: 0, family: "piano", parentTrunk: "piano" },
  accordion: { canonical: "accordion", label: "Acordeón", program: 21, family: "harmony", parentTrunk: "other" },
  acordeon: { canonical: "accordion", label: "Acordeón", program: 21, family: "harmony", parentTrunk: "other" },
  synthesizer: { canonical: "synthesizer", label: "Sintetizador", program: 80, family: "harmony", parentTrunk: "other" },

  // Guitarras
  acoustic_guitar: { canonical: "guitar", label: "Guitarra Acústica", program: 24, family: "guitar", parentTrunk: "guitar" },
  guitar: { canonical: "guitar", label: "Guitarra", program: 24, family: "guitar", parentTrunk: "guitar" },
  electric_guitar: { canonical: "guitar", label: "Guitarra Eléctrica", program: 27, family: "guitar", parentTrunk: "guitar" },
  slide_guitar: { canonical: "guitar", label: "Guitarra Slide", program: 30, family: "guitar", parentTrunk: "guitar" },
  cuatro: { canonical: "guitar", label: "Cuatro / Ukelele", program: 24, family: "guitar", parentTrunk: "guitar" },

  // Bajos
  bass_guitar: { canonical: "bass", label: "Bajo Eléctrico", program: 33, family: "bass", parentTrunk: "bass" },
  double_bass: { canonical: "bass", label: "Contrabajo", program: 43, family: "bass", parentTrunk: "bass" },
  bass: { canonical: "bass", label: "Bajo", program: 32, family: "bass", parentTrunk: "bass" },

  // Voces
  singing: { canonical: "vocals", label: "Voz", program: 53, family: "vocals", parentTrunk: "vocals" },
  choir: { canonical: "vocals", label: "Coro", program: 52, family: "vocals", parentTrunk: "vocals" },
  vocal: { canonical: "vocals", label: "Voz", program: 53, family: "vocals", parentTrunk: "vocals" },

  // Batería Base
  drum_kit: { canonical: "drums", label: "Batería", program: 0, family: "drums", parentTrunk: "drums" },
  drums: { canonical: "drums", label: "Batería", program: 0, family: "drums", parentTrunk: "drums" },
  percussion: { canonical: "drums", label: "Percusión", program: 0, family: "drums", parentTrunk: "drums" },

  // Percusión Latina y Orquestal
  timbales: { canonical: "timbales", label: "Timbales", program: 119, family: "percussion", parentTrunk: "drums" },
  timbal: { canonical: "timbales", label: "Timbales", program: 119, family: "percussion", parentTrunk: "drums" },
  conga: { canonical: "conga", label: "Congas / Tumbadoras", program: 116, family: "percussion", parentTrunk: "drums" },
  tumbadora: { canonical: "conga", label: "Congas / Tumbadoras", program: 116, family: "percussion", parentTrunk: "drums" },
  bongo: { canonical: "bongo", label: "Bongó", program: 115, family: "percussion", parentTrunk: "drums" },
  cowbell: { canonical: "cowbell", label: "Campana / Cencerro", program: 115, family: "percussion", parentTrunk: "drums" },
  campana: { canonical: "cowbell", label: "Campana / Cencerro", program: 115, family: "percussion", parentTrunk: "drums" },
  cymbals: { canonical: "cymbals", label: "Platillos", program: 119, family: "percussion", parentTrunk: "drums" },
  cymbal: { canonical: "cymbals", label: "Platillos", program: 119, family: "percussion", parentTrunk: "drums" },
  tambourine: { canonical: "tambourine", label: "Pandereta / Güiro", program: 115, family: "percussion", parentTrunk: "drums" },
  guiro: { canonical: "tambourine", label: "Güiro / Maracas", program: 115, family: "percussion", parentTrunk: "drums" },
  maracas: { canonical: "tambourine", label: "Güiro / Maracas", program: 115, family: "percussion", parentTrunk: "drums" },
  shaker: { canonical: "tambourine", label: "Shaker / Güiro", program: 115, family: "percussion", parentTrunk: "drums" },
  marimba: { canonical: "marimba", label: "Marimba / Xilófono", program: 12, family: "percussion", parentTrunk: "other" },
  xylophone: { canonical: "marimba", label: "Marimba / Xilófono", program: 13, family: "percussion", parentTrunk: "other" },

  // Metales (Brass)
  trumpet: { canonical: "trumpet", label: "Trompeta", program: 56, family: "brass", parentTrunk: "other" },
  trombone: { canonical: "trombone", label: "Trombón", program: 57, family: "brass", parentTrunk: "other" },
  saxophone: { canonical: "saxophone", label: "Saxofón", program: 65, family: "brass", parentTrunk: "other" },
  sax: { canonical: "saxophone", label: "Saxofón", program: 65, family: "brass", parentTrunk: "other" },
  brass: { canonical: "brass", label: "Metales", program: 61, family: "brass", parentTrunk: "other" },
  french_horn: { canonical: "french_horn", label: "Corno Francés", program: 60, family: "brass", parentTrunk: "other" },
  tuba: { canonical: "tuba", label: "Tuba", program: 58, family: "brass", parentTrunk: "other" },

  // Maderas (Woodwinds)
  flute: { canonical: "flute", label: "Flauta", program: 73, family: "woodwinds", parentTrunk: "other" },
  clarinet: { canonical: "clarinet", label: "Clarinete", program: 71, family: "woodwinds", parentTrunk: "other" },
  oboe: { canonical: "oboe", label: "Oboe", program: 68, family: "woodwinds", parentTrunk: "other" },
  bassoon: { canonical: "bassoon", label: "Fagot", program: 70, family: "woodwinds", parentTrunk: "other" },

  // Cuerdas (Strings)
  violin: { canonical: "violin", label: "Violín", program: 40, family: "strings", parentTrunk: "other" },
  viola: { canonical: "viola", label: "Viola", program: 41, family: "strings", parentTrunk: "other" },
  cello: { canonical: "cello", label: "Violonchelo", program: 42, family: "strings", parentTrunk: "other" },
  strings: { canonical: "strings", label: "Cuerdas", program: 48, family: "strings", parentTrunk: "other" },
  harp: { canonical: "harp", label: "Arpa", program: 46, family: "strings", parentTrunk: "other" },

  // Micro-sonidos y sonidos acústicos singulares (Google AI AudioSet / Gemini)
  whistle: { canonical: "whistle", label: "NUEVO / SILBIDO", program: 78, family: "microsound", parentTrunk: "other" },
  whistling: { canonical: "whistle", label: "NUEVO / SILBIDO", program: 78, family: "microsound", parentTrunk: "other" },
  silbido: { canonical: "whistle", label: "NUEVO / SILBIDO", program: 78, family: "microsound", parentTrunk: "other" },
  finger_snap: { canonical: "snap", label: "NUEVO / CHASQUIDO DEDOS", program: 115, family: "microsound", parentTrunk: "other" },
  snapping: { canonical: "snap", label: "NUEVO / CHASQUIDO DEDOS", program: 115, family: "microsound", parentTrunk: "other" },
  chasquido: { canonical: "snap", label: "NUEVO / CHASQUIDO DEDOS", program: 115, family: "microsound", parentTrunk: "other" },
  tap: { canonical: "tap", label: "NUEVO / TAP MESA", program: 115, family: "microsound", parentTrunk: "other" },
  tapping: { canonical: "tap", label: "NUEVO / TAP MESA", program: 115, family: "microsound", parentTrunk: "other" },
  knock: { canonical: "tap", label: "NUEVO / GOLPE MADERA", program: 115, family: "microsound", parentTrunk: "other" },
  toque: { canonical: "tap", label: "NUEVO / TAP MESA", program: 115, family: "microsound", parentTrunk: "other" },
  clap: { canonical: "clapping", label: "NUEVO / APLAUSOS", program: 126, family: "microsound", parentTrunk: "other" },
  clapping: { canonical: "clapping", label: "NUEVO / APLAUSOS", program: 126, family: "microsound", parentTrunk: "other" },
  aplauso: { canonical: "clapping", label: "NUEVO / APLAUSOS", program: 126, family: "microsound", parentTrunk: "other" },
  beatbox: { canonical: "beatbox", label: "NUEVO / BEATBOX", program: 118, family: "microsound", parentTrunk: "drums" },
};

// Pre-ordenar por longitud descendente para que términos específicos como 'bass_guitar' o 'electric_piano'
// se evalúen SIEMPRE antes que términos genéricos como 'guitar' o 'piano' (F09)
const SORTED_INSTRUMENT_ENTRIES = Object.entries(INSTRUMENT_MAP).sort(
  ([a], [b]) => b.length - a.length,
);

function resolveCanonical(category: string, label: string): InstrumentMapping {
  const normCategory = category.toLowerCase().replace(/[\s-]+/g, "_");
  const normLabel = label.toLowerCase().replace(/[\s-]+/g, "_");

  for (const [key, mapping] of SORTED_INSTRUMENT_ENTRIES) {
    if (normCategory.includes(key) || normLabel.includes(key)) {
      return mapping;
    }
  }

  // Si es un sonido novedoso detectado por IA que no existe en el catálogo convencional:
  const cleanLabel = label.trim();
  const dynamicLabel = cleanLabel.toUpperCase().startsWith("NUEVO /")
    ? cleanLabel
    : `NUEVO / ${cleanLabel.toUpperCase() || "SONIDO SINGULAR"}`;

  return {
    canonical: normCategory || "other",
    label: dynamicLabel,
    program: 0,
    family: "other",
    parentTrunk: "other",
  };
}

const SOLO_MICROSOUND_KEYS = new Set([
  "snap",
  "finger_snap",
  "snapping",
  "chasquido",
  "whistle",
  "whistling",
  "silbido",
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

  // Verificar si hay algún acompañamiento armónico, melódico o rítmico relevante (F05)
  const hasAccompaniment = sortedFamilies.some(
    (f) =>
      f.mapping.canonical !== top?.mapping.canonical &&
      f.maxScore >= 0.25,
  );

  const hasRhythmSection =
    (familyScores.has("drums") && top?.mapping.canonical !== "drums") ||
    (familyScores.has("bass") && top?.mapping.canonical !== "bass");

  // Caso 1: Detección explícita de Micro-Sonido singular aislado (Chasquido, Silbido, Tap en mesa, etc.)
  // IMPORTANTE (F05): NO omitir separación si hay otros instrumentos presentes (guitarra, piano, voz, etc.)
  const isMicroSoundCandidate =
    top &&
    (SOLO_MICROSOUND_KEYS.has(top.mapping.canonical) ||
      (sortedFamilies.length === 1 && top.mapping.label.startsWith("NUEVO /")));

  if (isMicroSoundCandidate && !hasAccompaniment && !hasRhythmSection && top.maxScore >= 0.40) {
    const channel: ChannelItem = {
      id: `solo-${top.mapping.canonical}`,
      label: top.mapping.label,
      instrument: top.mapping.canonical,
      sourceAction: "bypass_separation",
      program: top.mapping.program,
      level: 1,
      family: top.mapping.family,
    };

    return {
      mode: "solo",
      isSolo: true,
      channelCount: 1,
      primaryInstrument: top.mapping.canonical,
      confidence: top.maxScore,
      channels: [channel],
      decisionReason: `Micro-sonido acústico aislado verificado (${top.mapping.label}) sin instrumentos de acompañamiento. Asignado a 1 canal directo sin separación.`,
      recommendedEngine: typeof process !== "undefined" && process.env?.BS_ROFORMER_CHECKPOINT ? "bs_roformer" : "demucs",
      isHierarchical: false,
      hierarchicalLevels: 1,
    };
  }

  // Caso 2: Instrumento solista monofónico/aislado REAL (sin batería, sin bajo, sin voz de fondo)
  // Requiere alta confianza (>= 0.82) y ausencia total de acompañamiento armónico/rítmico
  const isIsolatedSoloInstrument =
    top &&
    sortedFamilies.length === 1 &&
    top.maxScore >= 0.82 &&
    !hasAccompaniment &&
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
      level: 1,
      family: top.mapping.family,
    };

    return {
      mode: "solo",
      isSolo: true,
      channelCount: 1,
      primaryInstrument: top.mapping.canonical,
      confidence: top.maxScore,
      channels: [channel],
      decisionReason: `Instrumento solista aislado confirmado (${top.mapping.label}). Se crea canal único sin separación al no haber acompañamiento de fondo.`,
      recommendedEngine: typeof process !== "undefined" && process.env?.BS_ROFORMER_CHECKPOINT ? "bs_roformer" : "demucs",
      isHierarchical: false,
      hierarchicalLevels: 1,
    };
  }

  // Caso 3: Ensamble / Mezcla Polifónica / Pista Musical Completa (Bomba, Salsa, Cumbia, Orquesta, etc.)
  // Despacha separación jerárquica con Nivel 1 Troncal + Nivel 2 Semántico condicionado a candidatos reales.

  let recommendedEngine: "bs_roformer" | "demucs" | "ensemble" = "demucs";
  const hasRoformerCheckpoint = Boolean(
    typeof process !== "undefined" && process.env?.BS_ROFORMER_CHECKPOINT,
  );
  if (hasRoformerCheckpoint) {
    if (familyScores.has("guitar") && familyScores.has("piano")) {
      recommendedEngine = "demucs";
    } else if (sortedFamilies.length >= 4) {
      recommendedEngine = "ensemble";
    } else {
      recommendedEngine = "bs_roformer";
    }
  } else {
    recommendedEngine = "demucs";
  }

  // Construir canales de stems para el ensamble:
  // Nivel 1: Stems troncales base
  const channels: ChannelItem[] = STANDARD_ENSEMBLE_STEMS.map((s) => ({
    id: s.id,
    label: s.label,
    instrument: s.instrument,
    sourceAction: "demucs_stem",
    program: s.program,
    level: 1,
    family: s.instrument,
  }));

  // Guitarra y Piano en Nivel 1 (si se detectaron con relevancia)
  if (familyScores.has("guitar") && !channels.some((c) => c.instrument === "guitar")) {
    channels.push({
      id: "guitar",
      label: "Guitarra",
      instrument: "guitar",
      sourceAction: "demucs_stem",
      program: 24,
      level: 1,
      family: "guitar",
    });
  }
  if (familyScores.has("piano") && !channels.some((c) => c.instrument === "piano")) {
    channels.push({
      id: "piano",
      label: "Piano",
      instrument: "piano",
      sourceAction: "demucs_stem",
      program: 0,
      level: 1,
      family: "piano",
    });
  }

  // Nivel 2: Sub-separaciones Semánticas Condicionadas por IATPE
  const subExtractionsPlanned: Array<{ parentStem: string; targetInstruments: string[] }> = [];

  // 1. Percusión Latina & Orquestal (Congas, Bongó, Timbales, Campana, Güiro)
  const latinPercussionKeys = ["timbales", "conga", "bongo", "cowbell", "cymbals", "tambourine"];
  const detectedPercussion = latinPercussionKeys.filter((k) => familyScores.has(k));
  if (detectedPercussion.length > 0) {
    subExtractionsPlanned.push({
      parentStem: "drums",
      targetInstruments: detectedPercussion,
    });

    if (familyScores.has("conga") || familyScores.has("bongo")) {
      channels.push({
        id: "percussion-congas",
        label: "Congas / Bongó (Membrana)",
        instrument: "conga",
        sourceAction: "sub_separation",
        parentStem: "drums",
        program: 116,
        level: 2,
        family: "percussion",
      });
    }

    if (
      familyScores.has("timbales") ||
      familyScores.has("cowbell") ||
      familyScores.has("cymbals") ||
      familyScores.has("tambourine")
    ) {
      channels.push({
        id: "percussion-timbales",
        label: "Timbales / Campana / Fricción",
        instrument: "timbales",
        sourceAction: "sub_separation",
        parentStem: "drums",
        program: 119,
        level: 2,
        family: "percussion",
      });
    }
  }

  // 2. Vientos, Metales y Cuerdas en el tronco 'other'
  const harmonicTargets: string[] = [];

  // Metales / Vientos (Brass)
  if (
    familyScores.has("trumpet") ||
    familyScores.has("trombone") ||
    familyScores.has("saxophone") ||
    familyScores.has("brass") ||
    familyScores.has("french_horn") ||
    familyScores.has("tuba")
  ) {
    harmonicTargets.push("brass");
    channels.push({
      id: "brass",
      label: "Metales (Trompeta/Trombón/Saxo)",
      instrument: "brass",
      sourceAction: "sub_separation",
      parentStem: "other",
      program: 61,
      level: 2,
      family: "brass",
    });
  }

  // Maderas (Woodwinds)
  if (
    familyScores.has("flute") ||
    familyScores.has("clarinet") ||
    familyScores.has("oboe") ||
    familyScores.has("bassoon")
  ) {
    harmonicTargets.push("woodwinds");
    channels.push({
      id: "woodwinds",
      label: "Maderas (Flauta/Clarinete)",
      instrument: "woodwinds",
      sourceAction: "sub_separation",
      parentStem: "other",
      program: 73,
      level: 2,
      family: "woodwinds",
    });
  }

  // Cuerdas orquestales (Strings)
  if (
    familyScores.has("violin") ||
    familyScores.has("viola") ||
    familyScores.has("cello") ||
    familyScores.has("strings") ||
    familyScores.has("harp")
  ) {
    harmonicTargets.push("strings");
    channels.push({
      id: "strings",
      label: "Sección de Cuerdas (Violines/Chelo)",
      instrument: "strings",
      sourceAction: "sub_separation",
      parentStem: "other",
      program: 48,
      level: 2,
      family: "strings",
    });
  }

  // Acordeón / Órgano
  if (familyScores.has("accordion")) {
    harmonicTargets.push("accordion");
    channels.push({
      id: "accordion",
      label: "Acordeón",
      instrument: "accordion",
      sourceAction: "sub_separation",
      parentStem: "other",
      program: 21,
      level: 2,
      family: "harmony",
    });
  }

  // Sintetizador
  if (familyScores.has("synthesizer")) {
    harmonicTargets.push("synthesizer");
    channels.push({
      id: "synthesizer",
      label: "Sintetizador",
      instrument: "synthesizer",
      sourceAction: "sub_separation",
      parentStem: "other",
      program: 80,
      level: 2,
      family: "harmony",
    });
  }

  if (harmonicTargets.length > 0) {
    subExtractionsPlanned.push({
      parentStem: "other",
      targetInstruments: harmonicTargets,
    });
  }

  // Micro-sonidos si existen
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
          level: 1,
          family: f.mapping.family,
        });
      }
    }
  }

  const primaryInstrument = top ? top.mapping.canonical : "other";
  const confidence = top ? top.maxScore : 0.0;
  const detectedLabels = sortedFamilies.map((f) => f.mapping.label).join(", ");

  const isHierarchical = subExtractionsPlanned.length > 0;
  const decisionReason =
    candidates.length === 0
      ? "Textura musical no identificada con candidatos concluyentes. Despachando separación estándar de fuentes por principio precautorio."
      : isHierarchical
        ? `Mezcla polifónica densa con ${channels.length} canales previstos (${detectedLabels}). Activando separación jerárquica guiada por IATPE (Nivel 1 Troncal + Nivel 2 Semántico).`
        : `Mezcla polifónica estándar (${detectedLabels || "Múltiples instrumentos"}). Despachando separación troncal con ${recommendedEngine.toUpperCase()}.`;

  return {
    mode: "ensemble",
    isSolo: false,
    channelCount: channels.length,
    primaryInstrument,
    confidence,
    channels,
    decisionReason,
    recommendedEngine,
    isHierarchical,
    hierarchicalLevels: isHierarchical ? 2 : 1,
    subExtractionsPlanned: isHierarchical ? subExtractionsPlanned : undefined,
  };
}
