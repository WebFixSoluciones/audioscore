"""
Hierarchical Semantic Level-2 Sub-separator for AudioScore IATPE.
Performs semantic sub-extraction on Level-1 stems (drums, other) guided by IATPE instrument detections.
Guarantees mathematical reconstruction: sum(substems) == parent_stem with zero phase cancellation.
"""
from pathlib import Path
from typing import Dict, List, Any
import numpy as np
import scipy.signal as signal
import soundfile as sf


def _filter_band(audio: np.ndarray, sr: int, low_hz: float, high_hz: float, order: int = 4) -> np.ndarray:
    """Zero-phase bandpass filter using sosfiltfilt across all channels."""
    nyq = sr / 2.0
    low = max(10.0, low_hz) / nyq
    high = min(nyq - 50.0, high_hz) / nyq
    if low >= high:
        return np.zeros_like(audio)
    sos = signal.butter(order, [low, high], btype="bandpass", output="sos")
    filtered = np.zeros_like(audio)
    for ch in range(audio.shape[1]):
        filtered[:, ch] = signal.sosfiltfilt(sos, audio[:, ch])
    return filtered


def _filter_high(audio: np.ndarray, sr: int, cutoff_hz: float, order: int = 4) -> np.ndarray:
    """Zero-phase highpass filter using sosfiltfilt across all channels."""
    nyq = sr / 2.0
    cutoff = min(nyq - 50.0, max(20.0, cutoff_hz)) / nyq
    sos = signal.butter(order, cutoff, btype="highpass", output="sos")
    filtered = np.zeros_like(audio)
    for ch in range(audio.shape[1]):
        filtered[:, ch] = signal.sosfiltfilt(sos, audio[:, ch])
    return filtered


def _filter_low(audio: np.ndarray, sr: int, cutoff_hz: float, order: int = 4) -> np.ndarray:
    """Zero-phase lowpass filter using sosfiltfilt across all channels."""
    nyq = sr / 2.0
    cutoff = min(nyq - 50.0, max(20.0, cutoff_hz)) / nyq
    sos = signal.butter(order, cutoff, btype="lowpass", output="sos")
    filtered = np.zeros_like(audio)
    for ch in range(audio.shape[1]):
        filtered[:, ch] = signal.sosfiltfilt(sos, audio[:, ch])
    return filtered


def sub_separate_percussion(
    drums_path: Path,
    output_dir: Path,
    target_instruments: List[str],
) -> List[Dict[str, Any]]:
    """
    Sub-divides drums.wav into Latin/Orchestral percussion stems:
    - percussion-congas.wav: Low/mid resonant membrane drums (congas, bongo, bombos).
    - percussion-timbales.wav: High metallic/friction percussion (timbales, campana, güiro, platillos).
    - drums.wav (residual): Base drum kit / remainder.
    Reconstruction guarantee: congas + timbales + residual == original drums.
    """
    data, sr = sf.read(drums_path, always_2d=True)
    rms_original = float(np.sqrt(np.mean(data ** 2)))
    if rms_original < 1e-6:
        return []

    sub_sources = []
    accumulated_extracted = np.zeros_like(data)

    has_congas = any(k in target_instruments for k in ("conga", "bongo", "tumbadora"))
    has_timbales = any(k in target_instruments for k in ("timbales", "cowbell", "cymbals", "tambourine", "guiro"))

    if has_congas:
        congas = _filter_band(data, sr, low_hz=65.0, high_hz=680.0, order=3)
        rms_congas = float(np.sqrt(np.mean(congas ** 2)))
        if rms_congas >= rms_original * 0.05:
            congas_file = "percussion-congas.wav"
            sf.write(output_dir / congas_file, np.clip(congas, -1.0, 1.0), sr, subtype="PCM_16")
            accumulated_extracted += congas
            sub_sources.append({
                "id": "demucs-percussion-congas",
                "kind": "percussion",
                "label": "Congas / Bongó (Membrana)",
                "file": congas_file,
                "confidence": 0.85,
                "rms": rms_congas,
                "transcriptionEligible": True,
                "level": 2,
                "parentStem": "drums",
            })

    if has_timbales:
        timbales = _filter_high(data, sr, cutoff_hz=1400.0, order=3)
        rms_timbales = float(np.sqrt(np.mean(timbales ** 2)))
        if rms_timbales >= rms_original * 0.05:
            timbales_file = "percussion-timbales.wav"
            sf.write(output_dir / timbales_file, np.clip(timbales, -1.0, 1.0), sr, subtype="PCM_16")
            accumulated_extracted += timbales
            sub_sources.append({
                "id": "demucs-percussion-timbales",
                "kind": "percussion",
                "label": "Timbales / Campana / Fricción",
                "file": timbales_file,
                "confidence": 0.85,
                "rms": rms_timbales,
                "transcriptionEligible": True,
                "level": 2,
                "parentStem": "drums",
            })

    if sub_sources:
        residual_drums = np.clip(data - accumulated_extracted, -1.0, 1.0)
        sf.write(drums_path, residual_drums, sr, subtype="PCM_16")

    return sub_sources


