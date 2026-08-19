"""Walk a Splice folder and keep pitched loops: vocals, bass, synth. Never perc."""

from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path

AUDIO_SUFFIXES = {".wav", ".aif", ".aiff", ".mp3", ".flac", ".ogg"}
SKIP_DIRS = {
    ".git",
    ".splice",
    "presets",
    "preset",
    "instrument",
    "instruments",
    "node_modules",
    "__pycache__",
}

_TOKEN = re.compile(r"[a-z0-9]+")

VOCAL_TOKENS = {
    "vocal",
    "vocals",
    "vox",
    "voice",
    "voices",
    "choir",
    "choirs",
    "ooh",
    "oohs",
    "aah",
    "aahs",
    "ahhs",
    "adlib",
    "adlibs",
    "acapella",
    "acappella",
    "chant",
    "spoken",
    "sing",
    "singer",
    "singing",
    "topline",
}
PAD_TOKENS = {
    "ooh",
    "oohs",
    "aah",
    "aahs",
    "ahhs",
    "choir",
    "choirs",
    "pad",
    "pads",
    "texture",
    "atmosphere",
    "bed",
    "hum",
    "harmony",
    "harmonies",
}
LEAD_TOKENS = {
    "adlib",
    "adlibs",
    "phrase",
    "phrases",
    "hook",
    "hooks",
    "spoken",
    "lyric",
    "lyrics",
    "topline",
    "verse",
    "chorus",
    "chop",
    "chops",
}
DRUM_TOKENS = {
    "kick",
    "kicks",
    "bassdrum",
    "bassdrums",
    "snare",
    "snares",
    "hat",
    "hats",
    "hihat",
    "hihats",
    "clap",
    "claps",
    "perc",
    "percs",
    "percussion",
    "drum",
    "drums",
    "rim",
    "rimshot",
    "tom",
    "toms",
    "crash",
    "ride",
    "rides",
    "shaker",
    "shakers",
    "cymbal",
    "cymbals",
    "snap",
    "snaps",
    "fill",
    "fills",
    "break",
    "breaks",
    "breakbeat",
    "breakbeats",
    "conga",
    "bongo",
    "tamb",
    "tambourine",
    "cowbell",
    "sidestick",
    "closedhat",
    "openhat",
    "groove",
    "grooves",
    "tops",
    "909",
    "loop",
}
# "loop" is too broad to exclude by itself — only with drum family
DRUM_FILE_TOKENS = DRUM_TOKENS - {"loop"}
FX_TOKENS = {
    "riser",
    "risers",
    "impact",
    "impacts",
    "sweep",
    "sweeps",
    "fx",
    "sfx",
    "foley",
    "whoosh",
    "downlifter",
    "uplifter",
    "transition",
    "transitions",
    "noise",
}
PERC_FILE_TOKENS = DRUM_FILE_TOKENS | FX_TOKENS
BASS_TOKENS = {
    "bass",
    "basses",
    "bassline",
    "basslines",
    "sub",
    "subbass",
    "reese",
    "wobble",
    "303",
    "moog",
    "808",
}
SYNTH_TOKENS = {
    "synth",
    "synths",
    "syn",
    "arp",
    "arps",
    "arpeggio",
    "pluck",
    "plucks",
    "stab",
    "stabs",
    "analog",
    "analogue",
    "supersaw",
    "saw",
    "wavetable",
    "melody",
    "melodic",
    "chord",
    "chords",
    "keys",
    "sequence",
    "seq",
    "riff",
    "riffs",
    "acid",
    "hoover",
    "pad",
    "pads",
    "atmosphere",
    "texture",
}
LOOP_TOKENS = {"loop", "loops", "looped"}
VOCAL_KINDS = {"vocal", "pad", "lead"}
PITCHED_KINDS = VOCAL_KINDS | {"bass", "synth"}
KIND_GROUPS = {
    "all": PITCHED_KINDS,
    "vocals": VOCAL_KINDS,
    "vocal": {"vocal"},
    "pad": {"pad"},
    "lead": {"lead"},
    "bass": {"bass"},
    "synth": {"synth"},
}


