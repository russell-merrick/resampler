"""Offline pitch/time backend (Signalsmith, then Pedalboard, then librosa). CLI generate only."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from resample.audio import fit_length


@dataclass
class PitchBackend:
    name: str
    license: str


class PitchEngine:
    """Isolated pitch/time engine. Signalsmith first, then Pedalboard, then librosa."""

    def __init__(self) -> None:
        self.backend = self._detect()

    def _detect(self) -> PitchBackend:
        try:
            import python_stretch  # noqa: F401

            return PitchBackend("signalsmith", "MIT")
        except Exception:
            pass
        try:
            import pedalboard  # noqa: F401

            return PitchBackend("pedalboard", "GPL-2.0 (Rubber Band)")
        except Exception:
            pass
        return PitchBackend("librosa", "ISC")

    def shift(
        self,
        audio: np.ndarray,
        sample_rate: int,
        semitones: float,
        formant: bool = True,
    ) -> np.ndarray:
        if abs(semitones) < 1e-4:
            return audio
        if self.backend.name == "signalsmith":
            return self._signalsmith(audio, sample_rate, semitones, time_factor=1.0, formant=formant)
        if self.backend.name == "pedalboard":
            return self._pedalboard_shift(audio, sample_rate, semitones)
        return self._librosa_shift(audio, sample_rate, semitones)

    def stretch(
        self,
        audio: np.ndarray,
        sample_rate: int,
        time_factor: float,
        formant: bool = True,
    ) -> np.ndarray:
        if abs(time_factor - 1.0) < 1e-4:
            return audio
        if self.backend.name == "signalsmith":
            return self._signalsmith(audio, sample_rate, 0.0, time_factor=time_factor, formant=formant)
        if self.backend.name == "pedalboard":
            return self._pedalboard_stretch(audio, sample_rate, time_factor)
        return self._librosa_stretch(audio, sample_rate, time_factor)

    def time_fit(
        self,
        audio: np.ndarray,
        sample_rate: int,
        target_samples: int,
        formant: bool = True,
    ) -> np.ndarray:
        current = audio.shape[-1]
        if current == target_samples:
            return audio
        factor = target_samples / max(current, 1)
        stretched = self.stretch(audio, sample_rate, factor, formant=formant)
        return fit_length(stretched, target_samples)

    def _signalsmith(
        self,
        audio: np.ndarray,
        sample_rate: int,
        semitones: float,
        time_factor: float,
        formant: bool,
    ) -> np.ndarray:
        import python_stretch as ps

        work = audio if audio.ndim == 2 else audio[np.newaxis, :]
        stretch = ps.Signalsmith.Stretch()
        stretch.preset(int(work.shape[0]), int(sample_rate))
        if hasattr(stretch, "setTransposeSemitones"):
            stretch.setTransposeSemitones(float(semitones))
        elif hasattr(stretch, "set_transpose_semitones"):
            stretch.set_transpose_semitones(float(semitones))
        if formant and hasattr(stretch, "setFormantCompensation"):
            stretch.setFormantCompensation(True)
        # python-stretch timeFactor is output/input duration.
        stretch.timeFactor = float(time_factor)
        processed = np.asarray(stretch.process(work), dtype=np.float32)
        if audio.ndim == 1:
            return processed[0]
        return processed

    def _pedalboard_shift(self, audio: np.ndarray, sample_rate: int, semitones: float) -> np.ndarray:
        from pedalboard import PitchShift

        frames = audio.T if audio.ndim == 2 else audio
        shifted = PitchShift(semitones=float(semitones))(frames, sample_rate)
        shifted = np.asarray(shifted, dtype=np.float32)
        if audio.ndim == 2:
            return shifted.T if shifted.ndim == 2 else shifted[np.newaxis, :]
        return shifted.reshape(-1) if shifted.ndim > 1 and shifted.shape[0] == 1 else shifted

    def _pedalboard_stretch(self, audio: np.ndarray, sample_rate: int, time_factor: float) -> np.ndarray:
        from pedalboard import time_stretch

        frames = audio.T if audio.ndim == 2 else audio
        # pedalboard time_stretch stretch_factor is output/input duration.
        stretched = time_stretch(frames, sample_rate, stretch_factor=float(time_factor))
        stretched = np.asarray(stretched, dtype=np.float32)
        if audio.ndim == 2:
            return stretched.T if stretched.ndim == 2 else stretched[np.newaxis, :]
        return stretched.reshape(-1)

    def _librosa_shift(self, audio: np.ndarray, sample_rate: int, semitones: float) -> np.ndarray:
        import librosa

        if audio.ndim == 1:
            return librosa.effects.pitch_shift(audio, sr=sample_rate, n_steps=semitones).astype(np.float32)
        channels = [
            librosa.effects.pitch_shift(channel, sr=sample_rate, n_steps=semitones)
            for channel in audio
        ]
        return np.stack(channels).astype(np.float32)

    def _librosa_stretch(self, audio: np.ndarray, sample_rate: int, time_factor: float) -> np.ndarray:
        import librosa

        # librosa rate is playback speed: 2.0 = half duration.
        rate = 1.0 / time_factor
        if audio.ndim == 1:
            return librosa.effects.time_stretch(audio, rate=rate).astype(np.float32)
        channels = [librosa.effects.time_stretch(channel, rate=rate) for channel in audio]
        return np.stack(channels).astype(np.float32)


_ENGINE: PitchEngine | None = None


def get_engine() -> PitchEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = PitchEngine()
    return _ENGINE
