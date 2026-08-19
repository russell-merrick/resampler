"""Local FastAPI app: Splice search, analyze + notes, sessions, live static UI."""

from __future__ import annotations

import json
import shutil
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from resample.analyze import analyze_file
from resample.library import (
    detect_splice_roots,
    load_config,
    preferred_root,
    resolve_under_root,
    save_config,
    search_library,
)
from resample.models import Engine, PitchMode, VoiceMode
from resample.recipes import PATTERNS, get_recipe, job_from_recipe, list_recipes, pattern_by_name
from resample.render import generate_takes
from resample.preload import analyze_cached, enqueue_prefetch, start_preload_worker, stop_preload_worker, warmed
from resample.theory import parse_key

STATIC = Path(__file__).parent / "static"
ROOT = Path(tempfile.gettempdir()) / "resample-sessions"
ROOT.mkdir(parents=True, exist_ok=True)
EXPORT = Path.cwd() / "out"
EXPORT.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    start_preload_worker()
    yield
    stop_preload_worker()


app = FastAPI(title="Resampler", version="0.1.0", lifespan=lifespan)


def _session_dir(session_id: str) -> Path:
    path = ROOT / session_id
    if not path.exists():
        raise HTTPException(404, "Session expired. Drop the sample again.")
    return path


def _library_roots() -> list[Path]:
    root = preferred_root()
    roots = detect_splice_roots()
    if root and root not in roots:
        roots.insert(0, root)
    return roots


def _analysis_payload(session_id: str, filename: str, analysis, notes: dict | None = None) -> dict:
    return {
        "session_id": session_id,
        "filename": filename,
        "duration_sec": analysis.duration_sec,
        "sample_rate": analysis.sample_rate,
        "channels": analysis.channels,
        "key_root": analysis.key_root,
        "key_mode": analysis.key_mode,
        "key_label": analysis.key_label(),
        "confidence": analysis.key_confidence,
        "alt_keys": analysis.alt_keys,
        "suggested_mode": analysis.suggested_mode.value,
        "onset_rate": analysis.onset_rate,
        "estimated_bpm": analysis.estimated_bpm,
        "source_url": f"/api/source/{session_id}",
        "notes": (notes or {}).get("notes", []),
        "note_unique": (notes or {}).get("unique", []),
    }


