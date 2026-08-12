# Resampler

Live melody-aware loop chopper for Ableton.

Load a vocal, bass loop, or synth loop. Resampler finds the **notes**, not equal time slices. **Inspire** invents a loop that jumps around those notes. Pitch stays in key. Bounce a WAV into Session View. Percussion stays out.

It is **not** Simpler and **not** a VST. Simpler chops time. Resampler chops the **melody**, then randomizes musically.

## Install

```powershell
git clone https://github.com/YOU/resample.git
cd resample
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev,stretch]"
```

`python-stretch` (Signalsmith, MIT) is the preferred pitch backend. Pedalboard/Rubber Band is a GPL fallback.

## Run

```powershell
resample serve
```

Open http://127.0.0.1:8787

- Search the local Splice library (vocals + bass + synth; no perc)
- **Use** a file → play with space
- Drag the **control star** (speed, length, offset, pitch, pattern)
- Ctrl+click / double-click a star point to **lock** it from Inspire
- **Inspire** (or Ctrl+R) randomizes unlocked axes and starts the loop
- Ctrl+Z = undo last change
- **Through** = play past the note end for the full step
- Export WAV / **drag to Live** = bounce N bars (also written to `./out`)
- Save a named **kit** to recall star + grid later

### Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / stop |
| Ctrl+R | Inspire |
| Ctrl+Z | Undo last change |

## What the controls mean

| Control | Meaning |
|---------|---------|
| **Speed** | Step rate (whole → 32nd). How fast the loop ticks. |
| **Pattern** | Note order: lock, stutter-jump, hold-run, reverse, ping-pong, leap, scatter, call/response. |
| **Length / offset** | Which *bars of the sample* you may steal notes from. |
| **Loop length** | How long the *idea* is (1 / 2 / 4 bars) before it repeats. |
| **Pitch** | Transpose, only to scale degrees of the key dropdown. |
| **Key** | Cages pitch. Auto-filled from Splice-style names (`_Am`, `_D#m`) when present; otherwise chroma. |
| **Reverse / through / swing** | Flip each grain; play through note changes; delay odd steps. |
| **Chance** | `%` row on the grid. That step can miss. |
| **Automation** | Clip envelopes under the loop. Ramp speed or pitch over bars. |
| **Kits** | Named snapshot of star + grid + feel. Lives in this browser. |

The sequence grid **is** the loop. Click a cell to pick which note plays on that step.

## Splice library

Default folder: `Documents\Splice`. Search keeps vocals, bass loops, and synth loops. Drum hits, perc loops, FX, and one-shots stay out.

```powershell
resample library --detect
resample library -q ooh --kind pad
resample library --kind bass
resample analyze "C:\path\to\wet_Am.wav"
```

`resample generate` still exists for the older offline recipe path (gate / slice batch). The daily driver is the live UI.

Library folder is stored in `~/.resample/config.json`. A leftover `~/.voxloom/config.json` is copied once on first run.

## Layout

```
src/resample/           Python: analyze, notes, library, optional offline render
src/resample/static/    Live UI: app.js (chrome), live.js (engine), viz.js (stars)
tests/                  Synthetic-tone + filename-key tests
docs/ARCHITECTURE.md    How the pieces fit
docs/FUTURE.md          Next ideas
```

## License

MIT for Resampler. Pitch backends have their own terms.

Creeper screenshot in the options easter egg: Xbox México, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), [Wikimedia](https://commons.wikimedia.org/wiki/File:Minecraft_Creeper_(Crop).png).
