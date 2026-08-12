"""Offline take renderer for `resample generate`."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from resample.audio import (
    fade_edges,
    fit_length,
    peak_normalize,
    sanitize_stem,
    target_length,
    to_mono,
    write_wav,
)
from resample.chop import (
    apply_gate,
    concat_crossfade,
    mutate_pattern,
    reorder_slices,
    reverse_some,
    slice_grid,
    slice_onsets,
    stutter_slices,
)
from resample.models import Engine, Job, PitchMode, SliceMethod, Take, VoiceMode
from resample.pitch import get_engine
from resample.theory import (
    harmony_intervals,
    in_scale_intervals,
    key_label,
    transpose_between_roots,
)


def _stack_harmony(audio: np.ndarray, sample_rate: int, scale: str) -> np.ndarray:
    engine = get_engine()
    gains = [1.0, 0.52, 0.42, 0.32]
    mix = np.zeros_like(audio)
    for interval, gain in zip(harmony_intervals(scale), gains):
        layer = engine.shift(audio, sample_rate, interval, formant=True) if interval else audio
        layer = fit_length(layer, audio.shape[-1])
        mix += layer * gain
    return peak_normalize(mix, 0.89)


def _shift_slice(audio: np.ndarray, sample_rate: int, semitones: int) -> np.ndarray:
    if semitones == 0:
        return audio
    engine = get_engine()
    shifted = engine.shift(audio, sample_rate, semitones, formant=True)
    return fit_length(shifted, audio.shape[-1])


def render_take(audio: np.ndarray, sample_rate: int, job: Job, seed: int) -> tuple[np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    engine = get_engine()
    y = audio.astype(np.float32, copy=True)
    length = target_length(job.bars, job.bpm, sample_rate)
    y = engine.time_fit(y, sample_rate, length, formant=True)

    pitch_delta = 0
    if job.pitch_mode in {PitchMode.WHOLE_CLIP, PitchMode.PER_SLICE}:
        pitch_delta = transpose_between_roots(job.source_key_root, job.target_key_root)
        if pitch_delta:
            y = engine.shift(y, sample_rate, pitch_delta, formant=True)
            y = fit_length(y, length)

    if job.mode == VoiceMode.PAD and job.harmony:
        y = _stack_harmony(y, sample_rate, job.target_scale)
        y = fit_length(y, length)

    pattern = job.pattern
    if pattern is not None and job.mutate:
        pattern = mutate_pattern(pattern, rng, job.mutate)

    slice_offsets: list[int] = []
    if job.engine == Engine.GATE and pattern is not None:
        y = apply_gate(y, pattern, job.bpm, sample_rate)
    elif job.engine == Engine.SLICE:
        if job.slice_method == SliceMethod.ONSET:
            pieces = slice_onsets(y, sample_rate, to_mono(y))
        else:
            pieces = slice_grid(y, sample_rate, job.bpm, job.slice_grid)
        if job.pitch_mode == PitchMode.PER_SLICE:
            choices = in_scale_intervals(job.target_scale, -7, 12)
            pitched = []
            for slc in pieces:
                st = int(choices[int(rng.integers(0, len(choices)))])
                slice_offsets.append(st)
                pitched.append(_shift_slice(slc, sample_rate, st))
            pieces = pitched
        if job.reorder:
            pieces = reorder_slices(pieces, rng)
        if job.mode == VoiceMode.PAD:
            pieces = reverse_some(pieces, rng, chance=0.35)
        elif rng.random() < 0.18:
            pieces = reverse_some(pieces, rng, chance=0.25)
        if job.stutter:
            pieces = stutter_slices(pieces, rng, job.stutter_slices, job.stutter_repeats)
        y = concat_crossfade(pieces, sample_rate)
        y = fit_length(y, length)

    y = fade_edges(y, sample_rate, 6.0)
    y = peak_normalize(y, 0.89)
    meta = {
        "seed": seed,
        "recipe": job.recipe,
        "source": job.source_name,
        "source_key": key_label(job.source_key_root, job.source_key_mode),
        "target_key": key_label(job.target_key_root, job.target_scale),
        "scale": job.target_scale,
        "bpm": job.bpm,
        "bars": job.bars,
        "mode": job.mode.value,
        "engine": job.engine.value,
        "pitch_mode": job.pitch_mode.value,
        "pitch_delta": pitch_delta,
        "harmony": job.harmony,
        "slice_offsets": slice_offsets,
        "pattern": None
        if pattern is None
        else {
            "name": pattern.name,
            "steps": [int(s) for s in pattern.steps],
            "ties": [int(t) for t in pattern.ties],
            "resolution": pattern.resolution,
            "swing": pattern.swing,
        },
        "pitch_backend": engine.backend.name,
        "pitch_backend_license": engine.backend.license,
    }
    return y, meta


def take_stem(job: Job, seed: int) -> str:
    # Never put '#' in filenames — browsers treat it as a URL fragment (G#min → 404).
    return "_".join(
        [
            "resample",
            sanitize_stem(job.source_name),
            sanitize_stem(key_label(job.target_key_root, job.target_scale).replace("#", "s")),
            job.mode.value,
            sanitize_stem(job.recipe),
            f"{int(round(job.bpm))}bpm",
            str(seed),
        ]
    )


def export_take(audio: np.ndarray, sample_rate: int, job: Job, seed: int, out_dir: Path) -> Take:
    rendered, meta = render_take(audio, sample_rate, job, seed)
    safe = f"take_{seed}"
    pretty = take_stem(job, seed)
    wav_path = out_dir / f"{safe}.wav"
    json_path = out_dir / f"{safe}.json"
    write_wav(wav_path, rendered, sample_rate)
    meta["download_name"] = f"{pretty}.wav"
    json_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return Take(
        seed=seed,
        recipe=job.recipe,
        filename=str(wav_path),
        json_filename=str(json_path),
        duration_sec=round(rendered.shape[-1] / sample_rate, 3),
        key_label=key_label(job.target_key_root, job.target_scale),
        bpm=job.bpm,
        meta=meta,
    )


def generate_takes(audio: np.ndarray, sample_rate: int, job: Job, out_dir: str | Path) -> list[Take]:
    dest = Path(out_dir)
    dest.mkdir(parents=True, exist_ok=True)
    takes = []
    for i in range(job.n_takes):
        takes.append(export_take(audio, sample_rate, job, job.seed + i, dest))
    return takes
