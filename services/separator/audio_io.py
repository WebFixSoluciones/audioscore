"""Universal audio loader and writer for AudioScore separators.
Supports WAV, MP3, FLAC, OGG, M4A, AAC via torchaudio, soundfile, or FFmpeg pipe fallback.
"""
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
import soundfile as sf


def find_ffmpeg_executable() -> Optional[str]:
    """Find ffmpeg in PATH or standard Windows WinGet locations."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    # Check standard WinGet paths on Windows
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        winget_pattern = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        if winget_pattern.exists():
            for p in winget_pattern.glob("**/ffmpeg.exe"):
                return str(p)
    return None


def load_audio_ffmpeg(input_path: Path, target_sr: int = 44100) -> Tuple[np.ndarray, int]:
    """Fallback decoder using FFmpeg pipe to read compressed formats (M4A, AAC, etc.)."""
    ffmpeg_exe = find_ffmpeg_executable()
    if not ffmpeg_exe:
        raise RuntimeError("FFmpeg no encontrado para decodificar formato comprimido")

    cmd = [
        ffmpeg_exe,
        "-v", "error",
        "-nostdin",
        "-i", str(input_path),
        "-f", "f32le",
        "-ac", "2",
        "-ar", str(target_sr),
        "-vn",
        "-sn",
        "-"
    ]

    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg error al decodificar audio: {proc.stderr.decode('utf-8', errors='replace')}")

    raw_bytes = proc.stdout
    if len(raw_bytes) == 0:
        raise ValueError("Audio decodificado está vacío")

    samples = np.frombuffer(raw_bytes, dtype=np.float32)
    # Reshape to (num_samples, 2)
    samples = samples.reshape(-1, 2)
    return samples, target_sr


def load_audio(input_path: Path, target_sr: Optional[int] = None) -> Tuple[np.ndarray, int]:
    """Load any audio file into float32 stereo numpy array (samples, 2)."""
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Archivo de audio no encontrado: {input_path}")

    data: Optional[np.ndarray] = None
    sample_rate: int = 44100

    # 1. Try torchaudio if installed
    try:
        import torchaudio
        waveform, sr = torchaudio.load(str(input_path))
        sample_rate = sr
        # Ensure stereo (2, N)
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        elif waveform.shape[0] > 2:
            waveform = waveform[:2]
        
        # Resample if target_sr is requested and different
        if target_sr and target_sr != sample_rate:
            waveform = torchaudio.functional.resample(waveform, sample_rate, target_sr)
            sample_rate = target_sr
            
        data = waveform.numpy().T  # (N, 2)
    except Exception:
        pass

    # 2. Try soundfile
    if data is None:
        try:
            data, sample_rate = sf.read(str(input_path), dtype="float32", always_2d=True)
            if data.shape[1] == 1:
                data = np.repeat(data, 2, axis=1)
            elif data.shape[1] > 2:
                data = data[:, :2]
        except Exception:
            pass

    # 3. Fallback to FFmpeg pipe (e.g. M4A, AAC, WebM)
    if data is None:
        data, sample_rate = load_audio_ffmpeg(input_path, target_sr=target_sr or 44100)

    # If target_sr requested and different from sample_rate, resample
    if target_sr and sample_rate != target_sr:
        try:
            import torchaudio
            import torch
            t_wave = torch.from_numpy(data.T)
            t_resampled = torchaudio.functional.resample(t_wave, sample_rate, target_sr)
            data = t_resampled.numpy().T
            sample_rate = target_sr
        except Exception:
            try:
                import librosa
                data = librosa.resample(data.T, orig_sr=sample_rate, target_sr=target_sr).T
                sample_rate = target_sr
            except Exception:
                pass

    if len(data) == 0 or not np.isfinite(data).all():
        raise ValueError("Audio vacío o inválido")

    duration = len(data) / sample_rate
    if duration > 900:
        raise ValueError("El separador integrado admite hasta 15 minutos")

    return data.astype(np.float32), sample_rate
