"""
Demand-Gated Vocal (WhisperX/CREPE) & Sound FX (`notehead=cross`) Pipeline (Delivery 7).
- Never runs on tracks that lack vocal stems or non-harmonic FX evidence.
- Evaluates syllable-to-note temporal alignment error (`medianAlignmentErrorMs`).
- Suppresses tonal AMT on FX regions and emits explicit `unpitched` events with
  `notehead="cross"` and `lyricText`.
"""
from typing import List, Dict, Any, Optional
import numpy as np


def should_run_vocal_pipeline(preanalysis: Dict[str, Any], vocal_stem_rms: float) -> bool:
    detected = set(preanalysis.get("detectedInstruments", [])) | set(preanalysis.get("uncertainInstruments", []))
    has_vocal_tag = bool(detected & {"vocals", "singing", "choir", "speech", "voice"})
    return has_vocal_tag and vocal_stem_rms >= 1e-4


def should_run_fx_pipeline(preanalysis: Dict[str, Any]) -> bool:
    detected = set(preanalysis.get("detectedInstruments", [])) | set(preanalysis.get("uncertainInstruments", []))
    fx_tags = {"sound_fx", "explosion", "gunshot", "wind", "thunder", "siren", "applause", "foley"}
    return bool(detected & fx_tags)


def align_syllables_to_notes(
    notes: List[Dict[str, Any]],
    word_timings: List[Dict[str, Any]],
    max_tolerance_sec: float = 0.18,
) -> Dict[str, Any]:
    """
    Aligns timestamped syllables/words (`[{"text": "Sol", "startSeconds": 1.02, "endSeconds": 1.35}]`)
    to transcribed vocal notes (`[{"startSeconds": 1.00, "durationSeconds": 0.40, "midiPitch": 64}]`)
    and computes alignment error metrics.
    """
    aligned_notes = []
    alignment_errors_ms: List[float] = []

    for note in notes:
        n_start = float(note["startSeconds"])
        best_word = None
        best_dist = max_tolerance_sec + 1.0
        for w in word_timings:
            dist = abs(float(w["startSeconds"]) - n_start)
            if dist <= max_tolerance_sec and dist < best_dist:
                best_dist = dist
                best_word = w

        enriched = dict(note)
        if best_word is not None:
            enriched["lyricText"] = str(best_word["text"])
            enriched["syllabic"] = best_word.get("syllabic", "single")
            enriched["alignmentErrorMs"] = round(best_dist * 1000.0, 2)
            alignment_errors_ms.append(best_dist * 1000.0)
        aligned_notes.append(enriched)

    median_err = float(np.median(alignment_errors_ms)) if alignment_errors_ms else 0.0
    return {
        "notes": aligned_notes,
        "matchedLyricsCount": len(alignment_errors_ms),
        "medianAlignmentErrorMs": round(median_err, 2),
    }


def generate_fx_crosshead_events(
    fx_detections: List[Dict[str, Any]],
    divisions: int = 480,
    bpm: float = 120.0,
) -> List[Dict[str, Any]]:
    """
    Converts non-harmonic AST/YAMNet FX regions into explicit unpitched crosshead events
    (suppressing tonal pitch estimation so zero phantom melodic notes are created).
    """
    sec_per_quarter = 60.0 / max(20.0, bpm)
    events: List[Dict[str, Any]] = []
    for det in fx_detections:
        start_sec = float(det.get("startSeconds", 0.0))
        end_sec = float(det.get("endSeconds", start_sec + 0.5))
        dur_sec = max(0.25, end_sec - start_sec)
        start_div = int(round((start_sec / sec_per_quarter) * divisions))
        dur_div = max(1, int(round((dur_sec / sec_per_quarter) * divisions)))
        label = str(det.get("label") or det.get("instrument") or "Efecto")

        events.append({
            "startSeconds": round(start_sec, 4),
            "durationSeconds": round(dur_sec, 4),
            "startDivisions": start_div,
            "durationDivisions": dur_div,
            "unpitched": True,
            "displayStep": "E",
            "displayOctave": 4,
            "notehead": "cross",
            "type": "quarter",
            "lyricText": label,
            "syllabic": "single",
            "suppressedTonalAmt": True,
        })
    return events
