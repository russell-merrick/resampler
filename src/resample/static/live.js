/** Live chop engine.
 *  Speed = step rate. Pattern = idea (leap, reverse, …).
 *  Length/offset = which bars of the sample feed the note pool.
 *  Loop bars = how long the idea is. Pitch = in-key detune.
 */

const PATTERNS = [
  { id: "1/1", label: "whole", beats: 4 },
  { id: "1/2", label: "half", beats: 2 },
  { id: "1/4", label: "quarter", beats: 1 },
  { id: "1/8", label: "8th", beats: 0.5 },
  { id: "1/8t", label: "8th trip", beats: 1 / 3 },
  { id: "1/16", label: "16th", beats: 0.25 },
  { id: "1/16t", label: "16th trip", beats: 1 / 6 },
  { id: "1/32", label: "32nd", beats: 0.125 },
];

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
    build(pool) {
      return [pool[0], pool[0], pool[0], pool[0]];
    },
  },
  "stutter-jump": {
    min: 2,
    label: "stutter then jump",
    build(pool) {
      const a = pool[0];
      const rest = pool.slice(1);
      return [a, a, a, a, ...rest, ...rest];
    },
  },
  leap: {
    min: 3,
    label: "leaps",
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
    build(pool) {
      return [pool[0], pool[0], pool[0], pool[0], ...pool];
    },
  },
  reverse: {
    min: 2,
    label: "reverse melody",
    build(pool) {
      return pool.slice().reverse();
    },
  },
  "ping-pong": {
    min: 3,
    label: "ping pong",
    build(pool) {
      return pool.concat(pool.slice(1, -1).reverse());
    },
  },
  scatter: {
    min: 2,
    label: "scatter",
    build(pool) {
      const once = shuffle(pool);
      return once.concat(shuffle(pool));
    },
  },
  "call-response": {
    min: 3,
    label: "call / response",
    build(pool) {
      const mid = Math.max(1, Math.floor(pool.length / 2));
      const a = pool.slice(0, mid);
      const b = pool.slice(mid);
      return [...a, ...a, ...b, ...b];
    },
  },
};

const MOTION_LANES = [
  { id: "speed", label: "SPEED" },
  { id: "pitch", label: "PITCH" },
];

