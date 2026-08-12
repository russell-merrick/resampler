import numpy as np

from tests.synth import chord, sine
from resample.analyze import analyze_audio, estimate_key, suggest_voice_mode
from resample.models import VoiceMode


def test_c_major_triad() -> None:
    audio = chord([261.63, 329.63, 392.00], seconds=2.5)
    analysis = analyze_audio(audio[None, :], 22050)
    assert analysis.key_root == "C"
    assert analysis.key_mode == "major"
    assert analysis.key_confidence > 0.15


def test_a_minor_triad() -> None:
    audio = chord([220.00, 261.63, 329.63], seconds=2.5)
    root, mode, confidence, _ = estimate_key(audio, 22050)
    assert root == "A"
    assert mode == "minor"
    assert confidence > 0.15


def test_sustained_tone_suggests_pad() -> None:
    pad = sine(220.0, 3.0)
    fade = int(0.05 * 22050)
    pad[:fade] *= np.linspace(0, 1, fade)
    pad[-fade:] *= np.linspace(1, 0, fade)
    mode, _ = suggest_voice_mode(pad, 22050)
    assert mode == VoiceMode.PAD


def test_click_train_suggests_lead() -> None:
    sr = 22050
    y = sine(180.0, 2.0, sr, amp=0.05)
    for i in range(16):
        start = int(i * 0.12 * sr)
        y[start : start + 80] = 0.9
    mode, rate = suggest_voice_mode(y, sr)
    assert rate > 2.0
    assert mode == VoiceMode.LEAD
