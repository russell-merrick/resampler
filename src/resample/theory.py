"""Scales, interval math, and Splice-style key tags in filenames (_Am, _D#m)."""

from __future__ import annotations

import re
from pathlib import Path

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_ENHARMONIC = {
    "DB": "C#",
    "EB": "D#",
    "GB": "F#",
    "AB": "G#",
    "BB": "A#",
    "CB": "B",
    "FB": "E",
    "E#": "F",
    "B#": "C",
}

SCALES: dict[str, list[int]] = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "pentatonic": [0, 2, 4, 7, 9],
    "minor_pentatonic": [0, 3, 5, 7, 10],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
}

# Krumhansl-Schmuckler / Krumhansl-Kessler key profiles (C major / C minor).
MAJOR_PROFILE = [
    6.35,
    2.23,
    3.48,
    2.33,
    4.38,
    4.09,
    2.52,
    5.19,
    2.39,
    3.66,
    2.29,
    2.88,
]
MINOR_PROFILE = [
    6.33,
    2.68,
    3.52,
    5.38,
    2.60,
    3.53,
    2.54,
    4.75,
    3.98,
    2.69,
    3.34,
    3.17,
]

_SCALE_ALIASES = {
    "maj": "major",
    "major": "major",
    "ionian": "major",
    "min": "minor",
    "minor": "minor",
    "aeolian": "minor",
    "dor": "dorian",
    "dorian": "dorian",
    "mix": "mixolydian",
    "mixolydian": "mixolydian",
    "pent": "pentatonic",
    "pentatonic": "pentatonic",
    "minpent": "minor_pentatonic",
    "minor_pentatonic": "minor_pentatonic",
    "harmmin": "harmonic_minor",
    "harmonic_minor": "harmonic_minor",
    "harmonic-minor": "harmonic_minor",
}


def normalize_root(root: str) -> str:
    token = root.strip().upper().replace("♯", "#").replace("♭", "B")
    token = token.replace(" ", "")
    if token in _ENHARMONIC:
        token = _ENHARMONIC[token]
    if len(token) >= 2 and token[1] == "B" and token[0] in "ACDFG":
        token = _ENHARMONIC.get(token, token)
    if token not in PITCH_CLASSES:
        raise ValueError(f"Unknown pitch class: {root}")
    return token


def normalize_scale(scale: str) -> str:
    key = scale.strip().lower().replace(" ", "_")
    if key not in _SCALE_ALIASES:
        raise ValueError(f"Unknown scale: {scale}")
    return _SCALE_ALIASES[key]


def parse_key(text: str) -> tuple[str, str]:
    raw = text.strip()
    if not raw:
        raise ValueError("Empty key")
    if ":" in raw:
        root, scale = raw.split(":", 1)
        return normalize_root(root), normalize_scale(scale)
    parts = raw.replace("-", " ").split()
    if len(parts) >= 2:
        return normalize_root(parts[0]), normalize_scale(parts[1])
    compact = raw.replace(" ", "")
    for suffix, scale in (
        ("min", "minor"),
        ("maj", "major"),
        ("m", "minor"),
    ):
        if compact.lower().endswith(suffix) and len(compact) > len(suffix):
            return normalize_root(compact[: -len(suffix)]), scale
    return normalize_root(compact), "major"


_FILENAME_KEY = re.compile(
    r"(?:^|[^A-Za-z])"
    r"([A-G](?:#|b|♯|♭)?)"
    r"[-_ ]?"
    r"(min(?:or)?|maj(?:or)?|m)"
    r"(?=$|[^a-zA-Z])",
    re.IGNORECASE,
)

_MODE_FROM_TAG = {
    "m": "minor",
    "min": "minor",
    "minor": "minor",
    "maj": "major",
    "major": "major",
}


def key_from_filename(name: str) -> tuple[str, str] | None:
    """Read Splice-style tags like _Am, _D#m, _Fmaj, wet_Amin.wav. Last tag wins."""
    stem = Path(name).stem
    hits = list(_FILENAME_KEY.finditer(stem))
    if not hits:
        return None
    root_raw, mode_raw = hits[-1].group(1), hits[-1].group(2).lower()
    try:
        return normalize_root(root_raw), _MODE_FROM_TAG.get(mode_raw, "minor")
    except ValueError:
        return None


def pc_index(root: str) -> int:
    return PITCH_CLASSES.index(normalize_root(root))


def key_label(root: str, scale: str) -> str:
    scale = normalize_scale(scale)
    short = {"major": "maj", "minor": "min"}.get(scale, scale)
    return f"{normalize_root(root)}{short}"


def scale_degrees(root: str, scale: str) -> list[int]:
    tonic = pc_index(root)
    return [(tonic + step) % 12 for step in SCALES[normalize_scale(scale)]]


def rotate(values: list[float], n: int) -> list[float]:
    n = n % len(values)
    return values[-n:] + values[:-n] if n else list(values)


def transpose_between_roots(src_root: str, dst_root: str) -> int:
    delta = (pc_index(dst_root) - pc_index(src_root)) % 12
    if delta > 6:
        delta -= 12
    return delta


def in_scale_intervals(scale: str, min_st: int = -12, max_st: int = 12) -> list[int]:
    degrees = set(SCALES[normalize_scale(scale)])
    return [st for st in range(min_st, max_st + 1) if (st % 12) in degrees]


def nearest_scale_interval(semitones: int, scale: str) -> int:
    options = in_scale_intervals(scale, semitones - 6, semitones + 6)
    if not options:
        options = in_scale_intervals(scale)
    return min(options, key=lambda st: (abs(st - semitones), abs(st)))


def third_interval(scale: str) -> int:
    return 3 if normalize_scale(scale) in {"minor", "dorian", "harmonic_minor", "minor_pentatonic"} else 4


def harmony_intervals(scale: str) -> list[int]:
    third = third_interval(scale)
    return [0, third, 7, 12]


def bars_to_samples(bars: int, bpm: float, sample_rate: int) -> int:
    seconds = bars * 4.0 * (60.0 / bpm)
    return int(round(seconds * sample_rate))


def resolution_beats(resolution: str) -> float:
    table = {
        "1/4": 1.0,
        "1/8": 0.5,
        "1/8t": 1.0 / 3.0,
        "1/16": 0.25,
        "1/16t": 1.0 / 6.0,
        "1/32": 0.125,
    }
    if resolution not in table:
        raise ValueError(f"Unknown resolution: {resolution}")
    return table[resolution]
