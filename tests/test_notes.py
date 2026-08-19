import numpy as np

from tests.synth import sine
from resample.notes import _drop_quiet_starts, detect_notes


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


def test_drops_note_that_starts_quiet() -> None:
    sr = 22050
    audio = np.concatenate([sine(440.0, 0.5, sr, amp=0.4), sine(440.0, 0.5, sr, amp=0.004)])
    notes = [
        {"start": 0.0, "end": 0.5, "midi": 69, "name": "A4", "pc": "A"},
        {"start": 0.5, "end": 1.0, "midi": 69, "name": "A4", "pc": "A"},
    ]
    kept = _drop_quiet_starts(audio, sr, notes)
    assert len(kept) == 1
    assert kept[0]["start"] == 0.0


def test_keeps_loud_start_with_quiet_tail() -> None:
    sr = 22050
    audio = sine(440.0, 1.0, sr, amp=0.4)
    fade = int(0.7 * sr)
    audio[-fade:] *= np.linspace(1.0, 0.001, fade, dtype=np.float32)
    notes = [{"start": 0.0, "end": 1.0, "midi": 69, "name": "A4", "pc": "A"}]
    kept = _drop_quiet_starts(audio, sr, notes)
    assert len(kept) == 1


def test_drops_peaky_but_quiet_start() -> None:
    """Wet gaps can spike near the old peak floor while RMS stays in the noise."""
    sr = 22050
    audio = sine(440.0, 1.0, sr, amp=0.4)
    audio[sr // 2 :] *= 0.01
    audio[sr // 2] = 0.02
    notes = [
        {"start": 0.0, "end": 0.5, "midi": 69, "name": "A4", "pc": "A"},
        {"start": 0.5, "end": 1.0, "midi": 69, "name": "A4", "pc": "A"},
    ]
    kept = _drop_quiet_starts(audio, sr, notes)
    assert [n["start"] for n in kept] == [0.0]
