import numpy as np

from tests.synth import sine
from resample.chop import apply_gate, slice_grid, stutter_slices
from resample.recipes import pattern_by_name
from resample.theory import bars_to_samples, resolution_beats


def test_gate_kills_off_steps() -> None:
    sr = 22050
    bpm = 120.0
    n = bars_to_samples(1, bpm, sr)
    audio = np.ones((1, n), dtype=np.float32) * 0.5
    pattern = pattern_by_name("sixteenth_pump")
    out = apply_gate(audio, pattern, bpm, sr)[0]
    step = int(round(resolution_beats(pattern.resolution) * 60.0 / bpm * sr))
    on_energy = []
    off_energy = []
    for i, flag in enumerate(pattern.steps):
        chunk = out[i * step : (i + 1) * step]
        energy = float(np.mean(np.abs(chunk)))
        (on_energy if flag else off_energy).append(energy)
    assert np.mean(on_energy) > 0.2
    assert np.mean(off_energy) < 0.05


def test_grid_slice_count() -> None:
    sr = 22050
    bpm = 120.0
    audio = sine(200.0, 2.0, sr)[None, :]
    slices = slice_grid(audio, sr, bpm, "1/8")
    # 2 seconds at 120bpm = 1 bar = 8 eighths
    assert len(slices) == 8


def test_stutter_lengthens() -> None:
    slices = [np.ones((1, 10), dtype=np.float32) * i for i in range(4)]
    rng = np.random.default_rng(0)
    out = stutter_slices(slices, rng, count=1, repeats=3)
    assert len(out) == 7
