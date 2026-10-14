"""Offline separator: WAV input, real aligned WAV stems, JSON manifest on stdout.

No web server, cloud credentials or user-controlled downloads are needed here.
The authenticated Node worker owns uploads, quotas, temporary files and jobs.
"""
import argparse
import contextlib
import json
import os
import random
from pathlib import Path
import sys
from functools import lru_cache


LABELS = {
    "piano": "Piano", "guitar": "Guitarra", "bass": "Bajo",
    "drums": "Batería", "vocals": "Voz", "other": "Otros sonidos",
}


@lru_cache(maxsize=1)
def cached_model(model_name: str):
    from demucs.pretrained import get_model
    with contextlib.redirect_stdout(sys.stderr):
        return get_model(model_name).eval()


def separate(input_path: Path, output: Path, model_name: str, device: str, quality: str = "balanced", hierarchical_plan: dict = None) -> dict:
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model

    if quality not in ("balanced", "careful"):
        raise ValueError("Calidad de separación desconocida")

    num_threads = int(os.environ.get("DEMUCS_THREADS", str(os.cpu_count() or 4)))
    torch.set_num_threads(max(1, num_threads))
    torch.manual_seed(0)
    random.seed(0)
    np.random.seed(0)
    # Model loaders may print. Keep stdout reserved for the JSON contract.
    model = cached_model(model_name)
    from audio_io import load_audio
    data, sample_rate = load_audio(input_path, target_sr=model.samplerate)
    duration = len(data) / sample_rate
    if duration > 900:
        raise ValueError("El separador integrado admite hasta 15 minutos")
    def run_inference(chunk_data, chunk_sr):
        wf = torch.from_numpy(chunk_data.T.copy())
        ref = wf.mean(0)
        m, s = ref.mean(), ref.std()
        if s.item() < 1e-6:
            return {k: np.zeros_like(chunk_data, dtype=np.float32) for k in model.sources}
        norm = (wf - m) / s
        with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
            sep = apply_model(
                model, norm[None], device=device, shifts=2 if quality == "careful" else 1, split=True,
                overlap=0.5 if quality == "careful" else 0.25, progress=False, num_workers=0,
            )[0].cpu() * s + m
        return {k: sep[idx].numpy().T for idx, k in enumerate(model.sources)}

    if duration > 20.0:
        try:
            from slicing_engine import apply_dynamic_slicing
            stems_map = apply_dynamic_slicing(data, sample_rate, run_inference)
        except Exception as e:
            sys.stderr.write(f"Aviso Slicing: {e}, fallback a paso único\n")
            stems_map = run_inference(data, sample_rate)
    else:
        stems_map = run_inference(data, sample_rate)

    all_peaks = [float(np.abs(audio).max()) for audio in stems_map.values()]
    peak = max(all_peaks) if all_peaks else 1e-9
    gain = min(1.0, 0.99 / max(peak, 1e-9))
    input_ac = data.astype("float64") - data.mean(axis=0)
    input_rms = float(np.sqrt(np.mean(input_ac ** 2)))
    output.mkdir(parents=True, exist_ok=True)
    sources, omitted = [], []
    for kind in model.sources:
        if kind not in stems_map:
            continue
        audio = stems_map[kind] * gain
        ac = audio.astype("float64") - audio.mean(axis=0)
        rms = float(np.sqrt(np.mean(ac ** 2)))
        # Energy is only a silence gate, never a probability of instrument presence.
        if rms < max(1e-5, input_rms * gain * 0.001):
            omitted.append(kind)
            continue
        filename = f"{kind}.wav"
        sf.write(output / filename, audio, sample_rate, subtype="PCM_16")
        sources.append({
            "id": f"demucs-{kind}", "kind": kind, "label": LABELS[kind],
            "file": filename, "confidence": 0, "rms": rms,
            "transcriptionEligible": rms >= input_rms * gain * 0.031623,
            "level": 1,
        })
    if not sources:
        raise ValueError("No se obtuvieron stems con señal utilizable")

    # Ejecutar sub-separación semántica guiada por IATPE (Nivel 2) si fue planificada
    if hierarchical_plan and hierarchical_plan.get("subExtractionsPlanned"):
        try:
            from hierarchical_subseparator import apply_hierarchical_subseparation
            sub_sources = apply_hierarchical_subseparation(output, hierarchical_plan["subExtractionsPlanned"])
            if sub_sources:
                sources.extend(sub_sources)
        except Exception as e:
            sys.stderr.write(f"Aviso: Sub-separación Nivel 2 omitida por excepción: {e}\n")

    warnings = [
        "Demucs separa categorías estimadas; cada canal puede contener otros instrumentos.",
        "La energía de un canal no confirma la presencia del instrumento; revisa escuchando sus stems.",
    ]
    if model_name == "htdemucs_6s":
        warnings.append("La separación de seis fuentes es experimental; piano puede presentar filtraciones y artefactos.")
    if omitted:
        warnings.append("Canales casi silenciosos omitidos: " + ", ".join(omitted))
    return {
        "model": model_name, "durationSeconds": duration, "gain": gain,
        "sources": sources, "warnings": warnings,
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
        print(json.dumps(separate(args.input, args.output, args.model, args.device, args.quality, hierarchical_plan), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
