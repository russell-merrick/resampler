"""Dataclasses for analysis and the offline generate job. Live UI does not use Job."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class VoiceMode(str, Enum):
    LEAD = "lead"
    PAD = "pad"


class PitchMode(str, Enum):
    OFF = "off"
    WHOLE_CLIP = "whole_clip"
    PER_SLICE = "per_slice"


class Engine(str, Enum):
    GATE = "gate"
    SLICE = "slice"


class SliceMethod(str, Enum):
    GRID = "grid"
    ONSET = "onset"


@dataclass(frozen=True)
class Analysis:
    sample_rate: int
    channels: int
    duration_sec: float
    key_root: str
    key_mode: str
    key_confidence: float
    alt_keys: list[dict[str, Any]]
    suggested_mode: VoiceMode
    onset_rate: float
    estimated_bpm: float | None

    def key_label(self) -> str:
        short = "maj" if self.key_mode == "major" else "min"
        if self.key_mode not in {"major", "minor"}:
            short = self.key_mode
        return f"{self.key_root}{short}"


@dataclass
class GatePattern:
    name: str
    steps: list[bool]
    ties: list[bool]
    resolution: str = "1/16"
    swing: float = 0.0
    attack_ms: float = 3.0
    decay_ms: float = 18.0
    sustain: float = 1.0
    release_ms: float = 12.0
    mix: float = 1.0

    def __post_init__(self) -> None:
        n = len(self.steps)
        if len(self.ties) != n:
            self.ties = [False] * n


@dataclass
class Job:
    source_name: str
    source_key_root: str
    source_key_mode: str
    target_key_root: str
    target_scale: str
    bpm: float
    bars: int
    mode: VoiceMode
    engine: Engine
    pitch_mode: PitchMode
    recipe: str
    harmony: bool = False
    mutate: float = 0.0
    pattern: GatePattern | None = None
    slice_method: SliceMethod = SliceMethod.GRID
    slice_grid: str = "1/8"
    reorder: bool = False
    stutter: bool = False
    stutter_slices: int = 1
    stutter_repeats: int = 3
    n_takes: int = 8
    seed: int = 1


@dataclass
class Take:
    seed: int
    recipe: str
    filename: str
    json_filename: str
    duration_sec: float
    key_label: str
    bpm: float
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
