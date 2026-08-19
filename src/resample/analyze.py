"""Key, tempo guess, and pad/lead hint. Filename tags beat chroma on Splice vocals."""

from __future__ import annotations

from pathlib import Path

import librosa
import numpy as np

from resample.audio import load_audio, to_mono
from resample.models import Analysis, VoiceMode
from resample.theory import (
    MAJOR_PROFILE,
    MINOR_PROFILE,
    PITCH_CLASSES,
    key_from_filename,
    rotate,
)


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom < 1e-12:
        return 0.0
    return float(np.dot(a, b) / denom)


def estimate_key(mono: np.ndarray, sample_rate: int) -> tuple[str, str, float, list[dict]]:
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=mono, sr=sample_rate, hop_length=hop)
    vector = chroma.mean(axis=1).astype(np.float64)
    if float(vector.sum()) < 1e-9:
        return "C", "minor", 0.0, []

    scores: list[tuple[float, str, str]] = []
    for idx, root in enumerate(PITCH_CLASSES):
        major = _pearson(vector, np.array(rotate(MAJOR_PROFILE, idx), dtype=np.float64))
        minor = _pearson(vector, np.array(rotate(MINOR_PROFILE, idx), dtype=np.float64))
        scores.append((major, root, "major"))
        scores.append((minor, root, "minor"))
    scores.sort(reverse=True)

    best, root, mode = scores[0]
    second = scores[1][0] if len(scores) > 1 else 0.0
    worst = scores[-1][0]
    spread = best - worst
    confidence = 0.0 if spread < 1e-9 else float(np.clip((best - second) / spread, 0.0, 1.0))
    # Blend in absolute correlation so a clear C triad is not "low confidence"
    # just because C major / C mixolydian-ish are close.
    confidence = float(np.clip(0.55 * confidence + 0.45 * max(best, 0.0), 0.0, 1.0))

    alt = [
        {"root": r, "mode": m, "score": round(s, 4)}
        for s, r, m in scores[1:4]
    ]
    return root, mode, confidence, alt


def estimate_bpm(mono: np.ndarray, sample_rate: int) -> float | None:
    try:
        tempo = librosa.feature.tempo(y=mono, sr=sample_rate, aggregate=np.median)
        bpm = float(np.atleast_1d(tempo)[0])
    except Exception:
        return None
    if not np.isfinite(bpm) or bpm < 60 or bpm > 200:
        return None
    return round(bpm, 2)


def suggest_voice_mode(mono: np.ndarray, sample_rate: int) -> tuple[VoiceMode, float]:
    duration = max(len(mono) / sample_rate, 1e-3)
    onsets = librosa.onset.onset_detect(
        y=mono,
        sr=sample_rate,
        units="time",
        backtrack=False,
        delta=0.2,
    )
    onset_rate = float(len(onsets) / duration)
    rms = librosa.feature.rms(y=mono, frame_length=2048, hop_length=512)[0]
    rms_std = float(np.std(rms) / (np.mean(rms) + 1e-9))
    # Stable level (oohs, held tones) is a pad even if onset_detect false-triggers.
    if rms_std < 0.4 or (onset_rate < 2.2 and rms_std < 0.85):
        return VoiceMode.PAD, onset_rate
    return VoiceMode.LEAD, onset_rate


def analyze_audio(audio: np.ndarray, sample_rate: int, name: str | None = None) -> Analysis:
    mono = to_mono(audio)
    tagged = key_from_filename(name) if name else None
    if tagged:
        root, mode = tagged
        confidence = 1.0
        alt = [{"root": root, "mode": mode, "score": 1.0, "source": "filename"}]
    else:
        root, mode, confidence, alt = estimate_key(mono, sample_rate)
    voice, onset_rate = suggest_voice_mode(mono, sample_rate)
    return Analysis(
        sample_rate=sample_rate,
        channels=int(audio.shape[0]) if audio.ndim == 2 else 1,
        duration_sec=round(audio.shape[-1] / sample_rate, 3),
        key_root=root,
        key_mode=mode,
        key_confidence=round(confidence, 3),
        alt_keys=alt,
        suggested_mode=voice,
        onset_rate=round(onset_rate, 3),
        estimated_bpm=estimate_bpm(mono, sample_rate),
    )


def analyze_file(path: str | Path, name: str | None = None) -> tuple[np.ndarray, Analysis]:
    path = Path(path)
    audio, sample_rate = load_audio(path)
    return audio, analyze_audio(audio, sample_rate, name=name or path.name)
