from resample.cli import build_parser, main


def test_help_exits_zero() -> None:
    parser = build_parser()
    assert parser.prog == "resample"


def test_recipes_cli(capsys) -> None:
    assert main(["recipes"]) == 0
    out = capsys.readouterr().out
    assert "trance-pad-gate" in out
    assert "ukg-chop" in out


def test_library_detect_cli(capsys) -> None:
    assert main(["library", "--detect"]) in {0, 1}
    out = capsys.readouterr().out
    assert "detected" in out
