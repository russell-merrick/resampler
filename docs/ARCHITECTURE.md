# Architecture

Two layers. The **live UI** is the product. Python analyzes audio and serves files. The browser plays and invents loops.

```
Splice disk → library.py search
                 ↓
            webapp.py  analyze + detect_notes (+ preload cache)
                 ↓
   live.js engine  ←  viz.js star/map  ←  app.js chrome
                 ↓
            bounce WAV
```

## Python (`src/resample/`)

| Module | Job |
|--------|-----|
| `webapp.py` | FastAPI: upload, Splice search, session WAV, optional `generate` |
| `analyze.py` | Key (filename tag first, then chroma), BPM guess, pad/lead hint |
| `preload.py` | JIT warmup + analysis cache so the first Use is not a stall |
| `theory.py` | Scales, filename key tags (`_Am`), interval math |
| `notes.py` | pYIN → sung-note segments (start/end/pitch class) |
| `library.py` | Walk a Splice tree; keep vocals / bass / synth loops; drop perc |
| `audio.py` | Load/save, fades, naming |
| `pitch.py` / `chop.py` / `recipes.py` / `render.py` | Offline CLI batch (not the live path) |
| `cli.py` | `serve`, `analyze`, `library`, `generate` |

Sessions live in the temp dir (`resample-sessions`). Library root is `~/.resample/config.json`.

## Browser

| File | Job |
|------|-----|
| `live.js` | Web Audio scheduler. Note pool from the bar window. Patterns. Reverse + swing. Density + per-step chance. In-key pitch (`detune`). Bounce via `OfflineAudioContext`. |
| `viz.js` | Control star (draggable + lock), melody map (visual only), sequence grid, waveform. |
| `app.js` | Splice UI, options/themes, shortcuts, Resample/undo, kits, drag-export, wiring. |
| `index.html` / `app.css` | Layout and themes (dark, light, neon, rainbow, neon pink). |

**Note length** = step size. **Pattern** = idea (leap, reverse, …). **Clip width / offset** = sample window in bars. **Loop length** = how many steps the idea occupies. **Density** = how many of those steps fire.

Resample randomizes unlocked star axes, then starts playback. Ctrl+Z undoes the last edit (a star drag, slider, grid click, or Resample). Kits persist the same snapshot in `localStorage`. Bounce writes a 24-bit WAV and also POSTs it to `./out` so you can drag a real file into Ableton if the browser drop is flaky.

## What we did *not* reorganize

- Offline `generate` / recipes stay. Harmless, still useful from the CLI.
- `app.js` is one chrome layer. Split later only if a second page appears.
- Keep analysis on the server (librosa/pYIN). Do not port that to the browser.

## Tests

Pytest on theory, filename keys, note splits, gate/slice, pitch cents, library classify, preload cache. No JS tests yet.
