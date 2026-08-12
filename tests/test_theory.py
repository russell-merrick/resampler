from resample.theory import (
    in_scale_intervals,
    key_from_filename,
    key_label,
    nearest_scale_interval,
    parse_key,
    third_interval,
    transpose_between_roots,
)


def test_parse_key_forms() -> None:
    assert parse_key("A:min") == ("A", "minor")
    assert parse_key("F#maj") == ("F#", "major")
    assert parse_key("Eb minor") == ("D#", "minor")
    assert parse_key("C") == ("C", "major")


def test_transpose_shortest_path() -> None:
    assert transpose_between_roots("C", "A") == -3
    assert transpose_between_roots("A", "C") == 3
    assert transpose_between_roots("C", "C") == 0


def test_scale_intervals_include_tonic_and_fifth() -> None:
    iv = in_scale_intervals("minor", -12, 12)
    assert 0 in iv
    assert 7 in iv
    assert 3 in iv
    assert 4 not in iv


def test_nearest_snaps_off_scale() -> None:
    assert nearest_scale_interval(4, "minor") in {3, 5}
    assert third_interval("minor") == 3
    assert third_interval("major") == 4


def test_key_label() -> None:
    assert key_label("A", "minor") == "Amin"
    assert key_label("C", "major") == "Cmaj"


def test_key_from_splice_filename() -> None:
    assert key_from_filename("vox_my_love_lead_wet_Am.wav") == ("A", "minor")
    assert key_from_filename("loop_if_you_go_wet_D#m.wav") == ("D#", "minor")
    assert key_from_filename("phrase_Cmaj_wet.wav") == ("C", "major")
    assert key_from_filename("Emin_vocal_hook.wav") == ("E", "minor")
    assert key_from_filename("no_key_here.wav") is None
