"""Persistent stdin/stdout worker for AudioScore AI v0.03 (Deliveries 1, 2 & 4).
Models stay warm in memory across jobs, emits incremental `stem_ready` events,
and supports cooperative job cancellation and capability inspection.
"""
import contextlib
import json
from pathlib import Path
import sys
import time
from separate import separate
from metadata import analyze


def _emit_event(job_id: str, event_type: str, payload: dict):
    msg = {"id": job_id, "event": event_type, "timestampMs": round(time.time() * 1000.0, 2), **payload}
    sys.stderr.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stderr.flush()


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    request = None
    try:
        request = json.loads(line)
        job_id = request.get("id")
        action = request.get("action")
        with contextlib.redirect_stdout(sys.stderr):
            if action == "capabilities":
                from bs_roformer_engine import ROFORMER_CAPABILITY_CONTRACT
                result = {
                    "engines": {
                        "htdemucs": {"sampleRate": 44100, "channels": 2, "stems": ["drums", "bass", "other", "vocals"]},
                        "htdemucs_6s": {"sampleRate": 44100, "channels": 2, "stems": ["drums", "bass", "other", "vocals", "guitar", "piano"]},
                        "bs_roformer": ROFORMER_CAPABILITY_CONTRACT,
                    }
                }
            elif action == "metadata":
                result = analyze(
                    Path(request["input"]),
                    request.get("tempo", "steady"),
                    str(request.get("detectBars", "true")).lower() == "true",
                )
            elif action == "separate":
                engine = request.get("engine", "htdemucs_6s")
                plan = request.get("plan")
                device = request.get("device", "cpu")
                quality = request.get("quality", "balanced")

                def _on_stem(stem_meta: dict):
                    _emit_event(job_id, "stem_ready", {"stem": stem_meta})

                if engine in ("bs_roformer", "mel_band_roformer"):
                    from bs_roformer_engine import separate_bs_roformer
                    result = separate_bs_roformer(
                        Path(request["input"]),
                        Path(request["output"]),
                        device,
                        quality,
                        engine,
                        hierarchical_plan=plan,
                        on_stem_ready=_on_stem,
                    )
                elif engine in ("ensemble", "iatpe_ensemble"):
                    from bs_roformer_engine import separate_ensemble
                    result = separate_ensemble(
                        Path(request["input"]),
                        Path(request["output"]),
                        device,
                        quality,
                        hierarchical_plan=plan,
                        on_stem_ready=_on_stem,
                    )
                else:
                    demucs_model = request.get("model", "htdemucs_6s")
                    result = separate(
                        Path(request["input"]),
                        Path(request["output"]),
                        demucs_model,
                        device,
                        quality,
                        hierarchical_plan=plan,
                        on_stem_ready=_on_stem,
                    )
            elif action == "notation":
                from notation import audit
                result = audit(Path(request["input"]))
            else:
                raise ValueError(f"Acción local desconocida: {action}")
        print(json.dumps({"id": job_id, "result": result}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(
            json.dumps(
                {"id": request.get("id") if isinstance(request, dict) else None, "error": str(error)},
                ensure_ascii=False,
            ),
            flush=True,
        )
