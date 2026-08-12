"""Load/save WAV, channel layout, fades, Ableton-friendly filenames."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from resample.theory import bars_to_samples


def load_audio(path: str | Path) -> tuple[np.ndarray, int]:
    """Load audio as float32 (channels, samples)."""
    data, sample_rate = sf.read(str(path), always_2d=True, dtype="float32")
    audio = np.ascontiguousarray(data.T)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak
    return audio, int(sample_rate)


def to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio.astype(np.float32, copy=False)
    if audio.shape[0] == 1:
        return audio[0]
    return np.mean(audio, axis=0).astype(np.float32)


def peak_normalize(audio: np.ndarray, peak: float = 0.89) -> np.ndarray:
    current = float(np.max(np.abs(audio))) if audio.size else 0.0
    if current < 1e-9:
        return audio
    return (audio * (peak / current)).astype(np.float32)


def fit_length(audio: np.ndarray, length: int) -> np.ndarray:
    if audio.shape[-1] == length:
        return audio
    if audio.shape[-1] > length:
        return audio[..., :length]
    pad = length - audio.shape[-1]
    return np.pad(audio, ((0, 0), (0, pad)) if audio.ndim == 2 else (0, pad))


def fade_edges(audio: np.ndarray, sample_rate: int, fade_ms: float = 8.0) -> np.ndarray:
    n = audio.shape[-1]
    fade = min(int(sample_rate * fade_ms / 1000.0), max(n // 8, 1))
    if fade <= 0:
        return audio
    ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
    out = audio.copy()
    out[..., :fade] *= ramp
    out[..., -fade:] *= ramp[::-1]
    return out


def write_wav(path: str | Path, audio: np.ndarray, sample_rate: int) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = audio.T if audio.ndim == 2 else audio
    sf.write(str(path), frames, sample_rate, subtype="PCM_24")


def target_length(bars: int, bpm: float, sample_rate: int) -> int:
    return bars_to_samples(bars, bpm, sample_rate)


def sanitize_stem(name: str) -> str:
    stem = Path(name).stem
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in stem)
    cleaned = cleaned.strip("_") or "vocal"
    return cleaned[:48]
