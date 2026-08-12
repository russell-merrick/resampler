from pathlib import Path

import numpy as np

from tests.synth import chord
from resample.recipes import get_recipe, job_from_recipe
from resample.render import generate_takes, render_take, take_stem
from resample.theory import bars_to_samples


def test_render_hits_bar_grid() -> None:
    sr = 22050
    audio = chord([220.0, 261.63, 329.63], seconds=1.4, sr=sr)[None, :]
    recipe = get_recipe("trance-pad-gate")
    job = job_from_recipe(
        recipe,
        source_name="ooh.wav",
        source_key_root="A",
        source_key_mode="minor",
        target_key_root="A",
        target_scale="minor",
        bpm=128.0,
        bars=1,
        n_takes=1,
        seed=3,
    )
    job.harmony = False
    out, meta = render_take(audio, sr, job, seed=3)
    assert out.shape[-1] == bars_to_samples(1, 128.0, sr)
    assert meta["recipe"] == "trance-pad-gate"
    assert meta["pattern"]["name"].startswith("sixteenth_pump")


def test_generate_writes_wav_and_json(tmp_path: Path) -> None:
    sr = 22050
    audio = chord([261.63, 329.63, 392.0], seconds=1.2, sr=sr)[None, :]
    job = job_from_recipe(
        get_recipe("ukg-chop"),
        source_name="phrase.wav",
        source_key_root="C",
        source_key_mode="major",
        bpm=120.0,
        bars=1,
        n_takes=2,
        seed=10,
    )
    job.harmony = False
    takes = generate_takes(audio, sr, job, tmp_path)
    assert len(takes) == 2
    for take in takes:
        assert Path(take.filename).exists()
        assert Path(take.json_filename).exists()
        assert Path(take.filename).name.startswith("take_")
        assert take.filename.endswith(".wav")
        assert take.duration_sec > 0
        assert "resample_" in take.meta["download_name"]


def test_take_stem_has_no_hash() -> None:
    job = job_from_recipe(
        get_recipe("trance-pad-gate"),
        source_name="loop_D#m.wav",
        source_key_root="G#",
        source_key_mode="minor",
        target_key_root="G#",
        target_scale="minor",
        bpm=128.0,
        n_takes=1,
    )
    stem = take_stem(job, 1)
    assert "#" not in stem
    assert "Gsmin" in stem
