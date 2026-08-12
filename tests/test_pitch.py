import numpy as np

from tests.synth import sine
from resample.pitch import PitchEngine
from resample.theory import bars_to_samples


def _peak_hz(audio: np.ndarray, sr: int) -> float:
    mono = audio if audio.ndim == 1 else np.mean(audio, axis=0)
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), 1 / sr)
    # ignore DC / rumble
    spec[:4] = 0
    return float(freqs[int(np.argmax(spec))])


def test_shift_a4_up_four_semitones() -> None:
    sr = 22050
    src = sine(440.0, 0.8, sr)
    engine = PitchEngine()
    out = engine.shift(src, sr, 4.0)
    peak = _peak_hz(out, sr)
    expected = 440.0 * (2 ** (4 / 12))
    cents = 1200 * np.log2(peak / expected)
    assert abs(cents) < 40, f"peak={peak:.2f} Hz, cents={cents:.1f}, backend={engine.backend.name}"


def test_time_fit_hits_bar_length() -> None:
    sr = 22050
    src = sine(330.0, 1.1, sr)
    target = bars_to_samples(1, 120.0, sr)
    out = PitchEngine().time_fit(src[None, :], sr, target)
    assert out.shape[-1] == target
