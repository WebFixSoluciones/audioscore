"""Pretrained beat/downbeat model. Meter confidence is a consistency heuristic."""
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def tracker():
    import torch
    torch.set_num_threads(2)
    from beat_this.inference import File2Beats
    return File2Beats(checkpoint_path="final0", device="cpu", dbn=False)


def infer_meter(beats, downbeats):
    import numpy as np
    if len(downbeats) < 4 or len(beats) < 9:
        return None, 0.0
    # Count detected quarter-note pulses between adjacent downbeats.
    # Six pulses do not distinguish 6/4 from compound 6/8, so abstain there.
    indices = []
    for downbeat in downbeats:
        index = int(np.argmin(np.abs(beats - downbeat)))
        if abs(beats[index] - downbeat) > 0.07:
            return None, 0.0
        indices.append(index)
    lengths = np.diff(indices)
    counts = {meter: int(np.sum(lengths == meter)) for meter in (3, 4)}
    meter = max(counts, key=counts.get)
    agreement = counts[meter] / len(lengths)
    if agreement < 0.8 or counts[meter] < 3:
        return None, 0.0
    return [meter, 4], min(0.9, agreement * min(1.0, counts[meter] / 6))


def analyze_rhythm(path: Path, duration: float):
    import numpy as np
    beats, downbeats = tracker()(str(path))
    beats = np.asarray(beats)
    downbeats = np.asarray(downbeats)
    beats = beats[np.isfinite(beats) & (beats >= 0) & (beats < duration)]
    downbeats = downbeats[np.isfinite(downbeats) & (downbeats >= 0) & (downbeats < duration)]
    meter, confidence = infer_meter(beats, downbeats)
    return beats, downbeats, meter, confidence
