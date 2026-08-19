"""Pitched-note map via pYIN. Segments are 'the phrase hits A, then C', not equal slices."""

from __future__ import annotations

import librosa
import numpy as np

from resample.audio import to_mono
from resample.theory import PITCH_CLASSES


def detect_notes(
    audio: np.ndarray,
    sample_rate: int,
    *,
    hop: int = 256,
    change_cents: float = 70.0,
    min_dur: float = 0.07,
) -> dict:
    """Find held pitches and the times they change.

    This is the map Simpler does not give you: not equal slices, but
    'the phrase hits A, then C, then E, then A again'.
    """
    mono = to_mono(audio).astype(np.float32)
    if mono.size < sample_rate // 8:
        return {"notes": [], "unique": []}

    # Cap work on long files — first 24s is enough for a chop map.
    max_n = int(24 * sample_rate)
    if mono.size > max_n:
        mono = mono[:max_n]

    f0, voiced, _ = librosa.pyin(
        mono,
        sr=sample_rate,
        hop_length=hop,
        fmin=float(librosa.note_to_hz("C1")),
        fmax=float(librosa.note_to_hz("C7")),
    )
    midi = librosa.hz_to_midi(f0)
    times = librosa.times_like(f0, sr=sample_rate, hop_length=hop)
    voiced = np.asarray(voiced, dtype=bool)

    raw: list[dict] = []
    start_i: int | None = None
    frames: list[float] = []

    def flush(end_i: int) -> None:
        if start_i is None or not frames:
            return
        dur = float(times[min(end_i, len(times) - 1)] - times[start_i])
        if dur < min_dur:
            return
        med = float(np.median(frames))
        pc = int(round(med)) % 12
        raw.append(
            {
                "start": round(float(times[start_i]), 3),
                "end": round(float(times[min(end_i, len(times) - 1)]), 3),
                "midi": round(med, 2),
                "name": f"{PITCH_CLASSES[pc]}{int(med // 12) - 1}",
                "pc": PITCH_CLASSES[pc],
            }
        )

    for i, (m, v) in enumerate(zip(midi, voiced)):
        ok = bool(v) and np.isfinite(m)
        if not ok:
            flush(i)
            start_i = None
            frames = []
            continue
        if start_i is None:
            start_i = i
            frames = [float(m)]
            continue
        center = float(np.median(frames))
        if abs(float(m) - center) * 100.0 > change_cents:
            flush(i)
            start_i = i
            frames = [float(m)]
        else:
            frames.append(float(m))
    flush(len(midi) - 1)

    notes = _drop_quiet_starts(mono, sample_rate, _merge_same_pitch(raw))
    unique: list[str] = []
    for note in notes:
        if note["pc"] not in unique:
            unique.append(note["pc"])
    for i, note in enumerate(notes):
        note["i"] = i
    return {"notes": notes, "unique": unique, "count": len(notes)}


def _merge_same_pitch(notes: list[dict], gap: float = 0.06) -> list[dict]:
    if not notes:
        return []
    out = [dict(notes[0])]
    for note in notes[1:]:
        prev = out[-1]
        same = abs(note["midi"] - prev["midi"]) < 0.6
        close = note["start"] - prev["end"] <= gap
        if same and close:
            prev["end"] = note["end"]
            prev["midi"] = round((prev["midi"] + note["midi"]) / 2, 2)
            prev["name"] = note["name"]
        else:
            out.append(dict(note))
    return out


def _drop_quiet_starts(
    mono: np.ndarray,
    sample_rate: int,
    notes: list[dict],
    *,
    start_ms: float = 50.0,
    floor_db: float = -28.0,
) -> list[dict]:
    """Keep a note if its start-window RMS is loud enough vs the clip peak.

    Peak-of-start lets reverb/hiss through (a −25 dB spike in a −36 dB gap).
    Tails after a loud attack are kept.
    """
    if not notes or mono.size == 0:
        return []
    peak = float(np.max(np.abs(mono)))
    if peak < 1e-9:
        return []
    floor = peak * (10.0 ** (floor_db / 20.0))
    win = max(int(sample_rate * start_ms / 1000.0), 1)
    kept: list[dict] = []
    for note in notes:
        a = int(round(float(note["start"]) * sample_rate))
        b = int(round(float(note["end"]) * sample_rate))
        a = max(0, min(a, mono.size - 1))
        b = max(a + 1, min(b, mono.size))
        head = mono[a : min(a + win, b)]
        if not head.size:
            continue
        start_rms = float(np.sqrt(np.mean(np.square(head))))
        if start_rms >= floor:
            kept.append(note)
    return kept
