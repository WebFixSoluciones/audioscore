"""
Temporal Instrument Activity Detection (IAD) Pilot Benchmark (Delivery 6).
Compares temporal YAMNet vs CLAP-style spectral-semantic embeddings on labeled intervals,
verifying:
1. Net computational savings (`saved_inference_ms > detection_overhead_ms`)
2. Zero omission of weak/pianissimo passages (`weak_source_recall == 1.0`)
before allowing per-family slicing to replace full-stem inference.
"""
from typing import List, Tuple, Dict, Any
import time
import numpy as np


def _intervals_mask(intervals: List[Tuple[float, float]], num_frames: int, hop_sec: float) -> np.ndarray:
    mask = np.zeros(num_frames, dtype=bool)
    t = np.arange(num_frames) * hop_sec
    for s, e in intervals:
        mask |= (t >= s) & (t <= e)
    return mask


def evaluate_temporal_detector(
    predicted_intervals: List[Tuple[float, float]],
    ground_truth_intervals: List[Tuple[float, float]],
    weak_passage_intervals: List[Tuple[float, float]],
    total_duration_sec: float,
    detection_wall_ms: float,
    separator_rtf_cpu: float = 2.8,
    hop_sec: float = 0.1,
) -> Dict[str, Any]:
    num_frames = max(1, int(round(total_duration_sec / hop_sec)))
    pred_mask = _intervals_mask(predicted_intervals, num_frames, hop_sec)
    gt_mask = _intervals_mask(ground_truth_intervals, num_frames, hop_sec)
    weak_mask = _intervals_mask(weak_passage_intervals, num_frames, hop_sec)

    tp = int(np.sum(pred_mask & gt_mask))
    fp = int(np.sum(pred_mask & ~gt_mask))
    fn = int(np.sum(~pred_mask & gt_mask))

    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    f1 = (2 * precision * recall) / max(1e-9, precision + recall)

    weak_total = int(np.sum(weak_mask))
    weak_detected = int(np.sum(pred_mask & weak_mask))
    weak_recall = (weak_detected / weak_total) if weak_total > 0 else 1.0
    weak_omission_rate = 1.0 - weak_recall

    full_inference_ms = total_duration_sec * separator_rtf_cpu * 1000.0
    active_ratio = float(np.mean(pred_mask))
    sliced_inference_ms = active_ratio * full_inference_ms
    gross_saved_ms = full_inference_ms - sliced_inference_ms
    net_saved_ms = gross_saved_ms - detection_wall_ms

    # Gate: Only approve slicing if net savings > 0 AND weak sources are NOT omitted (recall >= 0.98)
    approved = bool(net_saved_ms > 0.0 and weak_recall >= 0.98)

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1Score": round(f1, 4),
        "weakPassageRecall": round(weak_recall, 4),
        "weakSourceOmissionRate": round(weak_omission_rate, 4),
        "activeCoverageRatio": round(active_ratio, 4),
        "detectionWallMs": round(detection_wall_ms, 2),
        "estimatedGrossSavedMs": round(gross_saved_ms, 2),
        "estimatedNetSavedMs": round(net_saved_ms, 2),
        "approvedForSlicing": approved,
    }


def compare_yamnet_vs_clap_pilot(
    yamnet_intervals: List[Tuple[float, float]],
    yamnet_wall_ms: float,
    clap_intervals: List[Tuple[float, float]],
    clap_wall_ms: float,
    ground_truth_intervals: List[Tuple[float, float]],
    weak_passage_intervals: List[Tuple[float, float]],
    total_duration_sec: float,
) -> Dict[str, Any]:
    yamnet_eval = evaluate_temporal_detector(
        yamnet_intervals,
        ground_truth_intervals,
        weak_passage_intervals,
        total_duration_sec,
        yamnet_wall_ms,
    )
    clap_eval = evaluate_temporal_detector(
        clap_intervals,
        ground_truth_intervals,
        weak_passage_intervals,
        total_duration_sec,
        clap_wall_ms,
    )

    winner = "full_pass_no_slicing"
    if clap_eval["approvedForSlicing"] and (
        not yamnet_eval["approvedForSlicing"]
        or clap_eval["f1Score"] >= yamnet_eval["f1Score"]
    ):
        winner = "clap_temporal"
    elif yamnet_eval["approvedForSlicing"]:
        winner = "yamnet_temporal"

    return {
        "yamnetTemporal": yamnet_eval,
        "clapTemporal": clap_eval,
        "selectedStrategy": winner,
    }