@dataclass(frozen=True)
class SampleHit:
    path: str
    name: str
    rel: str
    pack: str
    kind: str
    tags: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def config_path() -> Path:
    new = Path.home() / ".resample" / "config.json"
    old = Path.home() / ".voxloom" / "config.json"
    if not new.exists() and old.exists():
        new.parent.mkdir(parents=True, exist_ok=True)
        new.write_text(old.read_text(encoding="utf-8"), encoding="utf-8")
    return new


def load_config() -> dict:
    path = config_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_config(data: dict) -> Path:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    current = load_config()
    current.update(data)
    path.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return path


def detect_splice_roots() -> list[Path]:
    home = Path.home()
    candidates = [
        home / "Documents" / "Splice",
        home / "Documents" / "Splice" / "Samples",
        home / "Splice",
        Path("C:/Documents/Splice"),
    ]
    found: list[Path] = []
    seen: set[str] = set()
    for raw in candidates:
        if not raw.exists() or not raw.is_dir():
            continue
        root = raw.resolve()
        key = str(root).lower()
        if key in seen:
            continue
        seen.add(key)
        found.append(root)
    return found


def preferred_root() -> Path | None:
    configured = load_config().get("library_root")
    if configured:
        path = Path(configured).expanduser()
        if path.exists():
            return path.resolve()
    roots = detect_splice_roots()
    if not roots:
        return None
    for root in roots:
        if (root / "Samples").is_dir() or (root / "packs").is_dir() or (root / "Samples" / "packs").is_dir():
            return root
    return roots[0]


def tokens(text: str) -> set[str]:
    return set(_TOKEN.findall(text.lower().replace("#", "s")))


def _split_rel(path: Path, root: Path) -> tuple[str, list[str], str]:
    try:
        rel = path.relative_to(root)
    except ValueError:
        rel = Path(path.name)
    parts = list(rel.parts)
    filename = path.stem
    if parts and parts[0].lower() == "samples" and len(parts) > 1:
        parts = parts[1:]
    if parts and parts[0].lower() == "packs" and len(parts) > 1:
        pack = parts[1]
        folders = [p for p in parts[2:-1]]
    elif parts:
        pack = parts[0]
        folders = [p for p in parts[1:-1]]
    else:
        pack = ""
        folders = []
    return pack, folders, filename


def _place_tokens(pack: str, folders: list[str]) -> set[str]:
    out: set[str] = tokens(pack)
    for folder in folders:
        out |= tokens(folder)
    return out


def _is_loop(file_tok: set[str], place_tok: set[str]) -> bool:
    return bool((file_tok | place_tok) & LOOP_TOKENS)


def _vocal_kind(file_tok: set[str], place_tok: set[str]) -> str:
    kind_tok = file_tok | place_tok
    if kind_tok & PAD_TOKENS:
        return "pad"
    if kind_tok & LEAD_TOKENS:
        return "lead"
    return "vocal"


def _vocal_tags(file_tok: set[str], place_tok: set[str]) -> list[str]:
    return sorted((file_tok | place_tok) & (VOCAL_TOKENS | PAD_TOKENS | LEAD_TOKENS))


