/** Live chop engine.
 *  Note length = step size (half → 32nd). Pattern = idea (leap, reverse, …).
 *  Clip width/offset = which bars of the sample feed the note pool.
 *  Loop bars = how long the idea is. Pitch = in-key detune.
 *  Density = how many steps fire. Rolled when the loop is generated.
 */

const NOTE_LENGTHS = [
  { id: "1/1", label: "whole", beats: 4, hidden: true },
  { id: "1/2", label: "half", beats: 2 },
  { id: "1/4", label: "quarter", beats: 1 },
  { id: "1/8", label: "8th", beats: 0.5 },
  { id: "1/8t", label: "8th trip", beats: 1 / 3, triplet: true },
  { id: "1/16", label: "16th", beats: 0.25 },
  { id: "1/16t", label: "16th trip", beats: 1 / 6, triplet: true },
  { id: "1/32", label: "32nd", beats: 0.125 },
];

function allowedSpeedIndices() {
  return NOTE_LENGTHS.map((_, i) => i).filter((i) => {
    const spec = NOTE_LENGTHS[i];
    if (spec.hidden) return false;
    return window.RESAMPLE_ALLOW_TRIPLETS || !spec.triplet;
  });
}

function nearestAllowedSpeed(index) {
  const allowed = allowedSpeedIndices();
  const n = clampRound(index, 0, NOTE_LENGTHS.length - 1);
  if (allowed.includes(n)) return n;
  const target = (NOTE_LENGTHS[n] || NOTE_LENGTHS[5]).beats;
  let best = allowed[0] ?? 5;
  let bestD = Infinity;
  for (const i of allowed) {
    const d = Math.abs(NOTE_LENGTHS[i].beats - target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
};

function scaleIntervals(mode, minSt = -12, maxSt = 12) {
  const degrees = new Set(SCALES[mode] || SCALES.minor);
  const out = [];
  for (let st = minSt; st <= maxSt; st += 1) {
    const pc = ((st % 12) + 12) % 12;
    if (degrees.has(pc)) out.push(st);
  }
  return out;
}

function noteName(root, semitones) {
  const base = PITCH_CLASSES.indexOf(root);
  if (base < 0) return root;
  return PITCH_CLASSES[(base + ((semitones % 12) + 12)) % 12];
}

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const IDEAS = {
  lock: {
    min: 1,
    label: "lock",
    tick: "lock",
    build(pool) {
      return [pool[0], pool[0], pool[0], pool[0]];
    },
  },
  "stutter-jump": {
    min: 2,
    label: "stutter then jump",
    tick: "jump",
    build(pool) {
      const a = pool[0];
      const rest = pool.slice(1);
      return [a, a, a, a, ...rest, ...rest];
    },
  },
  leap: {
    min: 3,
    label: "leaps",
    tick: "leap",
    build(pool) {
      const seq = [pool[0]];
      for (let i = 1; i < 12; i += 1) {
        const last = seq[seq.length - 1];
        const far = pool.filter((n) => Math.abs(n - last) > 1);
        const pick = (far.length ? far : pool)[Math.floor(Math.random() * (far.length || pool.length))];
        seq.push(pick);
      }
      return seq;
    },
  },
  "hold-run": {
    min: 2,
    label: "hold then run",
    tick: "hold",
    build(pool) {
      return [pool[0], pool[0], pool[0], pool[0], ...pool];
    },
  },
  reverse: {
    min: 2,
    label: "reverse melody",
    tick: "rev",
    build(pool) {
      return pool.slice().reverse();
    },
  },
  "ping-pong": {
    min: 3,
    label: "ping pong",
    tick: "ping",
    build(pool) {
      return pool.concat(pool.slice(1, -1).reverse());
    },
  },
  scatter: {
    min: 2,
    label: "scatter",
    tick: "scat",
    build(pool) {
      const once = shuffle(pool);
      return once.concat(shuffle(pool));
    },
  },
  "call-response": {
    min: 3,
    label: "call / response",
    tick: "call",
    build(pool) {
      const mid = Math.max(1, Math.floor(pool.length / 2));
      const a = pool.slice(0, mid);
      const b = pool.slice(mid);
      return [...a, ...a, ...b, ...b];
    },
  },
};

function clampRound(raw, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(raw) || 0)));
}

