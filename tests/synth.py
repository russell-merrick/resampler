from __future__ import annotations

import numpy as np


def sine(freq: float, seconds: float, sr: int = 22050, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(seconds * sr), dtype=np.float32) / sr
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def chord(freqs: list[float], seconds: float = 2.0, sr: int = 22050) -> np.ndarray:
    mix = np.zeros(int(seconds * sr), dtype=np.float32)
    for freq in freqs:
        mix += sine(freq, seconds, sr, amp=0.22)
        mix += sine(freq * 2, seconds, sr, amp=0.06)
    peak = float(np.max(np.abs(mix))) or 1.0
    return (mix / peak * 0.7).astype(np.float32)
