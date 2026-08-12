from pathlib import Path

from resample.library import classify_sample, classify_vocal, search_library


def _touch(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"RIFF")


def test_classifies_vocals_not_pack_brand_or_drums(tmp_path: Path) -> None:
    vocal = tmp_path / "packs" / "91Vocals - Foo" / "loops" / "Vocal_Loops" / "vocal_loop_dry.wav"
    hihat = tmp_path / "packs" / "91Vocals - Foo" / "loops" / "Drum_Loops" / "hihat_loop_bandit.wav"
    kick = tmp_path / "packs" / "VOX Brand" / "oneshots" / "drums" / "kick" / "VOX_ASFK_kick_pop.wav"
    pad = tmp_path / "packs" / "Choir Pads" / "loops" / "vocals" / "warm_ooh_aah_pad.wav"
    for path in (vocal, hihat, kick, pad):
        _touch(path)

    assert classify_vocal(vocal, tmp_path)[0] is True
    assert classify_vocal(hihat, tmp_path)[0] is False
    assert classify_vocal(kick, tmp_path)[0] is False
    is_pad, kind, tags = classify_vocal(pad, tmp_path)
    assert is_pad
    assert kind == "pad"
    assert "ooh" in tags

    result = search_library(tmp_path, vocals_only=True)
    names = {hit["name"] for hit in result["hits"]}
    assert names == {"vocal_loop_dry.wav", "warm_ooh_aah_pad.wav"}
    assert result["vocal_count"] == 2
    assert result["scanned"] == 4

    oohs = search_library(tmp_path, query="ooh", vocals_only=True)
    assert len(oohs["hits"]) == 1
    assert oohs["hits"][0]["name"] == "warm_ooh_aah_pad.wav"


def test_kind_filter_lead(tmp_path: Path) -> None:
    chop = tmp_path / "packs" / "House Vocals" / "Vocals" / "vocal_chop_hook.wav"
    _touch(chop)
    result = search_library(tmp_path, kind="lead")
    assert result["matched"] == 1
    assert result["hits"][0]["kind"] == "lead"


def test_classifies_bass_and_synth_not_perc(tmp_path: Path) -> None:
    bass = tmp_path / "packs" / "UKG Tools" / "Bass" / "Loops" / "reese_bass_loop_Am.wav"
    eight = tmp_path / "packs" / "808 Club" / "Bass" / "Loops" / "808_C.wav"
    eight_shot = tmp_path / "packs" / "808 Club" / "Bass" / "808_C_shot.wav"
    kick808 = tmp_path / "packs" / "808 Club" / "Drums" / "808_kick.wav"
    synth = tmp_path / "packs" / "Analog Nights" / "Synths" / "Loops" / "supersaw_synth_loop_Cm.wav"
    hat = tmp_path / "packs" / "Analog Nights" / "Drums" / "hat_loop.wav"
    shot = tmp_path / "packs" / "Analog Nights" / "Synths" / "Oneshots" / "pluck_hit_C.wav"
    guitar = tmp_path / "packs" / "Session Guitars" / "Loops" / "guitar_loop_Am.wav"
    pad_in_drums = tmp_path / "packs" / "Analog Nights" / "Drum_Loops" / "pad_loop.wav"
    for path in (bass, eight, eight_shot, kick808, synth, hat, shot, guitar, pad_in_drums):
        _touch(path)

    assert classify_sample(bass, tmp_path)[1] == "bass"
    assert classify_sample(eight, tmp_path)[1] == "bass"
    assert classify_sample(eight_shot, tmp_path)[0] is False
    assert classify_sample(kick808, tmp_path)[1] == "perc"
    assert classify_sample(synth, tmp_path)[1] == "synth"
    assert classify_sample(hat, tmp_path)[1] == "perc"
    assert classify_sample(shot, tmp_path)[0] is False
    assert classify_sample(guitar, tmp_path)[0] is False
    assert classify_sample(pad_in_drums, tmp_path)[0] is False

    result = search_library(tmp_path)
    names = {hit["name"] for hit in result["hits"]}
    assert names == {"reese_bass_loop_Am.wav", "808_C.wav", "supersaw_synth_loop_Cm.wav"}
    assert result["bass_count"] == 2
    assert result["synth_count"] == 1
    assert "hat_loop.wav" not in names
    assert "pluck_hit_C.wav" not in names

    only_bass = search_library(tmp_path, kind="bass")
    assert {hit["kind"] for hit in only_bass["hits"]} == {"bass"}
