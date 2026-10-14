"""BS-RoFormer Source Separation Adapter.
Band-Split RoFormer (Rotary Position Embedding Transformer for High-Resolution Music Source Separation).
Supports chunked sliding-window inference with continuous Hann overlap-add to maintain CPU RAM below 1.5 GB.
"""
import contextlib
import os
import sys
from pathlib import Path
from functools import lru_cache
import numpy as np
import soundfile as sf
import torch

from audio_io import load_audio

LABELS = {
    "vocals": "Voz Líder",
    "drums": "Batería / Percusión",
    "bass": "Bajo",
    "other": "Otros Instrumentos",
    "piano": "Piano",
    "guitar": "Guitarra",
}


@lru_cache(maxsize=1)
def get_roformer_model(variant: str = "bs_roformer"):
    """Instantiate Band-Split RoFormer architecture with valid arguments for installed library."""
    with contextlib.redirect_stdout(sys.stderr):
        from bs_roformer import BSRoformer
        model = BSRoformer(
            dim=256,
            depth=12,
            stereo=True,
            num_stems=4,
            time_transformer_depth=1,
            freq_transformer_depth=1,
            heads=8,
            dim_head=32,
            attn_dropout=0.0,
            ff_dropout=0.0,
            flash_attn=False,
            stft_n_fft=2048,
            stft_hop_length=512,
            stft_win_length=2048,
        ).eval()
        return model


def overlap_add_separate(
    data: np.ndarray,
    sample_rate: int,
    model,
    device: str,
    quality: str = "balanced",
) -> np.ndarray:
    """Sliding-window inference with 50% overlap and Hann windowing.
    Guarantees 100% boundary coverage, zero dropped tail samples, and seamless reconstruction.
    Returns: np.ndarray of shape (num_stems, len(data), 2)
    """
    chunk_len = sample_rate * (11 if quality == "careful" else 8)
    total_len = len(data)
    num_stems = 4

    # 1. Short audio case: single inference with zero-pad to chunk_len
    if total_len <= chunk_len:
        pad_amount = chunk_len - total_len
        padded_in = np.pad(data, ((0, pad_amount), (0, 0)))
        with torch.inference_mode():
            tensor = torch.from_numpy(padded_in.T).unsqueeze(0).to(device)
            pred = model(tensor)  # (1, num_stems, 2, chunk_len)
            pred_np = pred.squeeze(0).cpu().numpy().transpose(0, 2, 1)  # (num_stems, chunk_len, 2)
        return pred_np[:, :total_len, :]

    # 2. Multi-window case: 50% hop with Hann window
    hop_len = chunk_len // 2
    pad_left = hop_len
    unpadded_len = pad_left + total_len
    pad_right = (hop_len - (unpadded_len % hop_len)) % hop_len + (chunk_len - hop_len)
    padded_data = np.pad(data, ((pad_left, pad_right), (0, 0)))

    padded_len = len(padded_data)
    output_acc = np.zeros((num_stems, padded_len, 2), dtype=np.float32)
    weight_acc = np.zeros(padded_len, dtype=np.float32)
    window = np.hanning(chunk_len).astype(np.float32)

    with torch.inference_mode():
        for i in range(0, padded_len - chunk_len + 1, hop_len):
            chunk = padded_data[i : i + chunk_len]
            tensor = torch.from_numpy(chunk.T).unsqueeze(0).to(device)
            pred = model(tensor)
            pred_np = pred.squeeze(0).cpu().numpy().transpose(0, 2, 1)

            output_acc[:, i : i + chunk_len, :] += pred_np * window[None, :, None]
            weight_acc[i : i + chunk_len] += window

    weight_slice = np.maximum(weight_acc[pad_left : pad_left + total_len], 1e-6)
    del weight_acc
    del padded_data

    # Normalización in-place para ahorrar memoria RAM y evitar duplicar tensores de 1+ GB (F11)
    output_acc[:, pad_left : pad_left + total_len, :] /= weight_slice[None, :, None]
    final_stems = output_acc[:, pad_left : pad_left + total_len, :]
    return final_stems