class LiveSlicer {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffer = null;
    this.reverseBuffer = null;
    this.peaks = [];
    this.playing = false;
    this.timer = null;
    this.nextTime = 0;
    this.step = 0;
    this.voices = [];
    this.onTick = null;
    this.keyRoot = "C";
    this.keyMode = "minor";
    this.ladder = scaleIntervals("minor");
    this.params = {
      bpm: 128,
      speedIndex: 5,
      lengthBars: 2,
      offsetBars: 0,
      loopBars: 1,
      pitch: 0,
      reverse: false,
      through: false,
      swing: 0,
      density: 1,
    };
    this.notes = [];
    this.sequence = [];
    this.chance = [];
    this.spans = [];
    this.densityMask = [];
    this.lastHit = true;
    this.idea = "lock";
    this.mode = "notes";
    this.grain = null;
  }

  setKey(root, mode) {
    this.keyRoot = PITCH_CLASSES.includes(root) ? root : "C";
    this.keyMode = SCALES[mode] ? mode : "minor";
    this.ladder = scaleIntervals(this.keyMode);
    if (!this.ladder.includes(this.params.pitch)) {
      this.params.pitch = 0;
    }
  }

  noteLength() {
    return NOTE_LENGTHS[this.params.speedIndex] || NOTE_LENGTHS[5];
  }

  sliceInfo() {
    if (!this.buffer) return { sec: 0, frames: 1, count: 0 };
    const sec = (this.noteLength().beats * 60) / Math.max(this.params.bpm, 1);
    const frames = Math.max(1, Math.floor(sec * this.buffer.sampleRate));
    const count = Math.max(1, Math.floor(this.buffer.length / frames));
    return { sec, frames, count };
  }

  setNotes(notes) {
    this.notes = Array.isArray(notes) ? notes : [];
    if (this.notes.length >= 2) {
      this.mode = "notes";
      this.resample();
    } else {
      this.mode = "grid";
      this.sequence = [];
      this.spans = [];
      this.idea = "";
      this.fitDensityMask({ reroll: true });
    }
  }

  secPerBar() {
    return (4 * 60) / Math.max(this.params.bpm, 1);
  }

  sampleBars() {
    if (!this.buffer) return 0;
    return this.buffer.duration / this.secPerBar();
  }

  windowSec() {
    const bar = this.secPerBar();
    const start = this.params.offsetBars * bar;
    const rawEnd = start + this.params.lengthBars * bar;
    const dur = this.buffer ? this.buffer.duration : rawEnd;
    return { start, end: Math.min(rawEnd, dur) };
  }

  maxOffsetBars() {
    const total = this.sampleBars();
    if (total <= 0) return 0;
    return Math.max(0, Math.floor(Math.max(total - 1, 0)));
  }

  loopSteps() {
    const beats = this.noteLength().beats;
    return Math.max(1, Math.round((this.params.loopBars * 4) / beats));
  }

  fitSequence(seq = this.sequence) {
    const n = this.loopSteps();
    const pool = this.notePool();
    const src = seq.length ? seq : pool.length ? pool : [0];
    const out = [];
    while (out.length < n) out.push(...src);
    return out.slice(0, n);
  }

  scaleGrid(src, n, how = "first") {
    const s = Array.isArray(src) && src.length ? src : [];
    if (!n) return [];
    if (!s.length) return Array(n).fill(how === "mask" ? 1 : how === "first" ? 1 : 0);
    if (s.length === n) return s.slice();
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const a = Math.floor((i * s.length) / n);
      const b = Math.max(a + 1, Math.floor(((i + 1) * s.length) / n));
      if (how === "mask") {
        let on = 0;
        for (let j = a; j < b && j < s.length; j += 1) if (s[j]) on = 1;
        out.push(on);
      } else {
        out.push(s[Math.min(s.length - 1, a)]);
      }
    }
    return out;
  }

  scaleSpans(oldN, n) {
    const spans = this.spans.length === oldN ? this.spans : this.fitSpans(this.spans);
    const events = [];
    for (let i = 0; i < oldN; i += 1) {
      const len = spans[i] || 0;
      if (len >= 1) events.push({ start: i, length: len, note: this.sequence[i] });
    }
    if (!events.length) return Array(n).fill(1);
    const scale = n / oldN;
    const out = Array(n).fill(0);
    const seq = Array(n).fill(this.sequence[0] ?? 0);
    for (const ev of events) {
      let start = Math.round(ev.start * scale);
      let length = Math.max(1, Math.round(ev.length * scale));
      if (start >= n) start = n - 1;
      if (start + length > n) length = n - start;
      out[start] = length;
      for (let k = 0; k < length; k += 1) {
        seq[start + k] = ev.note ?? this.sequence[ev.start] ?? seq[start];
        if (k > 0) out[start + k] = 0;
      }
    }
    this.sequence = seq;
    return this.fitSpans(out);
  }

  retargetGrid(oldSteps) {
    const n = this.loopSteps();
    if (!oldSteps || oldSteps < 1 || n === oldSteps) {
      this.spans = this.fitSpans();
      return;
    }
    const hadHolds = (this.spans || []).some((v) => v > 1);
    this.chance = this.scaleGrid(this.chance.length ? this.chance : Array(oldSteps).fill(1), n, "first");
    this.densityMask = this.scaleGrid(
      this.densityMask.length ? this.densityMask : Array(oldSteps).fill(1),
      n,
      "mask",
    );
    if (hadHolds) {
      this.spans = this.scaleSpans(oldSteps, n);
    } else {
      this.sequence = this.scaleGrid(this.sequence, n, "first");
      this.spans = Array(n).fill(1);
    }
    this.syncDensityFromMask();
  }

  fitChance(ch = this.chance) {
    const n = this.loopSteps();
    const src = Array.isArray(ch) && ch.length ? ch : [];
    if (!src.length) return Array(n).fill(1);
    const out = [];
    while (out.length < n) out.push(...src);
    return out.slice(0, n).map((v) => {
      const x = Number(v);
      if (!Number.isFinite(x)) return 1;
      return Math.min(1, Math.max(0, x));
    });
  }

  fitSpans(src = this.spans) {
    const n = this.loopSteps();
    const base = Array.isArray(src) && src.length ? src : [];
    let out;
    if (!base.length) {
      out = Array(n).fill(1);
    } else {
      out = [];
      while (out.length < n) out.push(...base);
      out = out.slice(0, n).map((v) => Math.max(0, Math.floor(Number(v) || 0)));
    }
    for (let i = 0; i < n; i += 1) {
      if (out[i] < 1) continue;
      out[i] = Math.min(out[i], n - i);
      for (let k = 1; k < out[i]; k += 1) out[i + k] = 0;
    }
    return out;
  }

  spanCover(step) {
    const spans = this.spans.length === this.loopSteps() ? this.spans : this.fitSpans();
    const n = spans.length;
    if (!n) return null;
    const i = ((step % n) + n) % n;
    for (let s = i; s >= 0; s -= 1) {
      const len = spans[s] || 0;
      if (len >= 1 && s + len > i) {
        return { start: s, length: len, note: this.sequence[s] };
      }
    }
    return null;
  }

  setSpan(start, length, noteIndex) {
    if (!this.sequence.length) this.sequence = this.fitSequence();
    const n = this.loopSteps();
    this.spans = this.fitSpans();
    if (this.densityMask.length !== n) this.fitDensityMask();
    const s = Math.min(n - 1, Math.max(0, Number(start) || 0));
    const len = Math.min(n - s, Math.max(1, Math.round(Number(length) || 1)));
    if (noteIndex != null && this.notes[noteIndex]) this.sequence[s] = noteIndex;
    for (let i = 0; i < n; i += 1) {
      const h = this.spans[i] || 0;
      if (h < 1) continue;
      const a = i;
      const b = i + h;
      if (b <= s || a >= s + len) continue;
      if (a < s) this.spans[i] = s - a;
      else this.spans[i] = 0;
    }
    this.spans[s] = len;
    for (let k = 1; k < len; k += 1) this.spans[s + k] = 0;
    if (this.densityMask.length === n) {
      this.densityMask[s] = 1;
      for (let k = 1; k < len; k += 1) this.densityMask[s + k] = 0;
      this.syncDensityFromMask();
    }
    this.idea = "manual";
    if (this.onTick) this.onTick(this.status());
  }

  clearSpan(start) {
    const n = this.loopSteps();
    this.spans = this.fitSpans();
    const s = ((start % n) + n) % n;
    this.spans[s] = 0;
    if (this.onTick) this.onTick(this.status());
  }

  densityKeep(n = this.loopSteps(), density = this.params.density) {
    const steps = Math.max(1, Number(n) || 1);
    const d = Math.min(1, Math.max(0, Number(density) || 0));
    if (steps <= 1 || d >= 0.999) return steps;
    return Math.max(1, Math.floor(steps * d + 1e-9));
  }

  densitySlots(n = this.loopSteps()) {
    const slots = [];
    for (let i = 0; i < n; i += 1) {
      if (!this.spans.length || (this.spans[i] || 0) >= 1) slots.push(i);
    }
    return slots.length ? slots : Array.from({ length: n }, (_, i) => i);
  }

  nudgeDensity(keep) {
    const n = this.densityMask.length;
    const slots = this.densitySlots(n);
    const target = Math.min(slots.length, Math.max(0, keep));
    if (target >= slots.length) {
      for (const i of slots) this.densityMask[i] = 1;
      return;
    }
    const onIdx = slots.filter((i) => this.densityMask[i]);
    const offIdx = slots.filter((i) => !this.densityMask[i]);
    if (onIdx.length === target) return;
    if (onIdx.length > target) {
      for (const i of shuffle(onIdx).slice(0, onIdx.length - target)) this.densityMask[i] = 0;
      return;
    }
    for (const i of shuffle(offIdx).slice(0, target - onIdx.length)) this.densityMask[i] = 1;
  }

  fitDensityMask({ reroll = false, mask = null } = {}) {
    const n = this.loopSteps();
    if (mask) {
      const src = Array.isArray(mask) ? mask.map((v) => (Number(v) > 0 ? 1 : 0)) : [];
      if (!src.length) {
        this.densityMask = Array(n).fill(1);
        return this.densityMask;
      }
      const out = [];
      while (out.length < n) out.push(...src);
      this.densityMask = out.slice(0, n);
      return this.densityMask;
    }
    if (this.densityMask.length !== n) {
      this.densityMask = this.densityMask.length
        ? this.scaleGrid(this.densityMask, n, "mask")
        : Array(n).fill(1);
    }
    const slots = this.densitySlots(n);
    const keep = this.densityKeep(slots.length);
    if (reroll) {
      if (keep >= slots.length) {
        this.densityMask = Array(n).fill(0);
        for (const i of slots) this.densityMask[i] = 1;
        return this.densityMask;
      }
      const chosen = new Set(shuffle(slots.slice()).slice(0, keep));
      this.densityMask = Array(n).fill(0);
      for (const i of slots) this.densityMask[i] = chosen.has(i) ? 1 : 0;
      return this.densityMask;
    }
    this.nudgeDensity(keep);
    return this.densityMask;
  }

  rerollDensity() {
    this.fitDensityMask({ reroll: true });
    if (this.onTick) this.onTick(this.status());
    return this.densityMask;
  }

  stepChance(step) {
    const mask = this.densityMask.length === this.loopSteps() ? this.densityMask : this.fitDensityMask();
    if (mask.length) {
      const gated = mask[((step % mask.length) + mask.length) % mask.length];
      if (!gated) return 0;
    }
    const ch = this.chance.length ? this.chance : this.fitChance();
    if (!ch.length) return 1;
    return ch[((step % ch.length) + ch.length) % ch.length];
  }

  setChance(step, value) {
    this.chance = this.fitChance();
    if (!this.chance.length) return;
    const i = ((step % this.chance.length) + this.chance.length) % this.chance.length;
    this.chance[i] = Math.min(1, Math.max(0, Number(value) || 0));
    if (this.onTick) this.onTick(this.status());
  }

  cycleChance(step) {
    const ladder = [1, 0.75, 0.5, 0.25, 0];
    const cur = this.stepChance(step);
    let idx = ladder.findIndex((v) => Math.abs(v - cur) < 0.03);
    if (idx < 0) idx = 0;
    this.setChance(step, ladder[(idx + 1) % ladder.length]);
  }

  notePool() {
    if (!this.notes.length) return [];
    const { start, end } = this.windowSec();
    return this.notes
      .map((_, i) => i)
      .filter((i) => {
        const n = this.notes[i];
        return n.end > start && n.start < end;
      });
  }

  rebuildSequence() {
    const pool = this.notePool();
    if (this.idea === "manual") {
      this.chance = this.fitChance();
      this.spans = this.fitSpans();
      return;
    }
    if (!pool.length) {
      this.sequence = [];
      this.chance = [];
      this.spans = [];
      return;
    }
    this.applyIdea(this.idea || "lock");
  }

  applyIdea(id) {
    if (id === "manual") {
      this.sequence = this.fitSequence(this.sequence);
      this.chance = this.fitChance();
      this.spans = this.fitSpans();
      this.idea = "manual";
      return;
    }
    const pool = this.notePool();
    if (!pool.length) {
      this.sequence = [];
      this.chance = [];
      this.spans = [];
      return;
    }
    const spec = IDEAS[id];
    const use = spec && spec.min <= pool.length ? id : "lock";
    this.idea = use;
    this.sequence = this.fitSequence(IDEAS[use].build(pool));
    this.chance = this.fitChance();
    this.spans = Array(this.loopSteps()).fill(1);
  }

  syncDensityFromMask() {
    const n = this.densityMask.length;
    if (!n) {
      this.params.density = 1;
      return;
    }
    const on = this.densityMask.reduce((a, v) => a + (v ? 1 : 0), 0);
    if (on <= 0) {
      this.params.density = 0.1;
      return;
    }
    this.params.density = Math.max(0.1, Math.min(1, Math.round((on / n) * 10) / 10));
  }

  setStepGate(step, on) {
    const n = this.loopSteps();
    if (this.densityMask.length !== n) this.fitDensityMask();
    if (!this.densityMask.length) return;
    const i = ((step % this.densityMask.length) + this.densityMask.length) % this.densityMask.length;
    this.densityMask[i] = on ? 1 : 0;
    this.syncDensityFromMask();
    if (this.onTick) this.onTick(this.status());
  }

  setStep(step, noteIndex) {
    if (!this.notes[noteIndex]) return;
    if (!this.sequence.length) this.sequence = this.fitSequence();
    this.spans = this.fitSpans();
    const cover = this.spanCover(step);
    const n = this.loopSteps();
    if (this.densityMask.length !== n) this.fitDensityMask();
    const start = cover ? cover.start : step;
    const enabled = !this.densityMask.length || this.densityMask[start] !== 0;
    if (cover && cover.note === noteIndex && enabled) {
      this.clearSpan(cover.start);
      this.setStepGate(cover.start, false);
      return;
    }
    this.setSpan(step, 1, noteIndex);
  }

  resample(preferred) {
    const pool = this.notePool();
    if (!pool.length) {
      this.sequence = [];
      this.chance = [];
      this.spans = [];
      this.idea = "";
      return this.status();
    }
    const ideas = Object.keys(IDEAS).filter((id) => IDEAS[id].min <= pool.length);
    const id = preferred && ideas.includes(preferred) ? preferred : ideas[Math.floor(Math.random() * ideas.length)] || "lock";
    this.applyIdea(id);
    this.fitDensityMask({ reroll: true });
    this.step = 0;
    if (this.onTick) this.onTick(this.status());
    return this.status();
  }

  pickSlice(step) {
    if (this.mode === "notes" && this.notes.length) {
      const pool = this.notePool();
      if (!pool.length) return 0;
      const allowed = new Set(pool);
      const seq = this.sequence.filter((i) => allowed.has(i));
      const use = seq.length ? seq : pool;
      return use[step % use.length];
    }
    const info = this.sliceInfo();
    if (info.count <= 1) return 0;
    const { start, end } = this.windowSec();
    const first = Math.max(0, Math.floor(start / info.sec));
    const last = Math.min(info.count - 1, Math.max(first, Math.ceil(end / info.sec) - 1));
    const span = last - first + 1;
    return first + (step % span);
  }

  async ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  async load(url) {
    await this.ensureCtx();
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not load source audio");
    const raw = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(raw.slice(0));
    this.reverseBuffer = flipBuffer(this.buffer);
    this.peaks = buildPeaks(this.buffer);
    this.step = 0;
    return this.sliceInfo();
  }

  set(partial) {
    const prevDensity = this.params.density;
    const prevSteps = this.loopSteps();
    const prevSpeed = this.params.speedIndex;
    const ideaId = partial.ideaId;
    const forceIdea = Boolean(partial.forceIdea);
    const poolChanged =
      ("lengthBars" in partial && partial.lengthBars !== this.params.lengthBars) ||
      ("offsetBars" in partial && partial.offsetBars !== this.params.offsetBars);
    const loopChanged =
      "loopBars" in partial && Number(partial.loopBars) !== this.params.loopBars;
    const next = { ...partial };
    if ("patternIndex" in next && !("speedIndex" in next)) next.speedIndex = next.patternIndex;
    delete next.patternIndex;
    delete next.ideaId;
    delete next.forceIdea;
    Object.assign(this.params, next);
    this.params.speedIndex = nearestAllowedSpeed(this.params.speedIndex);
    const speedChanged = this.params.speedIndex !== prevSpeed;
    const maxOff = this.maxOffsetBars();
    if (this.params.offsetBars > maxOff) this.params.offsetBars = maxOff;
    if (this.mode === "notes") {
      if (forceIdea && ideaId) this.applyIdea(ideaId);
      else if (ideaId && ideaId !== this.idea && this.idea !== "manual") this.applyIdea(ideaId);
      else if (poolChanged) this.rebuildSequence();
      else if (speedChanged && this.sequence.length) this.retargetGrid(prevSteps);
      else if (loopChanged && this.sequence.length) {
        this.sequence = this.fitSequence();
        this.chance = this.fitChance();
        this.spans = this.fitSpans();
      }
    }
    if (poolChanged) this.seekWindow();
    const density = Math.min(1, Math.max(0.1, Number(this.params.density) || 1));
    this.params.density = Math.round(density * 10) / 10;
    const stepsNow = this.loopSteps();
    const densityChanged = "density" in partial && Number(partial.density) !== Number(prevDensity);
    if (!speedChanged && (densityChanged || stepsNow !== prevSteps || this.densityMask.length !== stepsNow)) {
      this.fitDensityMask({ reroll: false });
    }
    const detune = this.params.pitch * 100;
    if (this.ctx) {
      for (const voice of this.voices) {
        try {
          voice.src.detune.setTargetAtTime(detune, this.ctx.currentTime, 0.02);
        } catch {
          /* source already stopped */
        }
      }
    }
    if (this.onTick) this.onTick(this.status());
  }

  seekWindow() {
    this.grain = null;
    if (this.playing && this.ctx) {
      this.stopVoices();
      this.nextTime = this.ctx.currentTime;
    }
  }

  windowSlice() {
    if (this.mode === "notes" && this.notes.length) {
      const pool = this.notePool();
      if (pool.length) return pool[0];
    }
    return this.pickSlice(0);
  }

  status() {
    const info = this.sliceInfo();
    const index = this.playing ? this.pickSlice(Math.max(this.step - 1, 0)) : this.windowSlice();
    const usingNotes = this.mode === "notes" && this.notes.length > 0;
    return {
      playing: this.playing,
      noteLength: this.noteLength(),
      slices: usingNotes ? this.notes.length : info.count,
      slice: index,
      ready: Boolean(this.buffer),
      pitch: this.params.pitch,
      pitchNote: noteName(this.keyRoot, this.params.pitch),
      keyRoot: this.keyRoot,
      keyMode: this.keyMode,
      ladder: this.ladder,
      mode: this.mode,
      idea: this.idea,
      notes: this.notes,
      sequence: this.sequence,
      chance: this.fitChance(),
      spans: this.fitSpans(),
      density: this.params.density,
      densityMask: this.densityMask.slice(),
      lastHit: this.lastHit,
      pool: this.notePool(),
      stepIndex: this.playing ? Math.max(this.step - 1, 0) : 0,
      lengthBars: this.params.lengthBars,
      offsetBars: this.params.offsetBars,
      loopBars: this.params.loopBars,
      loopSteps: this.loopSteps(),
      reverse: this.params.reverse,
      through: this.params.through,
      swing: this.params.swing,
      sampleBars: this.sampleBars(),
      maxOffsetBars: this.maxOffsetBars(),
      speedIndex: this.params.speedIndex,
    };
  }

  async play() {
    if (!this.buffer) return;
    await this.ensureCtx();
    this.stopVoices();
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.scheduler(), 20);
    this.scheduler();
  }

  stop() {
    this.playing = false;
    this.grain = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopVoices();
    if (this.onTick) this.onTick(this.status());
  }

  stopVoices() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    const fade = 0.005;
    for (const voice of this.voices) {
      try {
        const g = voice.env && voice.env.gain;
        if (g && this.ctx) {
          if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
          else {
            g.cancelScheduledValues(now);
            g.setValueAtTime(g.value, now);
          }
          g.linearRampToValueAtTime(0, now + fade);
          voice.src.stop(now + fade + 0.02);
        } else {
          voice.src.stop();
        }
      } catch {
        /* already done */
      }
    }
    this.voices = [];
  }

  scheduler() {
    if (!this.playing || !this.ctx || !this.buffer) return;
    const horizon = this.ctx.currentTime + 0.12;
    while (this.nextTime < horizon) {
      const when = this.nextTime + this.swingDelay(this.step);
      this.scheduleGrain(this.step, when, { ctx: this.ctx, dest: this.master, live: true });
      this.nextTime += this.sliceInfo().sec;
      this.step += 1;
    }
    if (this.onTick) this.onTick(this.status());
  }

  swingDelay(step) {
    if (!this.params.swing || step % 2 === 0) return 0;
    return this.params.swing * 0.5 * this.sliceInfo().sec;
  }

  scheduleGrain(step, time, { ctx, dest, live }) {
    const info = this.sliceInfo();
    const spans = this.mode === "notes" ? this.fitSpans() : [];
    const n = spans.length;
    const si = n ? ((step % n) + n) % n : 0;
    const noteSteps = n ? spans[si] || 0 : 1;
    if (n && noteSteps < 1) return;
    const index = this.pickSlice(n ? si : step);
    if (Math.random() >= this.stepChance(n ? si : step)) {
      this.lastHit = false;
      if (live && this.onTick) this.onTick({ ...this.status(), slice: index, slices: info.count, missed: true });
      return;
    }
    this.lastHit = true;
    let offsetSec;
    let dur;
    const note = this.mode === "notes" ? this.notes[index] : null;
    if (note) {
      offsetSec = note.start;
      const noteDur = Math.max(0.03, note.end - note.start);
      const remain = Math.max(0.03, this.buffer.duration - offsetSec);
      const want = info.sec * Math.max(1, noteSteps);
      dur = noteSteps > 1 || this.params.through ? Math.min(want, remain) : Math.min(info.sec, noteDur);
    } else {
      const startFrame = index * info.frames;
      const available = this.buffer.length - startFrame;
      if (available < 32) return;
      offsetSec = startFrame / this.buffer.sampleRate;
      dur = Math.min(info.frames, available) / this.buffer.sampleRate;
    }
    const src = ctx.createBufferSource();
    const useRev = this.params.reverse && this.reverseBuffer;
    src.buffer = useRev ? this.reverseBuffer : this.buffer;
    if (useRev) offsetSec = Math.max(0, src.buffer.duration - (offsetSec + dur));
    src.detune.value = this.params.pitch * 100;
    const env = ctx.createGain();
    const attack = Math.min(0.004, dur / 4);
    const release = Math.min(0.01, dur / 3);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(1, time + attack);
    const hold = Math.max(time + attack, time + dur - release);
    env.gain.setValueAtTime(1, hold);
    env.gain.linearRampToValueAtTime(0, time + dur);
    src.connect(env);
    env.connect(dest);
    src.start(time, offsetSec, dur);
    src.stop(time + dur + 0.02);
    if (live) {
      this.grain = { at: time, offsetSec, dur, reverse: Boolean(useRev) };
      const voice = { src, env };
      this.voices.push(voice);
      src.onended = () => {
        this.voices = this.voices.filter((v) => v !== voice);
      };
      if (this.onTick) this.onTick({ ...this.status(), slice: index, slices: info.count });
    }
  }

  async bounce(bars = 4) {
    if (!this.buffer) throw new Error("No sample loaded");
    const sr = this.buffer.sampleRate;
    const ch = this.buffer.numberOfChannels;
    const duration = (Math.max(1, bars) * 4 * 60) / Math.max(this.params.bpm, 1);
    const frames = Math.max(1, Math.ceil(duration * sr));
    const offline = new OfflineAudioContext(ch, frames, sr);
    const dest = offline.createGain();
    dest.gain.value = 0.9;
    dest.connect(offline.destination);
    const saved = {
      params: { ...this.params },
      idea: this.idea,
      sequence: this.sequence.slice(),
      chance: this.chance.slice(),
      spans: this.spans.slice(),
      densityMask: this.densityMask.slice(),
    };
    let t = 0;
    let step = 0;
    try {
      while (t < duration - 1e-4) {
        const grain = this.sliceInfo().sec;
        this.scheduleGrain(step, t + this.swingDelay(step), { ctx: offline, dest, live: false });
        t += grain;
        step += 1;
      }
      return encodeWav(await offline.startRendering());
    } finally {
      Object.assign(this.params, saved.params);
      this.idea = saved.idea;
      this.sequence = saved.sequence;
      this.chance = saved.chance;
      this.spans = saved.spans;
      this.densityMask = saved.densityMask;
    }
  }
}

