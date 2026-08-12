import numpy as np

from tests.synth import sine
from resample.notes import detect_notes


def test_detects_two_sung_notes() -> None:
    sr = 22050
    a = sine(440.0, 0.9, sr)
    c = sine(523.25, 0.9, sr)
    audio = np.concatenate([a, c])
    found = detect_notes(audio, sr)
    pcs = [n["pc"] for n in found["notes"]]
    assert found["count"] >= 2
    assert "A" in pcs
    assert "C" in pcs
