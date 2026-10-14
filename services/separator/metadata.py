"""Measured beat positions and harmonic hypotheses. No proprietary model claims."""
from pathlib import Path


def analyze(input_path: Path, tempo_mode: str = "steady", detect_bars: bool = False) -> dict:
    import librosa
    import numpy as np
    try:
        from audio_io import load_audio
        audio_data, native_sr = load_audio(input_path)
        if audio_data.ndim == 2:
            audio_data = audio_data.mean(axis=1)
        if native_sr != 22050:
            y = librosa.resample(audio_data, orig_sr=native_sr, target_sr=22050)
            sr = 22050
        else:
            y = audio_data
            sr = native_sr
    except Exception:
        y, sr = librosa.load(input_path, sr=22050, mono=True, duration=900)

    if len(y) == 0 or not np.isfinite(y).all() or np.sqrt(np.mean(y ** 2)) < 1e-6:
        raise ValueError("Audio vacío o silencioso")
    duration = len(y) / sr
    hop = 512
    # High-speed onset envelope calculation directly on signal (bypassing slow HPSS filter)
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    if tempo_mode not in ("steady", "adaptive"):
        raise ValueError("Modo de tempo desconocido")
    dynamic_bpm = None
    if tempo_mode == "adaptive":
        from scipy.ndimage import median_filter
        dynamic_bpm = librosa.feature.tempo(onset_envelope=onset, sr=sr, hop_length=hop, aggregate=None)
        dynamic_bpm = median_filter(dynamic_bpm, size=43)
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, bpm=dynamic_bpm)
    beats = librosa.frames_to_time(frames, sr=sr, hop_length=hop)
    beats = beats[(beats >= 0) & (beats < duration)]
    bpm = float(np.median(np.asarray(tempo)))
    tempo_confidence = 0.0
    if len(beats) >= 4 and 20 <= bpm <= 400:
        intervals = np.diff(beats)
        median = float(np.median(intervals))
        stability = max(0.0, 1 - float(np.median(np.abs(intervals - median))) / max(median, 1e-6))
        strength = float(np.mean(onset[frames])) / max(float(np.max(onset)), 1e-6)
        tempo_confidence = min(0.95, stability * strength)
    if tempo_confidence == 0:
        bpm, beats = 120.0, np.array([])
    downbeats, meter, meter_confidence = np.array([]), None, 0.0
    rhythm_method = "librosa beat tracking"
    if detect_bars:
        try:
            from rhythm import analyze_rhythm
            detected, downbeats, meter, meter_confidence = analyze_rhythm(input_path, duration)
            if len(detected) >= 4:
                beats = detected
                intervals = np.diff(beats)
                median = float(np.median(intervals))
                bpm = 60.0 / median
                if not 20 <= bpm <= 400:
                    bpm, beats, downbeats, meter, meter_confidence = 120.0, np.array([]), np.array([]), None, 0.0
                    tempo_confidence = 0.0
                else:
                    # Consistency is a heuristic, not a calibrated neural confidence.
                    stability = max(0.0, 1 - float(np.median(np.abs(intervals - median))) / median)
                    tempo_confidence = min(0.9, stability * 0.8)
            rhythm_method = "Beat This! final0"
        except Exception as e:
            import sys
            print(f"[Rhythm Tracker Fallback] {e}", file=sys.stderr)
            rhythm_method = "librosa beat tracking"
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop, n_fft=2048)
    spectrum = chroma.mean(axis=1)
    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    roots = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    minor_roots = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"]
    correlations = []
    for profile, names in [(major, roots), (minor, minor_roots)]:
        for root in range(12):
            corr = float(np.corrcoef(spectrum, np.roll(profile, root))[0, 1]) if spectrum.std() > 1e-6 else 0
            correlations.append((corr if np.isfinite(corr) else 0, names[root]))
    correlations.sort(reverse=True)
    key_confidence = min(0.95, max(0.0, correlations[0][0]) * max(0.0, correlations[0][0] - correlations[1][0]) * 3)
    key = correlations[0][1] if key_confidence > 0.05 else "C"
    if key_confidence <= 0.05:
        key_confidence = 0.0
    templates, labels = [], []
    for root in range(12):
        for suffix, intervals in [("", [0, 4, 7]), ("m", [0, 3, 7])]:
            template = np.zeros(12)
            template[[(root + i) % 12 for i in intervals]] = 1
            templates.append(template / np.linalg.norm(template))
            labels.append(roots[root] + suffix)
    templates = np.array(templates)
    # Beat windows describe chord hypotheses, not note events or exact voicings.
    edges = np.unique(np.concatenate(([0], beats[::2], [duration])))
    chords = []
    for start, end in zip(edges[:-1], edges[1:]):
        left = int(start * sr / hop)
        right = max(left + 1, int(end * sr / hop))
        vector = chroma[:, left:right].mean(axis=1)
        norm = float(np.linalg.norm(vector))
        rms = float(np.sqrt(np.mean(y[int(start * sr):int(end * sr)] ** 2)))
        if norm < 1e-6 or rms < 1e-5:
            continue
        scores = templates @ (vector / norm)
        order = np.argsort(scores)
        best = int(order[-1])
        confidence = min(0.95, max(0.0, float(scores[best] - scores[order[-2]])) * 5)
        label = labels[best] if confidence >= 0.12 else "N"
        if chords and chords[-1]["label"] == label:
            chords[-1]["endSeconds"] = float(end)
            chords[-1]["confidence"] = min(chords[-1]["confidence"], confidence)
        else:
            chords.append({"label": label, "startSeconds": float(start), "endSeconds": float(end), "confidence": confidence})
    return {
        "bpm": bpm, "tempoConfidence": tempo_confidence,
        "key": key, "keyConfidence": key_confidence,
        "beatTimes": [float(t) for t in beats], "chords": chords[:2000],
        "downbeatTimes": [float(t) for t in downbeats],
        "estimatedTimeSignature": meter,
        "method": "librosa onset + chroma STFT + " + rhythm_method + " + plantillas armónicas",
        "timeSignatureConfidence": meter_confidence,
    }