def separate_bs_roformer(
    input_path: Path,
    output: Path,
    device: str = "cpu",
    quality: str = "balanced",
    variant: str = "bs_roformer",
    hierarchical_plan: dict = None,
) -> dict:
    """Run Band-Split RoFormer separation if trained checkpoint exists, or fallback transparently to Demucs."""
    torch.set_num_threads(max(1, int(os.environ.get("ROFORMER_THREADS", "2"))))
    torch.manual_seed(0)
    np.random.seed(0)

    # 1. Load Audio universally (WAV, MP3, M4A, etc.)
    data, sample_rate = load_audio(input_path)
    duration = len(data) / sample_rate

    output.mkdir(parents=True, exist_ok=True)

    checkpoint_path = os.environ.get("BS_ROFORMER_CHECKPOINT")
    stems_names = ["vocals", "drums", "bass", "other"]

    # 2. Check if explicit checkpoint weights exist on disk
    if checkpoint_path and Path(checkpoint_path).exists():
        model = get_roformer_model(variant)
        ckpt = torch.load(checkpoint_path, map_location=device)
        state_dict = ckpt.get("state_dict", ckpt)
        model.load_state_dict(state_dict)
        model.to(device)

        final_stems = overlap_add_separate(data, sample_rate, model, device, quality)
        stems_data = {stem_name: final_stems[idx] for idx, stem_name in enumerate(stems_names)}

        sources = []
        input_ac = data.astype("float64") - data.mean(axis=0)
        input_rms = float(np.sqrt(np.mean(input_ac ** 2)))
        gain = 0.98

        for stem_name, audio in stems_data.items():
            ac = audio.astype("float64") - audio.mean(axis=0)
            rms = float(np.sqrt(np.mean(ac ** 2)))
            filename = f"{stem_name}.wav"
            sf.write(output / filename, audio * gain, sample_rate, subtype="PCM_16")
            sources.append({
                "id": f"bs_roformer-{stem_name}",
                "kind": stem_name,
                "label": LABELS.get(stem_name, stem_name.capitalize()),
                "file": filename,
                "confidence": 0,
                "rms": rms,
                "transcriptionEligible": rms >= input_rms * gain * 0.03,
                "level": 1,
            })

        if hierarchical_plan and hierarchical_plan.get("subExtractionsPlanned"):
            try:
                from hierarchical_subseparator import apply_hierarchical_subseparation
                sub_sources = apply_hierarchical_subseparation(output, hierarchical_plan["subExtractionsPlanned"])
                if sub_sources:
                    sources.extend(sub_sources)
            except Exception as e:
                sys.stderr.write(f"Aviso: Sub-separación Nivel 2 omitida: {e}\n")

        return {
            "model": "bs_roformer",
            "checkpoint": Path(checkpoint_path).name,
            "durationSeconds": duration,
            "gain": gain,
            "sources": sources,
            "warnings": [
                f"BS-RoFormer: Aislamiento acústico activo con checkpoint {Path(checkpoint_path).name}.",
                "Reconstrucción matemática Overlap-Add al 50% con ventana Hann sin pérdida de cola.",
            ],
        }

    # 3. Fallback to Demucs v4 (htdemucs_6s) with honest reporting
    from separate import separate as demucs_separate
    demucs_res = demucs_separate(input_path, output, "htdemucs_6s", device, quality, hierarchical_plan)
    demucs_res["model"] = "htdemucs_6s"
    demucs_res["warnings"] = [
        "Aviso de Motor: BS-RoFormer no tiene checkpoint entrenado configurado (BS_ROFORMER_CHECKPOINT no encontrado).",
        "Se ejecutó Demucs v4 (htdemucs_6s) como motor acústico activo con 6 fuentes.",
    ] + demucs_res.get("warnings", [])
    return demucs_res


def separate_ensemble(
    input_path: Path,
    output: Path,
    device: str = "cpu",
    quality: str = "careful",
    hierarchical_plan: dict = None,
) -> dict:
    """Ensemble separation combining BS-RoFormer and Demucs when both models are available."""
    checkpoint_path = os.environ.get("BS_ROFORMER_CHECKPOINT")
    from separate import separate as demucs_separate

    # If no RoFormer checkpoint, truthfully run Demucs without claiming fake ensemble
    if not checkpoint_path or not Path(checkpoint_path).exists():
        demucs_res = demucs_separate(input_path, output, "htdemucs_6s", device, quality, hierarchical_plan)
        demucs_res["model"] = "htdemucs_6s"
        demucs_res["warnings"] = [
            "Aviso de Ensamble: Ensamble multi-modelo no disponible sin checkpoint entrenado de BS-RoFormer.",
            "Se ejecutó Demucs v4 (htdemucs_6s) directamente.",
        ] + demucs_res.get("warnings", [])
        return demucs_res

    # When both are present, run RoFormer for 4-stems and Demucs for piano/guitar
    roformer_res = separate_bs_roformer(input_path, output, device, quality, "bs_roformer")
    demucs_res = demucs_separate(input_path, output, "htdemucs_6s", device, quality)

    # Combine: keep vocals/drums/bass from RoFormer, piano/guitar from Demucs 6s
    demucs_extra = [s for s in demucs_res.get("sources", []) if s["kind"] in ("piano", "guitar")]
    combined_sources = roformer_res.get("sources", []) + demucs_extra

    return {
        "model": "iatpe_ensemble",
        "durationSeconds": roformer_res.get("durationSeconds", demucs_res.get("durationSeconds")),
        "gain": roformer_res.get("gain", 0.98),
        "sources": combined_sources,
        "warnings": [
            "Ensamble IATPE Activo: Fusión híbrida de BS-RoFormer (vocales/base) y Demucs v4 (piano/guitarra).",
        ],
    }
