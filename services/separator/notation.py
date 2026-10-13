"""Independent MusicXML structure audit; it does not verify audio transcription."""
from pathlib import Path


def audit(path: Path):
    import music21
    score = music21.converter.parse(str(path), format="musicxml")
    measures = 0
    issues = []
    for part in score.parts:
        for measure in part.getElementsByClass(music21.stream.Measure):
            measures += 1
            expected = measure.barDuration.quarterLength
            actual = measure.highestTime
            if abs(float(actual - expected)) > 0.001:
                issues.append(f"{part.partName or 'Pista'} · compás {measure.number}: {actual} tiempos; se esperaban {expected}.")
    return {
        "engine": f"music21 {music21.__version__}",
        "parts": len(score.parts), "measures": measures,
        "notes": len(score.recurse().notes), "issues": issues[:100],
    }
