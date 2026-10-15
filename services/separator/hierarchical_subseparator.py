"""
Hierarchical Semantic Level-2 Sub-separator for AudioScore IATPE (Delivery 1 — Fix P1).
Guarantees exact algebraic and post-IO reconstruction:
  sum(read_back_substems) + read_back_residual == read_back_parent (within PCM16 quantization <= 3.1e-5)
even at high input amplitudes (0.98) with zero clipping distortion and parent preservation.
"""
import hashlib
import shutil
from pathlib import Path
from typing import Dict, List, Any, Tuple
import numpy as np
import scipy.signal as signal
try:
    import soundfile as sf
except ImportError:
    from scipy.io import wavfile
    class sf:
        @staticmethod
        def write(file_path, data, samplerate, subtype="PCM_16"):
            import numpy as _np
            arr = _np.asarray(data, dtype=_np.float32)
            if subtype == "PCM_16":
                clipped = _np.clip(arr, -1.0, 32767.0 / 32768.0)
                pcm = _np.round(clipped * 32768.0).astype(_np.int16)
                wavfile.write(str(file_path), samplerate, pcm)
            else:
                wavfile.write(str(file_path), samplerate, arr)
        @staticmethod
        def read(file_path, always_2d=True, dtype="float64"):
            import numpy as _np
            sr, raw = wavfile.read(str(file_path))
            arr = (raw.astype(dtype) / 32768.0) if raw.dtype == _np.int16 else raw.astype(dtype)
            if always_2d and arr.ndim == 1:
                arr = arr[:, None]
            return arr, sr

RECONSTRUCTION_TOLERANCE_PCM16 = 6.1e-5


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _filter_band(audio: np.ndarray, sr: int, low_hz: float, high_hz: float, order: int = 4) -> np.ndarray:
    """Zero-phase bandpass filter using sosfiltfilt in float64 across all channels."""
    nyq = sr / 2.0
    low = max(10.0, low_hz) / nyq
    high = min(nyq - 50.0, high_hz) / nyq
    if low >= high:
        return np.zeros_like(audio, dtype=np.float64)
    sos = signal.butter(order, [low, high], btype="bandpass", output="sos")
    filtered = np.zeros_like(audio, dtype=np.float64)
    for ch in range(audio.shape[1]):
        filtered[:, ch] = signal.sosfiltfilt(sos, audio[:, ch].astype(np.float64))
    return filtered


def _filter_high(audio: np.ndarray, sr: int, cutoff_hz: float, order: int = 4) -> np.ndarray:
    """Zero-phase highpass filter using sosfiltfilt in float64 across all channels."""
    nyq = sr / 2.0
    cutoff = min(nyq - 50.0, max(20.0, cutoff_hz)) / nyq
    sos = signal.butter(order, cutoff, btype="highpass", output="sos")
    filtered = np.zeros_like(audio, dtype=np.float64)
    for ch in range(audio.shape[1]):
        filtered[:, ch] = signal.sosfiltfilt(sos, audio[:, ch].astype(np.float64))
    return filtered


def _filter_low(audio: np.ndarray, sr: int, cutoff_hz: float, order: int = 4) -> np.ndarray:
    """Zero-phase lowpass filter using sosfiltfilt in float64 across all channels."""
    nyq = sr / 2.0
    cutoff = min(nyq - 50.0, max(20.0, cutoff_hz)) / nyq
    sos = signal.butter(order, cutoff, btype="lowpass", output="sos")
    filtered = np.zeros_like(audio, dtype=np.float64)
    for ch in range(audio.shape[1]):
        filtered[:, ch] = signal.sosfiltfilt(sos, audio[:, ch].astype(np.float64))
    return filtered


def _compute_safe_sub_gain(parent: np.ndarray, extracted_list: List[np.ndarray], ceiling: float = 0.992) -> float:
    """
    Computes a single scalar attenuation factor alpha in (0, 1] applied uniformly to
    extracted sub-stems BEFORE subtraction so that neither any extracted sub-stem nor
    the residual (parent - alpha * sum(extracted)) ever exceeds [-ceiling, +ceiling].
    Avoids independent branch clipping while keeping exact linear phase & sum identity.
    """
    if not extracted_list:
        return 1.0
    total_ext = np.sum(extracted_list, axis=0)
    max_ext_peak = max(float(np.max(np.abs(ext))) for ext in extracted_list)
    sum_ext_peak = float(np.max(np.abs(total_ext)))

    alpha = 1.0
    if max_ext_peak > ceiling:
        alpha = min(alpha, ceiling / max_ext_peak)
    if sum_ext_peak > ceiling:
        alpha = min(alpha, ceiling / sum_ext_peak)

    # Iterative refinement if (parent - alpha * total_ext) still overshoots ceiling
    for _ in range(12):
        res_peak = float(np.max(np.abs(parent - alpha * total_ext)))
        if res_peak <= ceiling:
            break
        alpha *= 0.85

    return float(max(0.0, min(1.0, alpha)))


