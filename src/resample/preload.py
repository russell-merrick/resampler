"""JIT warmup and analysis cache so the first Use is not a 10s stall."""

from __future__ import annotations

import queue
import threading
from pathlib import Path

_MAX_CACHE = 48
_cache: dict[tuple, tuple] = {}
_inflight: dict[tuple, threading.Event] = {}
_queued: set[tuple] = set()
_lock = threading.Lock()
_q: queue.PriorityQueue[tuple[int, int, Path | None]] = queue.PriorityQueue()
_seq = 0
_stop = threading.Event()
_thread: threading.Thread | None = None
_warmed = threading.Event()


def file_id(path: Path) -> tuple:
    st = path.stat()
    return (str(path.resolve()), int(st.st_mtime_ns), int(st.st_size))


def clear_cache() -> None:
    with _lock:
        _cache.clear()
        _queued.clear()


def warmed() -> bool:
    return _warmed.is_set()


def analyze_cached(path: Path, name: str | None = None):
    """Return (Analysis, notes dict), sharing in-flight work for the same file."""
    from resample.analyze import analyze_file
    from resample.notes import detect_notes

    path = Path(path)
    key = file_id(path)
    while True:
        with _lock:
            hit = _cache.get(key)
            if hit is not None:
                return hit
            ev = _inflight.get(key)
            if ev is None:
                ev = threading.Event()
                _inflight[key] = ev
                owner = True
            else:
                owner = False
        if not owner:
            ev.wait(timeout=180)
            continue
        try:
            audio, analysis = analyze_file(path, name=name or path.name)
            try:
                notes = detect_notes(audio, analysis.sample_rate)
            except Exception:
                notes = {"notes": [], "unique": [], "count": 0}
            result = (analysis, notes)
            with _lock:
                _cache[key] = result
                _queued.discard(key)
                while len(_cache) > _MAX_CACHE:
                    oldest = next(iter(_cache))
                    if oldest == key:
                        break
                    _cache.pop(oldest, None)
            return result
        finally:
            with _lock:
                _inflight.pop(key, None)
            ev.set()


def enqueue_prefetch(path: Path, priority: int = 2) -> None:
    """Queue a file for background analysis. Lower priority number runs first."""
    start_preload_worker()
    path = Path(path)
    try:
        key = file_id(path)
    except OSError:
        return
    with _lock:
        if key in _cache or key in _inflight or key in _queued:
            return
        _queued.add(key)
        global _seq
        _seq += 1
        seq = _seq
    _q.put((int(priority), seq, path))


def warmup() -> None:
    import numpy as np

    from resample.analyze import analyze_audio
    from resample.notes import detect_notes

    sr = 44100
    n = int(sr * 0.45)
    t = np.linspace(0.0, 0.45, n, endpoint=False)
    y = (0.2 * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)
    audio = y[None, :]
    analyze_audio(audio, sr, name="warmup.wav")
    detect_notes(audio, sr)
    _warmed.set()


def _worker() -> None:
    try:
        warmup()
    except Exception:
        _warmed.set()
    while not _stop.is_set():
        try:
            _prio, _n, path = _q.get(timeout=0.25)
        except queue.Empty:
            continue
        if path is None:
            break
        try:
            analyze_cached(path)
        except Exception:
            try:
                key = file_id(path)
            except OSError:
                key = None
            if key is not None:
                with _lock:
                    _queued.discard(key)


def start_preload_worker() -> None:
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_worker, name="resample-preload", daemon=True)
    _thread.start()


def stop_preload_worker() -> None:
    _stop.set()
    _q.put((0, 0, None))
    thread = _thread
    if thread is not None:
        thread.join(timeout=2.0)