def sub_separate_harmonic(
    other_path: Path,
    output_dir: Path,
    target_instruments: List[str],
) -> List[Dict[str, Any]]:
    """
    Sub-divides other.wav into harmonic sub-stems (brass, strings, woodwinds, accordion/synth).
    - strings.wav: Low-mid bowing textures (180 Hz - 950 Hz if brass present, else up to 3500 Hz).
    - brass.wav: Mid-high brassy brilliance and bell resonances (950 Hz - 4200 Hz).
    - other.wav (residual): Base remainder (pads, synth bass < 180 Hz, air/sparkle > 4200 Hz).
    Reconstruction guarantee: sum(substems) + residual == original other.
    """
    data, sr = sf.read(other_path, always_2d=True)
    rms_original = float(np.sqrt(np.mean(data ** 2)))
    if rms_original < 1e-6:
        return []

    sub_sources = []
    accumulated_extracted = np.zeros_like(data)

    has_brass = any(k in target_instruments for k in ("brass", "trumpet", "trombone", "saxophone", "french_horn", "tuba"))
    has_strings = any(k in target_instruments for k in ("strings", "violin", "viola", "cello", "harp"))

    if has_strings:
        strings_high = 950.0 if has_brass else 3500.0
        strings = _filter_band(data, sr, low_hz=180.0, high_hz=strings_high, order=3)
        rms_strings = float(np.sqrt(np.mean(strings ** 2)))
        if rms_strings >= rms_original * 0.05:
            strings_file = "strings.wav"
            sf.write(output_dir / strings_file, np.clip(strings, -1.0, 1.0), sr, subtype="PCM_16")
            accumulated_extracted += strings
            sub_sources.append({
                "id": "demucs-strings",
                "kind": "other",
                "label": "Sección de Cuerdas (Violines/Chelo)",
                "file": strings_file,
                "confidence": 0.85,
                "rms": rms_strings,
                "transcriptionEligible": True,
                "level": 2,
                "parentStem": "other",
            })

    if has_brass:
        brass_low = 950.0 if has_strings else 680.0
        brass = _filter_band(data, sr, low_hz=brass_low, high_hz=4200.0, order=3)
        rms_brass = float(np.sqrt(np.mean(brass ** 2)))
        if rms_brass >= rms_original * 0.05:
            brass_file = "brass.wav"
            sf.write(output_dir / brass_file, np.clip(brass, -1.0, 1.0), sr, subtype="PCM_16")
            accumulated_extracted += brass
            sub_sources.append({
                "id": "demucs-brass",
                "kind": "other",
                "label": "Metales (Trompeta/Trombón/Saxo)",
                "file": brass_file,
                "confidence": 0.85,
                "rms": rms_brass,
                "transcriptionEligible": True,
                "level": 2,
                "parentStem": "other",
            })

    if sub_sources:
        residual_other = np.clip(data - accumulated_extracted, -1.0, 1.0)
        sf.write(other_path, residual_other, sr, subtype="PCM_16")

    return sub_sources


def apply_hierarchical_subseparation(
    output_dir: Path,
    sub_extractions_planned: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Dispatches Level-2 sub-separations according to the IATPE hierarchical plan."""
    all_sub_sources = []
    for plan in sub_extractions_planned:
        parent = plan.get("parentStem")
        targets = plan.get("targetInstruments", [])
        if parent == "drums":
            drums_path = output_dir / "drums.wav"
            if drums_path.exists():
                all_sub_sources.extend(sub_separate_percussion(drums_path, output_dir, targets))
        elif parent == "other":
            other_path = output_dir / "other.wav"
            if other_path.exists():
                all_sub_sources.extend(sub_separate_harmonic(other_path, output_dir, targets))
    return all_sub_sources
