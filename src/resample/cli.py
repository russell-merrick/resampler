"""CLI: serve, analyze, library search, optional offline generate."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from resample import __version__
from resample.analyze import analyze_file
from resample.library import detect_splice_roots, preferred_root, save_config, search_library
from resample.models import Engine, PitchMode, VoiceMode
from resample.recipes import get_recipe, job_from_recipe, list_recipes, pattern_by_name
from resample.render import generate_takes
from resample.theory import parse_key


def _print(data: object) -> None:
    if isinstance(data, str):
        print(data)
        return
    print(json.dumps(data, indent=2))


def cmd_analyze(args: argparse.Namespace) -> int:
    _, analysis = analyze_file(args.input)
    _print(
        {
            "file": str(args.input),
            "duration_sec": analysis.duration_sec,
            "sample_rate": analysis.sample_rate,
            "key": analysis.key_label(),
            "key_root": analysis.key_root,
            "key_mode": analysis.key_mode,
            "confidence": analysis.key_confidence,
            "alt_keys": analysis.alt_keys,
            "suggested_mode": analysis.suggested_mode.value,
            "onset_rate": analysis.onset_rate,
            "estimated_bpm": analysis.estimated_bpm,
        }
    )
    return 0


def cmd_recipes(_: argparse.Namespace) -> int:
    rows = [
        {
            "name": r.name,
            "mode": r.mode.value,
            "engine": r.engine.value,
            "pitch": r.pitch_mode.value,
            "description": r.description,
        }
        for r in list_recipes()
    ]
    _print(rows)
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    audio, analysis = analyze_file(args.input)
    recipe = get_recipe(args.recipe)
    src_root, src_mode = analysis.key_root, analysis.key_mode
    if args.source_key:
        src_root, src_mode = parse_key(args.source_key)
    tgt_root, tgt_scale = src_root, src_mode
    if args.key:
        tgt_root, tgt_scale = parse_key(args.key)
    job = job_from_recipe(
        recipe,
        source_name=Path(args.input).name,
        source_key_root=src_root,
        source_key_mode=src_mode,
        target_key_root=tgt_root,
        target_scale=tgt_scale,
        bpm=args.bpm or analysis.estimated_bpm or 128.0,
        bars=args.bars,
        n_takes=args.n,
        seed=args.seed,
        mutate=args.mutate,
    )
    if args.mode:
        job.mode = VoiceMode(args.mode)
    if args.engine:
        job.engine = Engine(args.engine)
    if args.pitch:
        job.pitch_mode = PitchMode(args.pitch)
    if args.pattern:
        job.pattern = pattern_by_name(args.pattern)
    takes = generate_takes(audio, analysis.sample_rate, job, args.out)
    _print(
        {
            "analysis": {
                "key": analysis.key_label(),
                "confidence": analysis.key_confidence,
                "suggested_mode": analysis.suggested_mode.value,
            },
            "job": {
                "recipe": job.recipe,
                "target_key": f"{job.target_key_root}:{job.target_scale}",
                "bpm": job.bpm,
                "bars": job.bars,
                "mode": job.mode.value,
                "engine": job.engine.value,
            },
            "takes": [t.filename for t in takes],
        }
    )
    return 0


def cmd_library(args: argparse.Namespace) -> int:
    if args.set_root:
        path = Path(args.set_root).expanduser()
        if not path.is_dir():
            raise FileNotFoundError(path)
        save_config({"library_root": str(path.resolve())})
    root = Path(args.root).expanduser() if args.root else preferred_root()
    if args.detect or root is None:
        detected = [str(p) for p in detect_splice_roots()]
        _print(
            {
                "detected": detected,
                "active": str(root) if root else None,
            }
        )
        return 0 if detected or root else 1
    if root is None:
        raise FileNotFoundError("No Splice folder found. Pass --root or --set-root.")
    result = search_library(
        root,
        query=args.query or "",
        vocals_only=args.vocals,
        kind=args.kind,
        limit=args.limit,
        include_other=args.all,
    )
    if args.paths:
        for hit in result["hits"]:
            print(hit["path"])
        return 0
    _print(result)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run(
        "resample.webapp:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="resample",
        description="Live melody-aware loop chopper for Ableton.",
    )
    parser.add_argument("--version", action="version", version=f"resample {__version__}")
    sub = parser.add_subparsers(dest="cmd", required=True)

    analyze = sub.add_parser("analyze", help="Detect key, mode hint, and tempo guess")
    analyze.add_argument("input", type=Path)
    analyze.set_defaults(func=cmd_analyze)

    recipes = sub.add_parser("recipes", help="List built-in recipes")
    recipes.set_defaults(func=cmd_recipes)

    generate = sub.add_parser("generate", help="Render unique takes from a vocal sample")
    generate.add_argument("input", type=Path)
    generate.add_argument("--recipe", default="trance-pad-gate")
    generate.add_argument("--key", help="Target key, e.g. A:min or F#maj")
    generate.add_argument("--source-key", help="Override detected source key")
    generate.add_argument("--bpm", type=float)
    generate.add_argument("--bars", type=int)
    generate.add_argument("--mode", choices=["lead", "pad"])
    generate.add_argument("--engine", choices=["gate", "slice"])
    generate.add_argument("--pitch", choices=["off", "whole_clip", "per_slice"])
    generate.add_argument("--pattern", help="Gate pattern name")
    generate.add_argument("--mutate", type=float)
    generate.add_argument("-n", type=int, default=8)
    generate.add_argument("--seed", type=int, default=1)
    generate.add_argument("--out", type=Path, default=Path("out"))
    generate.set_defaults(func=cmd_generate)

    library = sub.add_parser("library", help="Search a Splice / sample library")
    library.add_argument("--root", help="Library folder (default: saved or auto-detect)")
    library.add_argument("--set-root", help="Save a default library folder")
    library.add_argument("--detect", action="store_true", help="Print detected Splice folders")
    library.add_argument("-q", "--query", default="", help="Filename / pack search")
    library.add_argument(
        "--kind",
        choices=["all", "vocals", "vocal", "pad", "lead", "bass", "synth"],
        default="all",
    )
    library.add_argument("--vocals", action="store_true", help="Vocals only (no bass/synth)")
    library.add_argument("--all", action="store_true", help="Also include uncategorized files (still no perc)")
    library.add_argument("--limit", type=int, default=80)
    library.add_argument("--paths", action="store_true", help="Print file paths only")
    library.set_defaults(func=cmd_library)

    serve = sub.add_parser("serve", help="Open the local web UI")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8787)
    serve.add_argument("--reload", action="store_true")
    serve.set_defaults(func=cmd_serve)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except Exception as exc:  # noqa: BLE001 — CLI boundary
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
