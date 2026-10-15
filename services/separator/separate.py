"""Offline separator for AudioScore AI v0.03 (Deliveries 1, 2 & 4).
- Integrates context-padded slicing with zero sample loss.
- Emits stage-by-stage telemetry (loadMs, inferenceMs, subseparationMs, ioMs, peakMemoryMb,
  effectiveInferredSeconds, timeToFirstAudibleStemMs).
- Streams incremental stem availability events (`{"event": "stem_ready", ...}`) on stderr/stdout
  so the DAW mixer can play stems before AMT transcription starts.
- Preserves full provenance metadata (sha256, engine, checkpoint, gain, sampleRate, durationSeconds).
"""
import argparse
import contextlib
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
try:
    import resource
except ImportError:
    resource = None
import sys
import time
from typing import Optional, Dict, Any, Callable

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model

LABELS = {
    "piano": "Piano",
    "guitar": "Guitarra",
    "bass": "Bajo",
    "drums": "Batería",
    "vocals": "Voz",
    "other": "Otros sonidos",
}


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _peak_rss_mb() -> float:
    if resource is None:
        return 0.0
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # Linux reports KB, macOS reports bytes
    if sys.platform == "darwin":
        return round(usage / (1024.0 * 1024.0), 2)
    return round(usage / 1024.0, 2)


@lru_cache(maxsize=2)
def cached_model(model_name: str):
    from demucs.pretrained import get_model
    with contextlib.redirect_stdout(sys.stderr):
        return get_model(model_name).eval()


