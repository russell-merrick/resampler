"""Named offline recipes for `resample generate`. The live UI has its own pattern list."""

from __future__ import annotations

from dataclasses import dataclass

from resample.models import Engine, GatePattern, Job, PitchMode, SliceMethod, VoiceMode


def _pat(name: str, bits: str, resolution: str = "1/16", **kwargs) -> GatePattern:
    steps = [ch == "1" for ch in bits.replace(" ", "")]
    ties = [False] * len(steps)
    return GatePattern(name=name, steps=steps, ties=ties, resolution=resolution, **kwargs)


PATTERNS: dict[str, GatePattern] = {
    "sixteenth_pump": _pat("sixteenth_pump", "1010101010101010", attack_ms=2, decay_ms=12, release_ms=8),
    "offbeat": _pat("offbeat", "0101010101010101", attack_ms=2, decay_ms=14, release_ms=10),
    "anthem": _pat("anthem", "1101101011011010", attack_ms=3, decay_ms=16, release_ms=10),
    "half_time": _pat("half_time", "1000100010001000", attack_ms=4, decay_ms=30, release_ms=18),
    "triplet_gate": _pat("triplet_gate", "101101101101", resolution="1/8t", attack_ms=2, decay_ms=10, release_ms=8),
    "staccato": _pat("staccato", "1000100010101000", attack_ms=1, decay_ms=8, release_ms=6),
    "open_hats": _pat("open_hats", "1111011111110111", attack_ms=2, decay_ms=20, sustain=0.85, release_ms=14),
}


@dataclass(frozen=True)
class Recipe:
    name: str
    mode: VoiceMode
    engine: Engine
    pitch_mode: PitchMode
    bars: int
    harmony: bool
    pattern: str | None
    mutate: float
    slice_method: SliceMethod = SliceMethod.GRID
    slice_grid: str = "1/8"
    reorder: bool = False
    stutter: bool = False
    stutter_slices: int = 1
    stutter_repeats: int = 3
    description: str = ""


RECIPES: dict[str, Recipe] = {
    "trance-pad-gate": Recipe(
        name="trance-pad-gate",
        mode=VoiceMode.PAD,
        engine=Engine.GATE,
        pitch_mode=PitchMode.WHOLE_CLIP,
        bars=4,
        harmony=True,
        pattern="sixteenth_pump",
        mutate=0.12,
        description="Ooh/aah bed, stacked in key, 16th trance gate.",
    ),
    "prog-ooh-bed": Recipe(
        name="prog-ooh-bed",
        mode=VoiceMode.PAD,
        engine=Engine.GATE,
        pitch_mode=PitchMode.WHOLE_CLIP,
        bars=8,
        harmony=True,
        pattern="open_hats",
        mutate=0.08,
        description="Longer pad, wider gate, softer motion.",
    ),
    "reverse-choir": Recipe(
        name="reverse-choir",
        mode=VoiceMode.PAD,
        engine=Engine.SLICE,
        pitch_mode=PitchMode.WHOLE_CLIP,
        bars=4,
        harmony=True,
        pattern=None,
        mutate=0.0,
        slice_grid="1/4",
        reorder=True,
        description="Choir/pad sliced on quarters, some reverse, in key.",
    ),
    "ukg-chop": Recipe(
        name="ukg-chop",
        mode=VoiceMode.LEAD,
        engine=Engine.SLICE,
        pitch_mode=PitchMode.PER_SLICE,
        bars=2,
        harmony=False,
        pattern=None,
        mutate=0.15,
        slice_method=SliceMethod.GRID,
        slice_grid="1/8",
        reorder=True,
        stutter=True,
        stutter_slices=1,
        stutter_repeats=3,
        description="UK garage-style 1/8 chops, pitch jumps in key, stutters.",
    ),
    "tech-stutter": Recipe(
        name="tech-stutter",
        mode=VoiceMode.LEAD,
        engine=Engine.SLICE,
        pitch_mode=PitchMode.PER_SLICE,
        bars=2,
        harmony=False,
        pattern=None,
        mutate=0.2,
        slice_method=SliceMethod.ONSET,
        slice_grid="1/16",
        reorder=False,
        stutter=True,
        stutter_slices=1,
        stutter_repeats=5,
        description="Onset chops with tight repeats.",
    ),
}


def list_recipes() -> list[Recipe]:
    return list(RECIPES.values())


def get_recipe(name: str) -> Recipe:
    if name not in RECIPES:
        known = ", ".join(RECIPES)
        raise KeyError(f"Unknown recipe '{name}'. Try: {known}")
    return RECIPES[name]


def pattern_by_name(name: str) -> GatePattern:
    if name not in PATTERNS:
        raise KeyError(f"Unknown pattern '{name}'")
    return PATTERNS[name]


def job_from_recipe(
    recipe: Recipe,
    *,
    source_name: str,
    source_key_root: str,
    source_key_mode: str,
    target_key_root: str | None = None,
    target_scale: str | None = None,
    bpm: float = 128.0,
    bars: int | None = None,
    n_takes: int = 8,
    seed: int = 1,
    mutate: float | None = None,
) -> Job:
    pattern = pattern_by_name(recipe.pattern) if recipe.pattern else None
    return Job(
        source_name=source_name,
        source_key_root=source_key_root,
        source_key_mode=source_key_mode,
        target_key_root=target_key_root or source_key_root,
        target_scale=target_scale or source_key_mode,
        bpm=bpm,
        bars=bars if bars is not None else recipe.bars,
        mode=recipe.mode,
        engine=recipe.engine,
        pitch_mode=recipe.pitch_mode,
        recipe=recipe.name,
        harmony=recipe.harmony,
        mutate=recipe.mutate if mutate is None else mutate,
        pattern=pattern,
        slice_method=recipe.slice_method,
        slice_grid=recipe.slice_grid,
        reorder=recipe.reorder,
        stutter=recipe.stutter,
        stutter_slices=recipe.stutter_slices,
        stutter_repeats=recipe.stutter_repeats,
        n_takes=n_takes,
        seed=seed,
    )
