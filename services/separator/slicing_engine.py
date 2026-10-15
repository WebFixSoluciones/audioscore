"""
Dynamic Slicing Engine for AudioScore AI v0.03 (Delivery 1 & 2).
Guarantees zero lost samples under identity transformation (including extremes,
quiet passages, and reverb tails) using complementary raised-cosine crossfades
and context-padded inference windows.
"""
from typing import List, Tuple, Dict, Callable, Optional, Any
import time
import numpy as np


def detect_active_intervals(
    data: np.ndarray,
    sr: int,
    frame_sec: float = 0.25,
    threshold_ratio: float = 0.008,
    abs_floor_db: float = -62.0,
    pad_start_sec: float = 0.5,
    pad_end_sec: float = 0.8,
    min_gap_sec: float = 1.5,
) -> List[Tuple[float, float]]:
    """
    Detects continuous active time intervals [start_sec, end_sec] across all channels
    (preserving stereo out-of-phase content, pianissimo passages, and reverb tails).
    """
    total_samples = len(data)
    if total_samples == 0 or sr <= 0:
        return []
    total_duration = total_samples / sr
    if total_duration <= 4.0:
        return [(0.0, total_duration)]

    frame_len = max(64, int(frame_sec * sr))
    hop_len = max(32, frame_len // 2)
    if total_samples <= frame_len:
        return [(0.0, total_duration)]

    num_frames = (total_samples - frame_len) // hop_len + 1
    # Multi-channel energy (avoids L = -R cancellation from mono averaging)
    rms_values = np.empty(num_frames, dtype=np.float64)
    for i in range(num_frames):
        start = i * hop_len
        frame = data[start : start + frame_len]
        rms_values[i] = float(np.sqrt(np.mean(frame.astype(np.float64) ** 2)))

    max_rms = float(np.max(rms_values)) if num_frames > 0 else 0.0
    abs_floor = 10.0 ** (abs_floor_db / 20.0)
    if max_rms < abs_floor:
        return [(0.0, total_duration)]

    # Conservative threshold with hysteresis to preserve quiet passages and reverb tails
    onset_threshold = max(abs_floor, max_rms * threshold_ratio)
    release_threshold = onset_threshold * 0.5

    raw_intervals: List[Tuple[float, float]] = []
    in_active = False
    start_sec = 0.0

    for i, rms in enumerate(rms_values):
        t = (i * hop_len) / sr
        if not in_active and rms >= onset_threshold:
            in_active = True
            start_sec = max(0.0, t - pad_start_sec)
        elif in_active and rms < release_threshold:
            in_active = False
            end_sec = min(total_duration, t + frame_sec + pad_end_sec)
            raw_intervals.append((start_sec, end_sec))

    if in_active:
        raw_intervals.append((start_sec, total_duration))

    if not raw_intervals:
        return [(0.0, total_duration)]

    # Merge nearby intervals within min_gap_sec
    merged: List[Tuple[float, float]] = []
    curr_start, curr_end = raw_intervals[0]
    for next_start, next_end in raw_intervals[1:]:
        if next_start <= curr_end + min_gap_sec:
            curr_end = max(curr_end, next_end)
        else:
            merged.append((curr_start, curr_end))
            curr_start, curr_end = next_start, next_end
    merged.append((curr_start, curr_end))

    # Snap extremes near track boundaries so start/end samples are never clipped
    if merged[0][0] < pad_start_sec * 1.5:
        merged[0] = (0.0, merged[0][1])
    if total_duration - merged[-1][1] < pad_end_sec * 1.5:
        merged[-1] = (merged[-1][0], total_duration)

    return merged


def apply_dynamic_slicing(
    data: np.ndarray,
    sr: int,
    separate_fn: Callable[[np.ndarray, int], Dict[str, np.ndarray]],
    active_intervals: Optional[List[Tuple[float, float]]] = None,
    context_sec: float = 0.5,
    return_telemetry: bool = False,
) -> Any:
    """
    Executes separation on active intervals with a 500 ms Hann context window,
    maintaining unity gain (1.0) inside each active interval and complementary
    (1.0 - weight) bypass in ultra-quiet gaps so zero samples are lost at extremes,
    quiet passages, or tails.
    """
    t0 = time.perf_counter()
    total_samples = len(data)
    channels = data.shape[1] if data.ndim > 1 else 1
    total_duration = total_samples / sr if sr > 0 else 0.0

    if active_intervals is None:
        active_intervals = detect_active_intervals(data, sr)

    active_sec = sum(max(0.0, end - start) for start, end in active_intervals)
    coverage_ratio = (active_sec / total_duration) if total_duration > 0 else 1.0

    # When active content covers >= 75% of track (or single span >= 60%), run full pass
    if coverage_ratio >= 0.75 or (len(active_intervals) <= 1 and coverage_ratio >= 0.60):
        stems_map = separate_fn(data, sr)
        telemetry = {
            "mode": "full_pass",
            "totalDurationSeconds": round(total_duration, 4),
            "effectiveInferredSeconds": round(total_duration, 4),
            "coverageRatio": 1.0,
            "intervalsCount": 1,
            "intervals": [(0.0, round(total_duration, 4))],
            "slicingWallMs": round((time.perf_counter() - t0) * 1000.0, 2),
        }
        return (stems_map, telemetry) if return_telemetry else stems_map

    context_samples = max(16, int(context_sec * sr))
    accumulated_stems: Dict[str, np.ndarray] = {}
    weight_sum = np.zeros(total_samples, dtype=np.float64)
    inferred_samples = 0
    executed_intervals: List[Tuple[float, float]] = []

    for start_sec, end_sec in active_intervals:
        core_start = max(0, int(round(start_sec * sr)))
        core_end = min(total_samples, int(round(end_sec * sr)))
        if core_end <= core_start:
            continue

        ctx_start = max(0, core_start - context_samples)
        ctx_end = min(total_samples, core_end + context_samples)
        slice_data = data[ctx_start:ctx_end]
        slice_len = len(slice_data)
        if slice_len == 0:
            continue

        inferred_samples += slice_len
        executed_intervals.append((round(ctx_start / sr, 4), round(ctx_end / sr, 4)))
        slice_result = separate_fn(slice_data, sr)

        # Build plateau window: 1.0 over [core_start, core_end], raised-cosine ramps in context margins
        win = np.ones(slice_len, dtype=np.float64)
        lead_in = core_start - ctx_start
        lead_out = ctx_end - core_end

        if lead_in > 0:
            ramp_in = np.sin(np.linspace(0.0, np.pi / 2.0, lead_in, endpoint=False)) ** 2
            win[:lead_in] = ramp_in
        if lead_out > 0:
            ramp_out = np.cos(np.linspace(0.0, np.pi / 2.0, lead_out, endpoint=False)) ** 2
            win[slice_len - lead_out :] = ramp_out

        weight_sum[ctx_start:ctx_end] += win

        for stem_name, stem_audio in slice_result.items():
            if stem_name not in accumulated_stems:
                accumulated_stems[stem_name] = np.zeros(
                    (total_samples, channels) if data.ndim > 1 else (total_samples,),
                    dtype=np.float64,
                )
            if stem_audio.ndim > 1:
                accumulated_stems[stem_name][ctx_start:ctx_end] += stem_audio[:slice_len].astype(np.float64) * win[:, None]
            else:
                accumulated_stems[stem_name][ctx_start:ctx_end] += stem_audio[:slice_len].astype(np.float64) * win

    if not accumulated_stems:
        stems_map = separate_fn(data, sr)
        return (stems_map, {"mode": "fallback_full"}) if return_telemetry else stems_map

    # Normalize overlapping regions where weight_sum > 1.0 and preserve ambient/tail samples where weight_sum < 1.0
    over_mask = weight_sum > 1.0
    under_mask = weight_sum < 1.0 - 1e-9
    complement_weight = np.clip(1.0 - weight_sum, 0.0, 1.0)

    # Identify residual/recipient stem for un-inferred ultra-quiet regions so identity & total sum lose 0 samples
    residual_target = "other" if "other" in accumulated_stems else next(iter(accumulated_stems.keys()))

    final_stems: Dict[str, np.ndarray] = {}
    for stem_name, buf in accumulated_stems.items():
        if np.any(over_mask):
            if buf.ndim > 1:
                buf[over_mask] /= weight_sum[over_mask][:, None]
            else:
                buf[over_mask] /= weight_sum[over_mask]
        if stem_name == residual_target and np.any(under_mask):
            if buf.ndim > 1:
                buf[under_mask] += data[under_mask].astype(np.float64) * complement_weight[under_mask][:, None]
            else:
                buf[under_mask] += data[under_mask].astype(np.float64) * complement_weight[under_mask]
        final_stems[stem_name] = buf.astype(np.float32)

    telemetry = {
        "mode": "sliced",
        "totalDurationSeconds": round(total_duration, 4),
        "effectiveInferredSeconds": round(inferred_samples / sr, 4),
        "coverageRatio": round((inferred_samples / total_samples) if total_samples > 0 else 1.0, 4),
        "intervalsCount": len(executed_intervals),
        "intervals": executed_intervals,
        "slicingWallMs": round((time.perf_counter() - t0) * 1000.0, 2),
    }
    return (final_stems, telemetry) if return_telemetry else final_stems
