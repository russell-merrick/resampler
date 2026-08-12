# Next

Resampler is a **melody-aware live chopper**. It already has Inspire, locks, a control star, a note map, and WAV bounce. Do not grow into a DAW or a sample store.

## Done (was “next” last time)

- Sung-note detection (not equal slices)
- Inspire / constrained random on the star
- Axis locks (Ctrl+click / double-click)
- Loop grid as the editable sequence
- Filename key tags (`_Am`)
- Themes + shortcuts

## Shipped this pass

1. **Waveform** under the note chips — bar window on the sample, playhead on the current note.
2. **Reverse + swing** — toggle + amount; live grains and bounce both hear it.
3. **Drag the bounced WAV** into Live (button + `out/` folder; download still works).
4. **Named kits** — save star + grid + feel as “UKG lock” in localStorage.
5. **Chance per step** — `%` row on the loop grid. Click 100→75→50→25→0 or drag. Miss = silence. Bounce re-rolls.
6. **Automation** — lanes under the loop. Ramp speed or pitch over 1–16 bars.

## Ditched

- **History strip** — Ctrl+Z is enough. Do not add an inspire chip row.

## Bigger, still on-mission

- **Clip sequencer** — hold this note 4 times, jump, more than a two-handle ramp.
- **Gestures** — hold a key for 32nd stutter or reverse; release = back to the loop.
- **MIDI / QWERTY pads** — play individual sung notes; export a MIDI clip + the sample for Simpler.
- **Harmony layer** — dry + 3rd + 5th in key, mix slider (ooh/aah beds).
- **Formant stay** — pitch the note, keep the vowel.

## Later / maybe never

- Ableton Link (lock BPM to Live)
- Max for Live player
- Stem split (only if you drop full tracks)
- VST
- AI voice conversion

## Still don’t copy

Full FX matrices, subscription catalogs, “make a new singer.”

## Suggested order

Gestures → MIDI if you still want it in the box.
