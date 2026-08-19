from pathlib import Path

import numpy as np

from resample.models import Analysis, VoiceMode
from resample.preload import analyze_cached, clear_cache


def _analysis() -> Analysis:
    return Analysis(
        sample_rate=44100,
        channels=1,
        duration_sec=1.0,
        key_root="A",
        key_mode="minor",
        key_confidence=1.0,
        alt_keys=[],
        suggested_mode=VoiceMode.PAD,
        onset_rate=0.0,
        estimated_bpm=120.0,
    )


def test_analyze_cached_runs_once(monkeypatch, tmp_path: Path) -> None:
    wav = tmp_path / "loop_Am.wav"
    wav.write_bytes(b"fake")
    calls = {"n": 0}

    def fake_analyze(path, name=None):
        calls["n"] += 1
        return np.zeros((1, 8), dtype=np.float32), _analysis()

    def fake_notes(audio, sample_rate, **_kwargs):
        return {"notes": [{"i": 0, "pc": "A"}], "unique": ["A"], "count": 1}

    monkeypatch.setattr("resample.analyze.analyze_file", fake_analyze)
    monkeypatch.setattr("resample.notes.detect_notes", fake_notes)
    clear_cache()
    a1, n1 = analyze_cached(wav, name=wav.name)
    a2, n2 = analyze_cached(wav, name=wav.name)
    assert calls["n"] == 1
    assert a1 is a2
    assert n1["count"] == n2["count"] == 1
