"""Private stdin/stdout worker. Models stay loaded between local jobs."""
import contextlib
import json
from pathlib import Path
import sys
from separate import separate
from metadata import analyze


for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        with contextlib.redirect_stdout(sys.stderr):
            if request["action"] == "metadata":
                result = analyze(Path(request["input"]), request.get("tempo", "steady"), request.get("detectBars", "true") == "true")
            elif request["action"] == "separate":
                engine = request.get("engine", "bs_roformer")
                plan = request.get("plan")
                if engine in ("bs_roformer", "mel_band_roformer"):
                    from bs_roformer_engine import separate_bs_roformer
                    result = separate_bs_roformer(Path(request["input"]), Path(request["output"]), "cpu", request.get("quality", "balanced"), engine, hierarchical_plan=plan)
                elif engine == "ensemble":
                    from bs_roformer_engine import separate_ensemble
                    result = separate_ensemble(Path(request["input"]), Path(request["output"]), "cpu", request.get("quality", "balanced"), hierarchical_plan=plan)
                else:
                    demucs_model = request.get("model", "htdemucs_6s")
                    result = separate(Path(request["input"]), Path(request["output"]), demucs_model, "cpu", request.get("quality", "balanced"), hierarchical_plan=plan)
            elif request["action"] == "notation":
                from notation import audit
                result = audit(Path(request["input"]))
            else:
                raise ValueError("Acción local desconocida")
        print(json.dumps({"id": request["id"], "result": result}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"id": request.get("id") if isinstance(request, dict) else None, "error": str(error)}, ensure_ascii=False), flush=True)
