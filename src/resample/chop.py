"""Offline gate, grid/onset slice, stutter. Used by CLI generate, not the live UI."""

from __future__ import annotations

import numpy as np

from resample.models import GatePattern
from resample.theory import resolution_beats


def _adsr(length: int, sample_rate: int, pattern: GatePattern) -> np.ndarray:
    if length <= 0:
        return np.zeros(0, dtype=np.float32)
    attack = max(int(pattern.attack_ms * sample_rate / 1000.0), 1)
    decay = max(int(pattern.decay_ms * sample_rate / 1000.0), 1)
    release = max(int(pattern.release_ms * sample_rate / 1000.0), 1)
    total = attack + decay + release
    if total > length:
        scale = length / total
        attack = max(int(attack * scale), 1)
        release = max(int(release * scale), 1)
        decay = max(length - attack - release, 0)
    env = np.ones(length, dtype=np.float32) * float(pattern.sustain)
    env[:attack] = np.linspace(0.0, 1.0, attack, dtype=np.float32)
    if decay:
        start = 1.0
        env[attack : attack + decay] = np.linspace(start, float(pattern.sustain), decay, dtype=np.float32)
    if release:
        env[-release:] = np.linspace(float(env[-release] if release < length else pattern.sustain), 0.0, release, dtype=np.float32)
    return env


def _on_regions(steps: list[bool], ties: list[bool]) -> list[tuple[int, int]]:
    regions: list[tuple[int, int]] = []
    i = 0
    n = len(steps)
    while i < n:
        if not steps[i]:
            i += 1
            continue
        start = i
        i += 1
        while i < n and steps[i] and (ties[i - 1] or ties[i]):
            i += 1
        regions.append((start, i))
    return regions


def apply_gate(
    audio: np.ndarray,
    pattern: GatePattern,
    bpm: float,
    sample_rate: int,
) -> np.ndarray:
    n = audio.shape[-1]
    step_beats = resolution_beats(pattern.resolution)
    step_samples = max(int(round(step_beats * 60.0 / bpm * sample_rate)), 1)
    env = np.zeros(n, dtype=np.float32)
    n_steps = len(pattern.steps)
    if n_steps == 0:
        return audio

    cycle = n_steps * step_samples
    offset = 0
    while offset < n:
        for start_i, end_i in _on_regions(pattern.steps, pattern.ties):
            start = offset + start_i * step_samples
            if start_i % 2 == 1 and pattern.swing:
                start += int(pattern.swing * 0.5 * step_samples)
            end = offset + end_i * step_samples
            if end_i < n_steps and end_i % 2 == 1 and pattern.swing:
                end += int(pattern.swing * 0.5 * step_samples)
            start = max(0, start)
            end = min(n, end)
            if end <= start:
                continue
            env[start:end] = np.maximum(env[start:end], _adsr(end - start, sample_rate, pattern))
        offset += cycle

    wet = audio * env
    mix = float(np.clip(pattern.mix, 0.0, 1.0))
    return ((1.0 - mix) * audio + mix * wet).astype(np.float32)


def mutate_pattern(pattern: GatePattern, rng: np.random.Generator, amount: float) -> GatePattern:
    if amount <= 0:
        return pattern
    steps = list(pattern.steps)
    ties = list(pattern.ties)
    for i in range(len(steps)):
        if rng.random() < amount:
            steps[i] = not steps[i]
        if rng.random() < amount * 0.5:
            ties[i] = not ties[i]
    return GatePattern(
        name=f"{pattern.name}-mut",
        steps=steps,
        ties=ties,
        resolution=pattern.resolution,
        swing=float(np.clip(pattern.swing + rng.uniform(-0.05, 0.08) * amount, 0.0, 0.65)),
        attack_ms=pattern.attack_ms,
        decay_ms=pattern.decay_ms,
        sustain=pattern.sustain,
        release_ms=pattern.release_ms,
        mix=pattern.mix,
    )


def _step_samples(grid: str, bpm: float, sample_rate: int) -> int:
    return max(int(round(resolution_beats(grid) * 60.0 / bpm * sample_rate)), 1)


def slice_grid(audio: np.ndarray, sample_rate: int, bpm: float, grid: str) -> list[np.ndarray]:
    width = _step_samples(grid, bpm, sample_rate)
    n = audio.shape[-1]
    return [audio[..., i : i + width] for i in range(0, n, width) if audio[..., i : i + width].shape[-1] > 8]


def slice_onsets(audio: np.ndarray, sample_rate: int, mono: np.ndarray | None = None) -> list[np.ndarray]:
    import librosa

    source = mono if mono is not None else (audio if audio.ndim == 1 else np.mean(audio, axis=0))
    frames = librosa.onset.onset_detect(y=source.astype(np.float32), sr=sample_rate, units="samples")
    cuts = [0, *sorted(int(f) for f in frames), audio.shape[-1]]
    unique: list[int] = []
    for cut in cuts:
        if not unique or cut - unique[-1] > int(0.02 * sample_rate):
            unique.append(cut)
    if unique[-1] != audio.shape[-1]:
        unique.append(audio.shape[-1])
    slices = [audio[..., a:b] for a, b in zip(unique, unique[1:]) if b - a > 8]
    return slices or [audio]


def concat_crossfade(slices: list[np.ndarray], sample_rate: int, fade_ms: float = 4.0) -> np.ndarray:
    if not slices:
        raise ValueError("No slices to join")
    fade = max(int(sample_rate * fade_ms / 1000.0), 1)
    out = slices[0].copy()
    for nxt in slices[1:]:
        overlap = min(fade, out.shape[-1] // 2, nxt.shape[-1] // 2)
        if overlap <= 1:
            out = np.concatenate([out, nxt], axis=-1)
            continue
        ramp = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
        head = out[..., -overlap:] * (1.0 - ramp)
        tail = nxt[..., :overlap] * ramp
        body = nxt[..., overlap:]
        out = np.concatenate([out[..., :-overlap], head + tail, body], axis=-1)
    return out.astype(np.float32)


def reorder_slices(slices: list[np.ndarray], rng: np.random.Generator) -> list[np.ndarray]:
    order = np.arange(len(slices))
    rng.shuffle(order)
    return [slices[i] for i in order]


def stutter_slices(
    slices: list[np.ndarray],
    rng: np.random.Generator,
    count: int = 1,
    repeats: int = 3,
) -> list[np.ndarray]:
    if not slices:
        return slices
    count = max(1, min(count, len(slices)))
    start = int(rng.integers(0, max(len(slices) - count + 1, 1)))
    chunk = slices[start : start + count]
    out = list(slices)
    insert_at = start + count
    for _ in range(repeats):
        out[insert_at:insert_at] = [s.copy() for s in chunk]
        insert_at += count
    return out


def reverse_some(slices: list[np.ndarray], rng: np.random.Generator, chance: float = 0.2) -> list[np.ndarray]:
    out = []
    for slc in slices:
        out.append(slc[..., ::-1].copy() if rng.random() < chance else slc)
    return out