def classify_sample(path: Path, root: Path) -> tuple[bool, str, list[str]]:
    """Return (allowed, kind, tags). kind is vocal/pad/lead/bass/synth, or perc/skip."""
    pack, folders, filename = _split_rel(path, root)
    file_tok = tokens(filename)
    place_tok = _place_tokens(pack, folders)
    strong_vocal = bool(file_tok & (VOCAL_TOKENS - {"vox"}))
    file_vocal = bool(file_tok & VOCAL_TOKENS)
    place_vocal = bool(place_tok & VOCAL_TOKENS)

    # Filename drums/FX win unless the file itself is clearly a vocal.
    if file_tok & PERC_FILE_TOKENS and not strong_vocal:
        return False, "perc", []

    if file_vocal or place_vocal:
        # Pack named Vocals with a kick in the filename already returned perc.
        kind = _vocal_kind(file_tok, place_tok)
        return True, kind, _vocal_tags(file_tok, place_tok)

    in_drums = bool(place_tok & DRUM_FILE_TOKENS)
    bass_hit = bool(file_tok & BASS_TOKENS) or (bool(place_tok & BASS_TOKENS) and not in_drums)
    # "bass drum" is a kick even if we somehow missed perc tokens.
    if "bass" in file_tok and "drum" in file_tok:
        bass_hit = False
    if in_drums:
        bass_hit = bool(file_tok & (BASS_TOKENS - {"808"}))
    if bass_hit:
        if not _is_loop(file_tok, place_tok):
            return False, "skip", []
        tags = sorted((file_tok | place_tok) & (BASS_TOKENS | LOOP_TOKENS))
        return True, "bass", tags

    weak_synth = {"pad", "pads", "atmosphere", "texture"}
    if in_drums:
        synth_hit = bool(file_tok & (SYNTH_TOKENS - weak_synth))
    else:
        synth_hit = bool(file_tok & SYNTH_TOKENS) or bool(place_tok & SYNTH_TOKENS)
    if synth_hit:
        if not _is_loop(file_tok, place_tok):
            return False, "skip", []
        tags = sorted((file_tok | place_tok) & (SYNTH_TOKENS | LOOP_TOKENS))
        return True, "synth", tags

    if place_tok & DRUM_FILE_TOKENS or file_tok & PERC_FILE_TOKENS:
        return False, "perc", []
    return False, "skip", []


def classify_vocal(path: Path, root: Path) -> tuple[bool, str, list[str]]:
    ok, kind, tags = classify_sample(path, root)
    if ok and kind in VOCAL_KINDS:
        return True, kind, tags
    return False, kind, tags


def iter_audio(root: Path) -> list[Path]:
    hits: list[Path] = []
    root = root.resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d.lower() not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            if Path(name).suffix.lower() in AUDIO_SUFFIXES:
                hits.append(Path(dirpath) / name)
    return hits


def search_library(
    root: Path,
    query: str = "",
    vocals_only: bool = False,
    kind: str = "all",
    limit: int = 80,
    offset: int = 0,
    include_other: bool = False,
) -> dict:
    root = root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Library folder not found: {root}")

    needles = [n for n in query.lower().split() if n]
    rows: list[SampleHit] = []
    scanned = 0
    counts = {name: 0 for name in PITCHED_KINDS}

    wanted = set(KIND_GROUPS.get(kind, PITCHED_KINDS))
    if vocals_only:
        wanted &= VOCAL_KINDS

    for path in iter_audio(root):
        scanned += 1
        allowed, sample_kind, tags = classify_sample(path, root)
        if allowed and sample_kind in counts:
            counts[sample_kind] += 1
        keep = allowed and sample_kind in wanted
        if include_other and sample_kind == "skip":
            keep = kind == "all" and not vocals_only
            if keep:
                sample_kind = "other"
        if not keep:
            continue
        rel = str(path.relative_to(root))
        blob = rel.lower()
        if needles and any(n not in blob for n in needles):
            continue
        pack, _, _ = _split_rel(path, root)
        rows.append(
            SampleHit(
                path=str(path),
                name=path.name,
                rel=rel.replace("\\", "/"),
                pack=pack,
                kind=sample_kind,
                tags=tags,
            )
        )

    rows.sort(key=lambda h: (h.pack.lower(), h.name.lower()))
    page = rows[offset : offset + limit]
    vocal_count = counts["vocal"] + counts["pad"] + counts["lead"]
    return {
        "root": str(root),
        "scanned": scanned,
        "vocal_count": vocal_count,
        "bass_count": counts["bass"],
        "synth_count": counts["synth"],
        "pitched_count": vocal_count + counts["bass"] + counts["synth"],
        "matched": len(rows),
        "offset": offset,
        "limit": limit,
        "hits": [h.to_dict() for h in page],
    }


def resolve_under_root(path: str | Path, roots: list[Path]) -> Path:
    target = Path(path).expanduser().resolve()
    if not target.is_file():
        raise FileNotFoundError(target)
    for root in roots:
        try:
            target.relative_to(root.resolve())
            return target
        except ValueError:
            continue
    raise PermissionError("Path is outside the configured library")