def separate(
    input_path: Path,
    output: Path,
    model_name: str,
    device: str,
    quality: str = "balanced",
    hierarchical_plan: Optional[dict] = None,
    on_stem_ready: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    from audio_io import load_audio

    t_job_start = time.perf_counter()
    t_load_start = time.perf_counter()
    input_sha256 = _file_sha256(Path(input_path))
    model = cached_model(model_name)
    target_sr = int(getattr(model, "samplerate", 44100))
    data, sample_rate = load_audio(input_path, target_sr=target_sr)
    load_ms = round((time.perf_counter() - t_load_start) * 1000.0, 2)

    if device == "cuda" and torch.cuda.is_available():
        model = model.to("cuda")
    else:
        device = "cpu"
        model = model.to("cpu")

    duration = len(data) / sample_rate
    if duration > 900:
        raise ValueError("El separador integrado admite hasta 15 minutos")

    def run_inference(chunk_data: np.ndarray, chunk_sr: int) -> Dict[str, np.ndarray]:
        wf = torch.from_numpy(chunk_data.T.copy())
        ref = wf.mean(0)
        m, s = ref.mean(), ref.std()
        if s.item() < 1e-6:
            return {k: np.zeros_like(chunk_data, dtype=np.float32) for k in model.sources}
        norm = (wf - m) / s
        with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
            sep = apply_model(
                model,
                norm[None],
                device=device,
                shifts=2 if quality == "careful" else 1,
                split=True,
                overlap=0.5 if quality == "careful" else 0.25,
                progress=False,
                num_workers=0,
            )[0].cpu() * s + m
        return {k: sep[idx].numpy().T for idx, k in enumerate(model.sources)}

    t_inf_start = time.perf_counter()
    slicing_telemetry: Dict[str, Any] = {
        "mode": "full_pass",
        "totalDurationSeconds": round(duration, 4),
        "effectiveInferredSeconds": round(duration, 4),
        "coverageRatio": 1.0,
        "intervalsCount": 1,
    }
    if duration > 20.0:
        try:
            from slicing_engine import apply_dynamic_slicing
            stems_map, slicing_telemetry = apply_dynamic_slicing(
                data, sample_rate, run_inference, return_telemetry=True
            )
        except Exception as e:
            sys.stderr.write(f"Aviso Slicing: {e}, fallback a paso único\n")
            stems_map = run_inference(data, sample_rate)
    else:
        stems_map = run_inference(data, sample_rate)
    inference_ms = round((time.perf_counter() - t_inf_start) * 1000.0, 2)

    t_io_start = time.perf_counter()
    all_peaks = [float(np.abs(audio).max()) for audio in stems_map.values()]
    peak = max(all_peaks) if all_peaks else 1e-9
    gain = min(1.0, 0.99 / max(peak, 1e-9))
    input_ac = data.astype("float64") - data.mean(axis=0)
    input_rms = float(np.sqrt(np.mean(input_ac ** 2)))
    output.mkdir(parents=True, exist_ok=True)

    sources, omitted = [], []
    time_to_first_stem_ms: Optional[float] = None

    for kind in model.sources:
        if kind not in stems_map:
            continue
        audio = (stems_map[kind] * gain).astype(np.float32)
        ac = audio.astype("float64") - audio.mean(axis=0)
        rms = float(np.sqrt(np.mean(ac ** 2)))
        if rms < max(1e-5, input_rms * gain * 0.001):
            omitted.append(kind)
            continue
        filename = f"{kind}.wav"
        stem_path = output / filename
        sf.write(stem_path, audio, sample_rate, subtype="PCM_16")
        if time_to_first_stem_ms is None:
            time_to_first_stem_ms = round((time.perf_counter() - t_job_start) * 1000.0, 2)

        stem_entry = {
            "id": f"demucs-{kind}",
            "kind": kind,
            "label": LABELS.get(kind, kind.capitalize()),
            "file": filename,
            "confidence": 0.88,
            "rms": rms,
            "gain": gain,
            "sampleRate": sample_rate,
            "durationSeconds": round(duration, 4),
            "sha256": _file_sha256(stem_path),
            "engine": "demucs",
            "checkpoint": model_name,
            "parentInputSha256": input_sha256,
            "transcriptionEligible": rms >= input_rms * gain * 0.031623,
            "level": 1,
        }
        sources.append(stem_entry)
        if on_stem_ready is not None:
            on_stem_ready(stem_entry)

    io_ms = round((time.perf_counter() - t_io_start) * 1000.0, 2)
    if not sources:
        raise ValueError("No se obtuvieron stems con señal utilizable")

    t_sub_start = time.perf_counter()
    if hierarchical_plan and hierarchical_plan.get("subExtractionsPlanned"):
        try:
            from hierarchical_subseparator import apply_hierarchical_subseparation
            sub_sources = apply_hierarchical_subseparation(
                output, hierarchical_plan["subExtractionsPlanned"], engine_prefix="demucs"
            )
            if sub_sources:
                sources.extend(sub_sources)
                for sub_entry in sub_sources:
                    if on_stem_ready is not None:
                        on_stem_ready(sub_entry)
        except Exception as e:
            sys.stderr.write(f"Aviso: Sub-separación Nivel 2 omitida por excepción: {e}\n")
    subseparation_ms = round((time.perf_counter() - t_sub_start) * 1000.0, 2)

    warnings = [
        "Demucs separa categorías estimadas; cada canal puede contener otros instrumentos.",
        "La energía de un canal no confirma la presencia del instrumento; revisa escuchando sus stems.",
    ]
    if model_name == "htdemucs_6s":
        warnings.append("La separación de seis fuentes es experimental; piano puede presentar filtraciones y artefactos.")
    if omitted:
        warnings.append("Canales casi silenciosos omitidos: " + ", ".join(omitted))

    total_wall_ms = round((time.perf_counter() - t_job_start) * 1000.0, 2)
    return {
        "model": model_name,
        "engine": "demucs",
        "checkpoint": model_name,
        "sampleRate": sample_rate,
        "durationSeconds": round(duration, 4),
        "gain": gain,
        "inputSha256": input_sha256,
        "sources": sources,
        "warnings": warnings,
        "telemetry": {
            "loadMs": load_ms,
            "inferenceMs": inference_ms,
            "ioMs": io_ms,
            "subseparationMs": subseparation_ms,
            "totalWallMs": total_wall_ms,
            "timeToFirstAudibleStemMs": time_to_first_stem_ms or total_wall_ms,
            "peakMemoryMb": _peak_rss_mb(),
            "effectiveInferredSeconds": slicing_telemetry.get("effectiveInferredSeconds", round(duration, 4)),
            "coverageRatio": slicing_telemetry.get("coverageRatio", 1.0),
            "slicingMode": slicing_telemetry.get("mode", "full_pass"),
            "intervalsCount": slicing_telemetry.get("intervalsCount", 1),
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", choices=["htdemucs", "htdemucs_6s"], default="htdemucs_6s")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--quality", choices=["balanced", "careful"], default="balanced")
    parser.add_argument("--plan", default=None, help="JSON string or path of hierarchical channel plan")
    args = parser.parse_args()
    hierarchical_plan = None
    if args.plan:
        try:
            if Path(args.plan).exists():
                hierarchical_plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
            else:
                hierarchical_plan = json.loads(args.plan)
        except Exception:
            pass
    try:
        def _emit_incremental(stem_meta: Dict[str, Any]):
            sys.stderr.write(json.dumps({"event": "stem_ready", "stem": stem_meta}, ensure_ascii=False) + "\n")
            sys.stderr.flush()

        print(
            json.dumps(
                separate(
                    args.input,
                    args.output,
                    args.model,
                    args.device,
                    args.quality,
                    hierarchical_plan,
                    on_stem_ready=_emit_incremental,
                )
            )
        )
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