function flipBuffer(buf) {
  const out = new AudioBuffer({
    length: buf.length,
    numberOfChannels: buf.numberOfChannels,
    sampleRate: buf.sampleRate,
  });
  for (let c = 0; c < buf.numberOfChannels; c += 1) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0, j = src.length - 1; i < src.length; i += 1, j -= 1) dst[i] = src[j];
  }
  return out;
}

function buildPeaks(buf, buckets = 900) {
  const ch = buf.getChannelData(0);
  const block = Math.max(1, Math.floor(ch.length / buckets));
  const peaks = [];
  for (let i = 0; i < buckets; i += 1) {
    let peak = 0;
    const start = i * block;
    const end = Math.min(ch.length, start + block);
    for (let j = start; j < end; j += 1) {
      const a = Math.abs(ch[j]);
      if (a > peak) peak = a;
    }
    peaks.push(peak);
  }
  return peaks;
}

function encodeWav(audio) {
  const ch = audio.numberOfChannels;
  const sr = audio.sampleRate;
  const n = audio.length;
  const dataSize = n * ch * 3;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * ch * 3, true);
  view.setUint16(32, ch * 3, true);
  view.setUint16(34, 24, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  const channels = Array.from({ length: ch }, (_, i) => audio.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < ch; c += 1) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
      view.setUint8(o, v & 0xff);
      view.setUint8(o + 1, (v >> 8) & 0xff);
      view.setUint8(o + 2, (v >> 16) & 0xff);
      o += 3;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

window.RESAMPLE_ALLOW_TRIPLETS = false;
window.allowedSpeedIndices = allowedSpeedIndices;
window.nearestAllowedSpeed = nearestAllowedSpeed;
window.RESAMPLE_LENGTH_BARS = [1, 2, 4, 8];
window.RESAMPLE_NOTE_LENGTHS = NOTE_LENGTHS;
window.RESAMPLE_IDEA_IDS = Object.keys(IDEAS);
window.RESAMPLE_IDEAS = IDEAS;
window.RESAMPLE_PITCH_CLASSES = PITCH_CLASSES;
window.RESAMPLE_SCALES = Object.keys(SCALES);
window.ResampleLive = new LiveSlicer();