def _open_path_as_session(src: Path) -> dict:
    try:
        analysis, notes = analyze_cached(src, name=src.name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not read audio: {exc}") from exc
    session_id = uuid.uuid4().hex[:12]
    dest = ROOT / session_id
    dest.mkdir(parents=True, exist_ok=True)
    copied = dest / f"source{src.suffix.lower() or '.wav'}"
    try:
        shutil.copy2(src, copied)
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(400, f"Could not read audio: {exc}") from exc
    payload = _analysis_payload(session_id, src.name, analysis, notes)
    (dest / "analysis.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


@app.get("/api/health")
def health() -> dict:
    from resample.pitch import get_engine

    engine = get_engine()
    return {
        "ok": True,
        "pitch_backend": engine.backend.name,
        "license": engine.backend.license,
        "analyzer_ready": warmed(),
    }


@app.get("/api/recipes")
def recipes() -> list[dict]:
    return [
        {
            "name": r.name,
            "mode": r.mode.value,
            "engine": r.engine.value,
            "pitch": r.pitch_mode.value,
            "bars": r.bars,
            "harmony": r.harmony,
            "pattern": r.pattern,
            "description": r.description,
        }
        for r in list_recipes()
    ]


@app.get("/api/patterns")
def patterns() -> list[dict]:
    return [
        {
            "name": p.name,
            "steps": [int(s) for s in p.steps],
            "resolution": p.resolution,
        }
        for p in PATTERNS.values()
    ]


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)) -> dict:
    suffix = Path(file.filename or "vocal.wav").suffix or ".wav"
    session_id = uuid.uuid4().hex[:12]
    dest = ROOT / session_id
    dest.mkdir(parents=True, exist_ok=True)
    src_path = dest / f"source{suffix}"
    src_path.write_bytes(await file.read())
    try:
        analysis, notes = analyze_cached(src_path, name=file.filename)
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(400, f"Could not read audio: {exc}") from exc
    payload = _analysis_payload(session_id, file.filename or src_path.name, analysis, notes)
    (dest / "analysis.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


@app.get("/api/library")
def library_info() -> dict:
    root = preferred_root()
    return {
        "root": str(root) if root else "",
        "detected": [str(p) for p in detect_splice_roots()],
        "configured": load_config().get("library_root", ""),
        "exists": bool(root and root.exists()),
    }


@app.post("/api/library")
def library_set_root(root: str = Form(...)) -> dict:
    path = Path(root).expanduser()
    if not path.exists() or not path.is_dir():
        raise HTTPException(400, f"Folder not found: {path}")
    save_config({"library_root": str(path.resolve())})
    return library_info()


@app.get("/api/library/search")
def library_search(
    q: str = "",
    vocals: bool = False,
    kind: str = "all",
    limit: int = Query(80, ge=1, le=200),
    offset: int = Query(0, ge=0),
    root: str = "",
) -> dict:
    base = Path(root).expanduser() if root else preferred_root()
    if base is None:
        raise HTTPException(400, "No Splice folder found. Set the library path.")
    try:
        return search_library(base, query=q, vocals_only=vocals, kind=kind, limit=limit, offset=offset)
    except FileNotFoundError as exc:
        raise HTTPException(400, str(exc)) from exc


def _roots_with_optional(root: str = "") -> list[Path]:
    roots = list(_library_roots())
    if root:
        extra = Path(root).expanduser()
        if extra.is_dir():
            resolved = extra.resolve()
            if resolved not in roots:
                roots.append(resolved)
    return roots


@app.get("/api/library/file")
def library_file(path: str, root: str = "") -> FileResponse:
    try:
        target = resolve_under_root(path, _roots_with_optional(root))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return FileResponse(target, filename=target.name)


@app.post("/api/library/prefetch")
def library_prefetch(
    path: str = Form(...),
    root: str = Form(""),
    priority: int = Form(2),
) -> dict:
    try:
        target = resolve_under_root(path, _roots_with_optional(root))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    enqueue_prefetch(target, priority=priority)
    return {"ok": True, "queued": True}


@app.post("/api/library/open")
def library_open(path: str = Form(...), root: str = Form("")) -> dict:
    try:
        target = resolve_under_root(path, _roots_with_optional(root))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return _open_path_as_session(target)


@app.get("/api/source/{session_id}")
def source(session_id: str) -> FileResponse:
    dest = _session_dir(session_id)
    matches = list(dest.glob("source.*"))
    if not matches:
        raise HTTPException(404, "Source missing")
    return FileResponse(matches[0])


@app.post("/api/generate")
async def generate(
    session_id: str = Form(...),
    recipe: str = Form("trance-pad-gate"),
    key: str = Form(""),
    source_key: str = Form(""),
    bpm: float = Form(128),
    bars: int = Form(0),
    mode: str = Form(""),
    engine: str = Form(""),
    pitch: str = Form(""),
    pattern: str = Form(""),
    mutate: float = Form(-1),
    n: int = Form(8),
    seed: int = Form(1),
) -> dict:
    dest = _session_dir(session_id)
    src = next(dest.glob("source.*"), None)
    if src is None:
        raise HTTPException(404, "Source missing")
    analysis_path = dest / "analysis.json"
    analysis = json.loads(analysis_path.read_text(encoding="utf-8")) if analysis_path.exists() else {}
    audio, live = analyze_file(src)
    rec = get_recipe(recipe)
    src_root, src_mode = live.key_root, live.key_mode
    if source_key:
        src_root, src_mode = parse_key(source_key)
    elif analysis.get("key_root"):
        src_root, src_mode = analysis["key_root"], analysis["key_mode"]
    tgt_root, tgt_scale = src_root, src_mode
    if key:
        tgt_root, tgt_scale = parse_key(key)
    job = job_from_recipe(
        rec,
        source_name=analysis.get("filename") or src.name,
        source_key_root=src_root,
        source_key_mode=src_mode,
        target_key_root=tgt_root,
        target_scale=tgt_scale,
        bpm=bpm or live.estimated_bpm or 128.0,
        bars=bars or rec.bars,
        n_takes=max(1, min(int(n), 16)),
        seed=int(seed),
        mutate=None if mutate < 0 else mutate,
    )
    if mode:
        job.mode = VoiceMode(mode)
    if engine:
        job.engine = Engine(engine)
    if pitch:
        job.pitch_mode = PitchMode(pitch)
    if pattern:
        job.pattern = pattern_by_name(pattern)
    out_dir = dest / "takes"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    takes = generate_takes(audio, live.sample_rate, job, out_dir)
    return {
        "takes": [
            {
                "seed": t.seed,
                "recipe": t.recipe,
                "key": t.key_label,
                "bpm": t.bpm,
                "duration_sec": t.duration_sec,
                "wav_url": f"/api/takes/{session_id}/take_{t.seed}.wav",
                "json_url": f"/api/takes/{session_id}/take_{t.seed}.json",
                "name": t.meta.get("download_name") or Path(t.filename).name,
            }
            for t in takes
        ]
    }


@app.get("/api/takes/{session_id}/{name}")
def take_file(session_id: str, name: str) -> FileResponse:
    if "/" in name or "\\" in name:
        raise HTTPException(400, "Bad filename")
    path = _session_dir(session_id) / "takes" / name
    if not path.exists():
        raise HTTPException(404, "Take not found")
    media = "audio/wav" if path.suffix == ".wav" else "application/json"
    return FileResponse(path, media_type=media, filename=name)


def _safe_export_name(name: str) -> str:
    stem = Path(name).name
    cleaned = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in stem)
    if not cleaned.lower().endswith(".wav"):
        cleaned += ".wav"
    return cleaned or "resample.wav"


@app.post("/api/export")
async def save_export(filename: str = Form("resample.wav"), file: UploadFile = File(...)) -> dict:
    name = _safe_export_name(filename)
    dest = EXPORT / name
    dest.write_bytes(await file.read())
    return {"path": str(dest.resolve()), "name": name, "url": f"/api/exports/{name}"}


@app.get("/api/exports/{name}")
def get_export(name: str) -> FileResponse:
    if "/" in name or "\\" in name:
        raise HTTPException(400, "Bad filename")
    path = EXPORT / _safe_export_name(name)
    if not path.exists():
        raise HTTPException(404, "Export not found")
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
