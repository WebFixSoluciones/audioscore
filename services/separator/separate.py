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


LABELS = {
    "piano": "Piano", "guitar": "Guitarra", "bass": "Bajo",
    "drums": "Batería", "vocals": "Voz", "other": "Otros sonidos",
}


def separate(input_path: Path, output: Path, model_name: str, device: str) -> dict:
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    torch.set_num_threads(max(1, int(os.environ.get("DEMUCS_THREADS", "2"))))
    torch.manual_seed(0)
    random.seed(0)
    np.random.seed(0)
    # Model loaders may print. Keep stdout reserved for the JSON contract.
    with contextlib.redirect_stdout(sys.stderr):
        model = get_model(model_name).eval()
    data, sample_rate = sf.read(input_path, dtype="float32", always_2d=True)
    if sample_rate != model.samplerate or data.shape[1] != model.audio_channels:
        raise ValueError("Se requiere WAV estéreo normalizado a 44.1 kHz")
    if not np.isfinite(data).all() or len(data) == 0:
        raise ValueError("Audio vacío o inválido")
    duration = len(data) / sample_rate
    if duration > 900:
        raise ValueError("El separador integrado admite hasta 15 minutos")
    waveform = torch.from_numpy(data.T.copy())
    reference = waveform.mean(0)
    mean, std = reference.mean(), reference.std()
    if std.item() < 1e-6:
        raise ValueError("El audio está en silencio")
    normalized = (waveform - mean) / std
    with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
        separated = apply_model(
            model, normalized[None], device=device, shifts=1, split=True,
            overlap=0.25, progress=False, num_workers=0,
        )[0].cpu() * std + mean
    if separated.shape[-1] != len(data) or not torch.isfinite(separated).all():
        raise ValueError("El modelo no conservó la duración o produjo valores inválidos")
    # Common gain preserves balance across stems, unlike per-file normalization.
    peak = separated.abs().max().item()
    gain = min(1.0, 0.99 / max(peak, 1e-9))
    input_ac = data.astype("float64") - data.mean(axis=0)
    input_rms = float(np.sqrt(np.mean(input_ac ** 2)))
    output.mkdir(parents=True, exist_ok=True)
    sources, omitted = [], []
    for kind, samples in zip(model.sources, separated):
        audio = samples.numpy().T * gain
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
        })
    if not sources:
        raise ValueError("No se obtuvieron stems con señal utilizable")
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
    args = parser.parse_args()
    try:
        print(json.dumps(separate(args.input, args.output, args.model, args.device), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