function emptyMotion() {
  return {
    bars: 4,
    loop: true,
    lanes: Object.fromEntries(MOTION_LANES.map((spec) => [spec.id, { on: false, a: null, b: null }])),
  };
}

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
      patternIndex: 5,
      lengthBars: 2,
      offsetBars: 0,
      loopBars: 1,
      pitch: 0,
      reverse: false,
      through: false,
      swing: 0,
    };
    this.notes = [];
    this.sequence = [];
    this.chance = [];
    this.lastHit = true;
    this.idea = "lock";
    this.mode = "notes";
    this.motion = emptyMotion();
    this.playOrigin = 0;
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

  pattern() {
    return PATTERNS[this.params.patternIndex] || PATTERNS[5];
  }

  sliceInfo() {
    if (!this.buffer) return { sec: 0, frames: 1, count: 0 };
    const sec = (this.pattern().beats * 60) / Math.max(this.params.bpm, 1);
    const frames = Math.max(1, Math.floor(sec * this.buffer.sampleRate));
    const count = Math.max(1, Math.floor(this.buffer.length / frames));
    return { sec, frames, count };
  }

  setNotes(notes) {
    this.notes = Array.isArray(notes) ? notes : [];
    if (this.notes.length >= 2) {
      this.mode = "notes";
      this.inspire();
    } else {
      this.mode = "grid";
      this.sequence = [];
      this.idea = "";
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
    const beats = this.pattern().beats;
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

  stepChance(step) {
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

  motionPhase(elapsedSec) {
    const total = Math.max(1e-6, (this.motion.bars || 4) * this.secPerBar());
    if (this.motion.loop) return (((elapsedSec % total) + total) % total) / total;
    return Math.min(1, Math.max(0, elapsedSec / total));
  }

  motionActive() {
    return MOTION_LANES.some((spec) => this.motion.lanes[spec.id]?.on);
  }

  armLane(id, on, current) {
    const lane = this.motion.lanes[id];
    if (!lane) return;
    lane.on = Boolean(on);
    if (lane.on && (lane.a == null || lane.b == null)) {
      const v = Number(current);
      lane.a = Number.isFinite(v) ? v : 0;
      lane.b = lane.a;
    }
  }

  setLaneHandle(id, which, value) {
    const lane = this.motion.lanes[id];
    if (!lane) return;
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    lane[which] = v;
    if (!lane.on) lane.on = true;
  }

  applyMotionAt(elapsedSec) {
    if (!this.motionActive()) return this.motionPhase(elapsedSec);
    const t = this.motionPhase(elapsedSec);
    const locks = window.RESAMPLE_LOCKS || {};
    for (const spec of MOTION_LANES) {
      const lane = this.motion.lanes[spec.id];
      if (!lane || !lane.on || locks[spec.id]) continue;
      const a = lane.a == null ? 0 : lane.a;
      const b = lane.b == null ? a : lane.b;
      this.writeLane(spec.id, a + (b - a) * t);
    }
    return t;
  }

  writeLane(id, raw) {
    if (id === "speed") {
      this.params.patternIndex = clampRound(raw, 0, PATTERNS.length - 1);
      return;
    }
    if (id === "pattern") {
      const ids = window.RESAMPLE_IDEA_IDS || [];
      const ideaId = ids[clampRound(raw, 0, Math.max(ids.length - 1, 0))];
      if (ideaId && ideaId !== this.idea) this.applyIdea(ideaId);
      return;
    }
    if (id === "length") {
      const bars = (window.RESAMPLE_LENGTH_BARS || [1, 2, 4, 8])[clampRound(raw, 0, 3)];
      if (bars != null && bars !== this.params.lengthBars) {
        this.params.lengthBars = bars;
        if (this.mode === "notes") this.rebuildSequence();
      }
      return;
    }
    if (id === "offset") {
      const off = clampRound(raw, 0, this.maxOffsetBars());
      if (off !== this.params.offsetBars) {
        this.params.offsetBars = off;
        if (this.mode === "notes") this.rebuildSequence();
      }
      return;
    }
    if (id === "pitch") {
      const i = clampRound(raw, 0, Math.max(this.ladder.length - 1, 0));
      this.params.pitch = this.ladder[i] ?? this.params.pitch;
      return;
    }
    if (id === "swing") {
      this.params.swing = Math.min(0.66, Math.max(0, raw / 100));
      return;
    }
    if (id === "reverse") this.params.reverse = raw >= 0.5;
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
    if (!pool.length) {
      this.sequence = [];
      this.chance = [];
      return;
    }
    this.applyIdea(this.idea === "manual" ? "manual" : this.idea || "lock");
  }

  applyIdea(id) {
    const pool = this.notePool();
    if (!pool.length) {
      this.sequence = [];
      this.chance = [];
      return;
    }
    if (id === "manual") {
      const allowed = new Set(pool);
      this.sequence = this.fitSequence(this.sequence.filter((i) => allowed.has(i)));
      this.chance = this.fitChance();
      this.idea = "manual";
      return;
    }
    const spec = IDEAS[id];
    const use = spec && spec.min <= pool.length ? id : "lock";
    this.idea = use;
    this.sequence = this.fitSequence(IDEAS[use].build(pool));
    this.chance = this.fitChance();
  }

  setStep(step, noteIndex) {
    if (!this.notes[noteIndex]) return;
    if (!this.sequence.length) this.sequence = this.fitSequence();
    const i = ((step % this.sequence.length) + this.sequence.length) % this.sequence.length;
    this.sequence[i] = noteIndex;
    this.idea = "manual";
    if (this.onTick) this.onTick(this.status());
  }

  inspire(preferred) {
    const pool = this.notePool();
    if (!pool.length) {
      this.sequence = [];
      this.chance = [];
      this.idea = "";
      return this.status();
    }
    const ideas = Object.keys(IDEAS).filter((id) => IDEAS[id].min <= pool.length);
    const id = preferred && ideas.includes(preferred) ? preferred : ideas[Math.floor(Math.random() * ideas.length)] || "lock";
    this.applyIdea(id);
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
    const poolChanged =
      ("lengthBars" in partial && partial.lengthBars !== this.params.lengthBars) ||
      ("offsetBars" in partial && partial.offsetBars !== this.params.offsetBars);
    const loopChanged =
      ("loopBars" in partial && partial.loopBars !== this.params.loopBars) ||
      ("patternIndex" in partial && partial.patternIndex !== this.params.patternIndex);
    const ideaChanged = "ideaId" in partial && partial.ideaId && partial.ideaId !== this.idea;
    Object.assign(this.params, partial);
    const maxOff = this.maxOffsetBars();
    if (this.params.offsetBars > maxOff) this.params.offsetBars = maxOff;
    if (this.mode === "notes") {
      if (ideaChanged) this.applyIdea(partial.ideaId);
      else if (poolChanged) this.rebuildSequence();
      else if (loopChanged && this.sequence.length) {
        this.sequence = this.fitSequence();
        this.chance = this.fitChance();
      }
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

  status() {
    const info = this.sliceInfo();
    const index = this.playing ? this.pickSlice(Math.max(this.step - 1, 0)) : this.pickSlice(0);
    const usingNotes = this.mode === "notes" && this.notes.length > 0;
    return {
      playing: this.playing,
      pattern: this.pattern(),
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
      patternIndex: this.params.patternIndex,
      motion: this.motion,
      motionT: this.playing && this.ctx ? this.motionPhase(this.ctx.currentTime - this.playOrigin) : 0,
    };
  }

  async play() {
    if (!this.buffer) return;
    await this.ensureCtx();
    this.stopVoices();
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.playOrigin = this.nextTime;
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
    for (const voice of this.voices) {
      try {
        voice.src.stop();
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
      this.applyMotionAt(this.nextTime - this.playOrigin);
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
    const index = this.pickSlice(step);
    if (Math.random() >= this.stepChance(step)) {
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
      dur = this.params.through ? Math.min(info.sec, remain) : Math.min(info.sec, noteDur);
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
    };
    let t = 0;
    let step = 0;
    try {
      while (t < duration - 1e-4) {
        this.applyMotionAt(t);
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

window.RESAMPLE_MOTION_LANES = MOTION_LANES;
window.RESAMPLE_LENGTH_BARS = [1, 2, 4, 8];
window.RESAMPLE_PATTERNS = PATTERNS;
window.RESAMPLE_IDEA_IDS = Object.keys(IDEAS);
window.RESAMPLE_IDEAS = IDEAS;
window.RESAMPLE_PITCH_CLASSES = PITCH_CLASSES;
window.RESAMPLE_SCALES = Object.keys(SCALES);
window.ResampleLive = new LiveSlicer();