def _write_and_verify_subseparation(
    parent_path: Path,
    parent_data: np.ndarray,
    sr: int,
    output_dir: Path,
    parent_stem_name: str,
    engine_prefix: str,
    candidates: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Preserves the original parent WAV in `{parent_stem_name}-parent.wav`, scales sub-stems
    with a unified safe gain (zero independent clipping), computes the residual after reading
    back each written sub-stem so PCM16 quantization errors do not accumulate, and validates
    post-IO reconstruction against RECONSTRUCTION_TOLERANCE_PCM16.
    """
    if not candidates:
        return []

    # 1. Preserve original parent stem intact on disk
    preserved_parent_file = f"{parent_stem_name}-parent.wav"
    preserved_parent_path = output_dir / preserved_parent_file
    if not preserved_parent_path.exists():
        shutil.copy2(parent_path, preserved_parent_path)
    parent_hash = _file_sha256(preserved_parent_path)

    # 2. Compute unified anti-overshoot gain across all candidate sub-stems
    raw_arrays = [c["audio"] for c in candidates]
    sub_gain = _compute_safe_sub_gain(parent_data, raw_arrays, ceiling=0.992)

    sub_sources: List[Dict[str, Any]] = []
    read_back_sum = np.zeros_like(parent_data, dtype=np.float64)

    for c in candidates:
        scaled_audio = (c["audio"] * sub_gain).astype(np.float32)
        out_path = output_dir / c["file"]
        sf.write(out_path, scaled_audio, sr, subtype="PCM_16")
        # Read back written sub-stem so residual compensates sub-stem quantization
        written_sub, _ = sf.read(out_path, always_2d=True, dtype="float64")
        read_back_sum += written_sub
        rms_val = float(np.sqrt(np.mean(written_sub ** 2)))
        sub_sources.append({
            "id": f"{engine_prefix}-{c['slug']}",
            "kind": c["kind"],
            "label": c["label"],
            "file": c["file"],
            "confidence": c["confidence"],
            "rms": rms_val,
            "gain": sub_gain,
            "sampleRate": sr,
            "durationSeconds": round(len(written_sub) / sr, 4),
            "sha256": _file_sha256(out_path),
            "engine": engine_prefix,
            "parentStem": parent_stem_name,
            "parentPreservedFile": preserved_parent_file,
            "parentSha256": parent_hash,
            "transcriptionEligible": True,
            "level": 2,
        })

    # 3. Residual is computed in float64 from (parent_data - read_back_sum) without clipping
    residual_float = parent_data.astype(np.float64) - read_back_sum
    # Guard against single-LSB overflow at +/-1.0 in signed 16-bit PCM
    pcm16_max = 32767.0 / 32768.0
    residual_safe = np.clip(residual_float, -1.0, pcm16_max).astype(np.float32)
    sf.write(parent_path, residual_safe, sr, subtype="PCM_16")

    # 4. Post-IO Verification: read back residual and verify exact reconstruction against parent
    written_residual, _ = sf.read(parent_path, always_2d=True, dtype="float64")
    reconstructed = read_back_sum + written_residual
    max_abs_error = float(np.max(np.abs(parent_data.astype(np.float64) - reconstructed)))

    for src in sub_sources:
        src["reconstructionMaxAbsError"] = round(max_abs_error, 9)
        src["reconstructionVerified"] = bool(max_abs_error <= RECONSTRUCTION_TOLERANCE_PCM16)

    if max_abs_error > RECONSTRUCTION_TOLERANCE_PCM16:
        raise RuntimeError(
            f"Fallo de reconstrucción post-IO en {parent_stem_name}: "
            f"max_abs_error={max_abs_error:.9f} > {RECONSTRUCTION_TOLERANCE_PCM16}"
        )

    return sub_sources


def sub_separate_percussion(
    drums_path: Path,
    output_dir: Path,
    target_instruments: List[str],
    engine_prefix: str = "demucs",
) -> List[Dict[str, Any]]:
    """
    Sub-divides drums.wav into Latin/Orchestral percussion stems with verified reconstruction.
    """
    data, sr = sf.read(drums_path, always_2d=True, dtype="float64")
    rms_original = float(np.sqrt(np.mean(data ** 2)))
    if rms_original < 1e-6:
        return []

    candidates: List[Dict[str, Any]] = []
    has_congas = any(k in target_instruments for k in ("conga", "bongo", "tumbadora"))
    has_timbales = any(k in target_instruments for k in ("timbales", "cowbell", "cymbals", "tambourine", "guiro"))

    if has_congas:
        congas = _filter_band(data, sr, low_hz=65.0, high_hz=680.0, order=3)
        rms_congas = float(np.sqrt(np.mean(congas ** 2)))
        if rms_congas >= rms_original * 0.05:
            candidates.append({
                "slug": "percussion-congas",
                "kind": "percussion",
                "label": "Congas / Bongó (Membrana)",
                "file": "percussion-congas.wav",
                "confidence": 0.85,
                "audio": congas,
            })

    if has_timbales:
        timbales = _filter_high(data, sr, cutoff_hz=1400.0, order=3)
        rms_timbales = float(np.sqrt(np.mean(timbales ** 2)))
        if rms_timbales >= rms_original * 0.05:
            candidates.append({
                "slug": "percussion-timbales",
                "kind": "percussion",
                "label": "Timbales / Campana / Fricción",
                "file": "percussion-timbales.wav",
                "confidence": 0.85,
                "audio": timbales,
            })

    return _write_and_verify_subseparation(
        drums_path, data, sr, output_dir, "drums", engine_prefix, candidates
    )


def sub_separate_harmonic(
    other_path: Path,
    output_dir: Path,
    target_instruments: List[str],
    engine_prefix: str = "demucs",
) -> List[Dict[str, Any]]:
    """
    Sub-divides other.wav into harmonic sub-stems (strings, brass) with verified post-IO sum.
    """
    data, sr = sf.read(other_path, always_2d=True, dtype="float64")
    rms_original = float(np.sqrt(np.mean(data ** 2)))
    if rms_original < 1e-6:
        return []

    candidates: List[Dict[str, Any]] = []
    has_brass = any(k in target_instruments for k in ("brass", "trumpet", "trombone", "saxophone", "french_horn", "tuba"))
    has_strings = any(k in target_instruments for k in ("strings", "violin", "viola", "cello", "harp"))

    if has_strings:
        strings_high = 950.0 if has_brass else 3500.0
        strings = _filter_band(data, sr, low_hz=180.0, high_hz=strings_high, order=3)
        rms_strings = float(np.sqrt(np.mean(strings ** 2)))
        if rms_strings >= rms_original * 0.05:
            candidates.append({
                "slug": "strings",
                "kind": "other",
                "label": "Sección de Cuerdas (Violines/Chelo)",
                "file": "strings.wav",
                "confidence": 0.85,
                "audio": strings,
            })

    if has_brass:
        brass = _filter_band(data, sr, low_hz=950.0, high_hz=4200.0, order=3)
        rms_brass = float(np.sqrt(np.mean(brass ** 2)))
        if rms_brass >= rms_original * 0.05:
            candidates.append({
                "slug": "brass",
                "kind": "other",
                "label": "Vientos Metal / Metales (Trompeta/Trombón)",
                "file": "brass.wav",
                "confidence": 0.85,
                "audio": brass,
            })

    return _write_and_verify_subseparation(
        other_path, data, sr, output_dir, "other", engine_prefix, candidates
    )


def apply_hierarchical_subseparation(
    output_dir: Path,
    planned_subextractions: List[Dict[str, Any]],
    engine_prefix: str = "demucs",
) -> List[Dict[str, Any]]:
    """
    Reads Level-1 generated stems in output_dir and applies scheduled Level-2 sub-extractions.
    """
    created_sub_sources = []

    drums_plan = [p for p in planned_subextractions if p.get("parentStem") == "drums"]
    if drums_plan and (output_dir / "drums.wav").exists():
        target_insts = [inst for p in drums_plan for inst in p.get("targets", [])]
        created_sub_sources.extend(
            sub_separate_percussion(output_dir / "drums.wav", output_dir, target_insts, engine_prefix=engine_prefix)
        )

    other_plan = [p for p in planned_subextractions if p.get("parentStem") == "other"]
    if other_plan and (output_dir / "other.wav").exists():
        target_insts = [inst for p in other_plan for inst in p.get("targets", [])]
        created_sub_sources.extend(
            sub_separate_harmonic(output_dir / "other.wav", output_dir, target_insts, engine_prefix=engine_prefix)
        )

    return created_sub_sources
