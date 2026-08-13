/** Control star (drag + lock) and pitch×time map. Sequence grid is the loop. */

const STAR_PCS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function canvasGeo(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = canvas.clientHeight || 400;
  if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = cssW / 2;
  const cy = cssH / 2;
  const rMax = Math.min(cssW, cssH) * 0.38;
  const rMin = rMax * 0.18;
  return { ctx, cssW, cssH, cx, cy, rxMin: rMin, ryMin: rMin, rxMax: rMax, ryMax: rMax };
}

function eventXY(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * (canvas.clientWidth || rect.width),
    y: ((ev.clientY - rect.top) / rect.height) * (canvas.clientHeight || rect.height),
  };
}

function polar(cx, cy, rx, ry, turns) {
  const a = turns * Math.PI * 2 - Math.PI / 2;
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
}

function atT(geo, t, turns) {
  const u = Math.min(1, Math.max(0, t));
  const rx = geo.rxMin + u * (geo.rxMax - geo.rxMin);
  const ry = geo.ryMin + u * (geo.ryMax - geo.ryMin);
  return polar(geo.cx, geo.cy, rx, ry, turns);
}

function noteT(note, st) {
  const engine = window.ResampleLive;
  const dur = Math.max(st.sampleBars * ((4 * 60) / Math.max(engine.params.bpm, 1)), 0.001);
  return Math.min(1, Math.max(0, note.start / dur));
}

function starPositions(st, geo) {
  return st.notes.map((note, i) => {
    const pc = STAR_PCS.indexOf(note.pc);
    const [x, y] = atT(geo, noteT(note, st), (pc < 0 ? 0 : pc) / 12);
    return { i, x, y, note, pc: pc < 0 ? 0 : pc };
  });
}

function drawStarChart(st) {
  const canvas = document.getElementById("star");
  if (!canvas) return [];
  const geo = canvasGeo(canvas);
  const { ctx, cssW, cssH, cx, cy, rxMin, ryMin, rxMax, ryMax } = geo;
  ctx.clearRect(0, 0, cssW, cssH);

  const pool = new Set(st.pool || []);
  const engine = window.ResampleLive;
  const durSec = Math.max(st.sampleBars * ((4 * 60) / Math.max(engine.params.bpm, 1)), 0.001);
  const win = engine.windowSec ? engine.windowSec() : { start: 0, end: durSec };

  ctx.strokeStyle = "rgba(232,162,58,0.12)";
  ctx.lineWidth = 1;
  for (let pc = 0; pc < 12; pc += 1) {
    const [x, y] = polar(cx, cy, rxMax + 6, ryMax + 6, pc / 12);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    const [lx, ly] = polar(cx, cy, rxMax + 22, ryMax + 20, pc / 12);
    ctx.fillStyle = pc % 3 === 0 ? "#e8e2d6" : "#8a8478";
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(STAR_PCS[pc], lx, ly);
  }
  ctx.strokeStyle = "rgba(232,162,58,0.2)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rxMin, ryMin, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rxMax, ryMax, 0, 0, Math.PI * 2);
  ctx.stroke();

  const ringT = (sec) => Math.min(1, Math.max(0, sec / durSec));
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "rgba(232,162,58,0.45)";
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    rxMin + ringT(win.start) * (rxMax - rxMin),
    ryMin + ringT(win.start) * (ryMax - ryMin),
    0,
    0,
    Math.PI * 2
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    rxMin + ringT(win.end) * (rxMax - rxMin),
    ryMin + ringT(win.end) * (ryMax - ryMin),
    0,
    0,
    Math.PI * 2
  );
  ctx.stroke();
  ctx.setLineDash([]);

  const stars = starPositions(st, geo);
  if (st.sequence && st.sequence.length > 1) {
    ctx.beginPath();
    st.sequence.forEach((idx, n) => {
      const s = stars[idx];
      if (!s) return;
      if (n === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    const first = stars[st.sequence[0]];
    if (first) ctx.lineTo(first.x, first.y);
    ctx.strokeStyle = "rgba(232,162,58,0.55)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  for (const s of stars) {
    const active = s.i === st.slice;
    const inPool = pool.has(s.i);
    ctx.beginPath();
    ctx.arc(s.x, s.y, active ? 9 : inPool ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#e8a23a" : inPool ? "#e8e2d6" : "#3a372f";
    ctx.fill();
    if (active) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(232,162,58,0.75)";
      ctx.stroke();
    }
  }
  canvas._stars = stars;
  canvas._geo = geo;
  return stars;
}

function helmAxes(st) {
  const nOff = Math.max(st.maxOffsetBars || 0, 0);
  const nPitch = Math.max((st.ladder || []).length - 1, 1);
  return [
    { id: "speed", label: "SPEED", slider: "speed", min: 0, max: 7, angle: 0 },
    { id: "length", label: "LENGTH", slider: "length", min: 0, max: 3, angle: 0.2 },
    { id: "offset", label: "OFFSET", slider: "offset", min: 0, max: nOff, angle: 0.4 },
    { id: "pitch", label: "PITCH", slider: "pitch", min: 0, max: nPitch, angle: 0.6 },
    {
      id: "pattern",
      label: "PATTERN",
      slider: "pattern",
      min: 0,
      max: Math.max((window.RESAMPLE_IDEA_IDS || []).length - 1, 1),
      angle: 0.8,
    },
  ];
}

function axisLocked(axis) {
  if (!axis) return false;
  const locks = window.RESAMPLE_LOCKS || {};
  return Boolean(locks[axis.id] || locks[axis.slider]);
}

function drawLockMark(ctx, x, y, color) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.arc(0, -5.5, 4.4, Math.PI * 0.95, Math.PI * 0.05, false);
  ctx.stroke();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-6.2, -3.2, 12.4, 11.4, 2);
  else ctx.rect(-6.2, -3.2, 12.4, 11.4);
  ctx.fill();
  ctx.fillStyle = "#12110f";
  ctx.beginPath();
  ctx.arc(0, 0.8, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-0.7, 1.6, 1.4, 3.4);
  ctx.restore();
}

function helmValue(axis) {
  const el = document.getElementById(axis.slider);
  if (!el) return axis.min;
  const v = Number(el.value);
  return Number.isFinite(v) ? v : axis.min;
}

function helmReadout(st, axis) {
  const v = helmValue(axis);
  if (axis.id === "speed") {
    const p = (window.RESAMPLE_PATTERNS || [])[v];
    return p ? p.label : String(v);
  }
  if (axis.id === "length") {
    const bars = (window.RESAMPLE_LENGTH_BARS || [1, 2, 4, 8])[v] ?? v;
    return `${bars} bar${bars === 1 ? "" : "s"}`;
  }
  if (axis.id === "offset") return `bar ${v + 1}`;
  if (axis.id === "pitch") {
    const stn = (st.ladder || [])[v] ?? st.pitch ?? 0;
    const sign = stn === 0 ? "0" : stn > 0 ? `+${stn}` : `${stn}`;
    return st.pitchNote ? `${sign} · ${st.pitchNote}` : sign;
  }
  if (axis.id === "pattern") {
    const id = (window.RESAMPLE_IDEA_IDS || [])[v];
    const spec = window.RESAMPLE_IDEAS && window.RESAMPLE_IDEAS[id];
    return spec ? spec.label : id || "—";
  }
  return String(v);
}

function drawHelmTip(ctx, x, y, text, cssW, cssH, color) {
  ctx.font = "12px 'IBM Plex Mono', monospace";
  const padX = 8;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = 24;
  let tx = x + 16;
  let ty = y - 32;
  if (tx + w > cssW - 4) tx = x - w - 16;
  if (tx < 4) tx = 4;
  if (ty < 4) ty = y + 16;
  if (ty + h > cssH - 4) ty = cssH - h - 4;
  ctx.fillStyle = "rgba(12,11,10,0.94)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(tx, ty, w, h, 3);
  else ctx.rect(tx, ty, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, tx + padX, ty + h / 2);
}

function helmPoint(geo, axis, value) {
  const span = Math.max(axis.max - axis.min, 0.0001);
  const t = Math.min(1, Math.max(0, (value - axis.min) / span));
  const [x, y] = atT(geo, t, axis.angle);
  return { x, y, t };
}

function drawHelm(st) {
  const canvas = document.getElementById("helm");
  if (!canvas) return;
  const geo = canvasGeo(canvas);
  const { ctx, cssW, cssH, cx, cy, rxMin, ryMin, rxMax, ryMax } = geo;
  ctx.clearRect(0, 0, cssW, cssH);
  const axes = helmAxes(st);

  ctx.strokeStyle = "rgba(232,162,58,0.18)";
  for (let ring = 1; ring <= 4; ring += 1) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rxMin + ((rxMax - rxMin) * ring) / 4, ryMin + ((ryMax - ryMin) * ring) / 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const hoverId = canvas._helmHover || "";
  const pts = [];
  for (const axis of axes) {
    const hot = hoverId === axis.id;
    const [ex, ey] = polar(cx, cy, rxMax + 6, ryMax + 6, axis.angle);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = hot ? "rgba(232,162,58,0.85)" : "rgba(232,162,58,0.28)";
    ctx.lineWidth = hot ? 2 : 1;
    ctx.stroke();
    const [lx, ly] = polar(cx, cy, rxMax + 26, ryMax + 22, axis.angle);
    ctx.fillStyle = "#e8a23a";
    ctx.font = hot ? "700 12px 'IBM Plex Mono', monospace" : "11px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(axis.label, lx, ly);
    pts.push({ axis, lx, ly, ...helmPoint(geo, axis, helmValue(axis)) });
  }

  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(232,162,58,0.16)";
  ctx.fill();
  ctx.strokeStyle = "rgba(232,162,58,0.85)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  const amber = getComputedStyle(document.documentElement).getPropertyValue("--amber").trim() || "#e8a23a";
  let hoverPt = null;
  for (const p of pts) {
    const hot = hoverId === p.axis.id;
    if (hot) hoverPt = p;
    if (axisLocked(p.axis)) {
      drawLockMark(ctx, p.x, p.y, amber);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, hot ? 11 : 9, 0, Math.PI * 2);
      ctx.fillStyle = amber;
      ctx.fill();
      ctx.strokeStyle = "#1a1308";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  if (hoverPt) {
    const text = helmReadout(st, hoverPt.axis);
    drawHelmTip(ctx, hoverPt.x, hoverPt.y, text, cssW, cssH, amber);
    canvas.title = text;
  } else {
    canvas.title = "Hover a point for its value";
  }

  canvas._helm = { geo, pts, axes };
}

function nearestHelmHandle(canvas, ev, maxDist = 28) {
  const data = canvas._helm;
  if (!data) return null;
  const { x, y } = eventXY(canvas, ev);
  let best = null;
  let bestD = maxDist;
  for (const p of data.pts) {
    const d = Math.min(Math.hypot(p.x - x, p.y - y), Math.hypot((p.lx ?? p.x) - x, (p.ly ?? p.y) - y));
    if (d < bestD) {
      bestD = d;
      best = p.axis;
    }
  }
  if (best) return best;
  // Also allow grabbing an axis ray.
  const { cx, cy, rxMin, ryMin, rxMax, ryMax } = data.geo;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < Math.min(rxMin, ryMin) - 8 || dist > Math.max(rxMax, ryMax) + 24) return null;
  let ang = Math.atan2(dy, dx) + Math.PI / 2;
  if (ang < 0) ang += Math.PI * 2;
  const turn = ang / (Math.PI * 2);
  let closest = null;
  let closestD = 0.12;
  for (const axis of data.axes) {
    let d = Math.abs(turn - axis.angle);
    d = Math.min(d, 1 - d);
    if (d < closestD) {
      closestD = d;
      closest = axis;
    }
  }
  return closest;
}

function helmDragToValue(canvas, ev, axis) {
  const data = canvas._helm;
  if (!data || !axis) return null;
  const { cx, cy, rxMin, ryMin, rxMax, ryMax } = data.geo;
  const { x, y } = eventXY(canvas, ev);
  const a = axis.angle * Math.PI * 2 - Math.PI / 2;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const ox = cx + rxMin * ux;
  const oy = cy + ryMin * uy;
  const vx = (rxMax - rxMin) * ux;
  const vy = (ryMax - ryMin) * uy;
  const den = vx * vx + vy * vy || 1;
  const t = Math.min(1, Math.max(0, ((x - ox) * vx + (y - oy) * vy) / den));
  const raw = axis.min + t * (axis.max - axis.min);
  return Math.round(raw);
}

function drawSeqGrid(st) {
  const root = document.getElementById("seq-grid");
  if (!root) return;
  const pool = st.pool || [];
  const seq = st.sequence || [];
  if (!pool.length || !st.notes.length) {
    root.innerHTML = "";
    root.dataset.key = "";
    return;
  }
  const cols = seq.length;
  const chance = st.chance && st.chance.length === cols ? st.chance : Array(cols).fill(1);
  const key = `${pool.join(",")}|${cols}`;
  const playing = st.playing ? st.stepIndex % cols : -1;
  if (root.dataset.key !== key) {
    root.dataset.key = key;
    const chanceRow = `<div class="seq-row chance-row"><span class="seq-lab">%</span>${Array.from(
      { length: cols },
      (_, c) => `<button type="button" class="chance" data-step="${c}"></button>`
    ).join("")}</div>`;
    const noteRows = pool
      .map((idx) => {
        const note = st.notes[idx];
        const cells = [];
        for (let c = 0; c < cols; c += 1) {
          cells.push(`<button type="button" class="cell" data-note="${idx}" data-step="${c}"></button>`);
        }
        return `<div class="seq-row"><span class="seq-lab">${note ? note.name : idx}</span>${cells.join("")}</div>`;
      })
      .join("");
    root.innerHTML = chanceRow + noteRows;
  }
  root.querySelectorAll(".chance").forEach((el) => {
    const step = Number(el.dataset.step);
    const p = Math.round((chance[step] ?? 1) * 100);
    el.style.setProperty("--p", `${p}%`);
    el.classList.toggle("partial", p < 100);
    el.classList.toggle("mute", p === 0);
    el.classList.toggle("now", step === playing);
    el.classList.toggle("miss", step === playing && st.lastHit === false);
    el.textContent = p === 100 ? "" : String(p);
    el.title = `${p}% — this step fires ${p === 0 ? "never" : p === 100 ? "always" : `${p}% of the time`}`;
  });
  root.querySelectorAll(".cell").forEach((cell) => {
    const step = Number(cell.dataset.step);
    const note = Number(cell.dataset.note);
    const on = seq[step] === note;
    const p = chance[step] ?? 1;
    cell.classList.toggle("on", on);
    cell.classList.toggle("now", step === playing);
    cell.classList.toggle("miss", step === playing && st.lastHit === false);
    cell.style.opacity = on && p < 0.99 ? String(Math.max(0.22, p)) : "";
  });
}

function drawWaveform(st) {
  const canvas = document.getElementById("wave");
  const engine = window.ResampleLive;
  if (!canvas || !engine || !engine.peaks.length) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = canvas.clientHeight || 64;
  if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const peaks = engine.peaks;
  const mid = cssH / 2;
  const win = engine.windowSec();
  const dur = engine.buffer ? engine.buffer.duration : 1;
  const xAt = (sec) => (sec / dur) * cssW;
  ctx.fillStyle = "rgba(232,162,58,0.18)";
  ctx.fillRect(xAt(win.start), 0, Math.max(2, xAt(win.end) - xAt(win.start)), cssH);
  if (st.reverse) {
    ctx.fillStyle = "rgba(196,75,60,0.12)";
    ctx.fillRect(0, 0, cssW, cssH);
  }
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--amber").trim() || "#e8a23a";
  const step = cssW / peaks.length;
  for (let i = 0; i < peaks.length; i += 1) {
    const h = peaks[i] * (cssH * 0.9);
    ctx.fillRect(i * step, mid - h / 2, Math.max(1, step - 0.3), h);
  }
  const fileDur = engine.buffer ? engine.buffer.duration : dur;
  const grain = engine.grain;
  if (st.playing && grain && engine.ctx) {
    let g0 = grain.offsetSec;
    let g1 = grain.offsetSec + grain.dur;
    if (grain.reverse) {
      g0 = fileDur - (grain.offsetSec + grain.dur);
      g1 = fileDur - grain.offsetSec;
    }
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(xAt(g0), 0, Math.max(2, xAt(g1) - xAt(g0)), cssH);
    const elapsed = Math.min(grain.dur, Math.max(0, engine.ctx.currentTime - grain.at));
    const playSec = grain.reverse ? fileDur - (grain.offsetSec + elapsed) : grain.offsetSec + elapsed;
    ctx.fillStyle = "#fff";
    ctx.fillRect(xAt(playSec), 0, 2, cssH);
  } else {
    const note = st.notes && st.notes[st.slice];
    if (note) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(xAt(note.start), 0, 2, cssH);
    }
  }
}

function motionRange(id) {
  if (id === "reverse") return { min: 0, max: 1 };
  const el = document.getElementById(id);
  if (!el) return { min: 0, max: 1 };
  return { min: Number(el.min) || 0, max: Number(el.max) || 1 };
}

function motionLabel(id, raw) {
  const v = Math.round(Number(raw) || 0);
  if (id === "speed") return ((window.RESAMPLE_PATTERNS || [])[v] || {}).label || String(v);
  if (id === "pattern") {
    const key = (window.RESAMPLE_IDEA_IDS || [])[v];
    const spec = window.RESAMPLE_IDEAS && window.RESAMPLE_IDEAS[key];
    return spec ? spec.label : key || "—";
  }
  if (id === "length") {
    const bars = (window.RESAMPLE_LENGTH_BARS || [1, 2, 4, 8])[v] ?? v;
    return `${bars} bar${bars === 1 ? "" : "s"}`;
  }
  if (id === "offset") return `bar ${v + 1}`;
  if (id === "pitch") {
    const engine = window.ResampleLive;
    const stn = (engine && engine.ladder[v]) ?? 0;
    return stn === 0 ? "0" : stn > 0 ? `+${stn}` : `${stn}`;
  }
  if (id === "swing") return `${v}%`;
  if (id === "reverse") return v >= 0.5 ? "on" : "off";
  return String(v);
}

function drawMotion(st) {
  const root = document.getElementById("motion-lanes");
  if (!root) return;
  const specs = window.RESAMPLE_MOTION_LANES || [];
  const motion = st.motion || (window.ResampleLive && window.ResampleLive.motion);
  if (!motion) return;
  if (root.dataset.ready !== "3") {
    root.dataset.ready = "3";
    root.innerHTML = specs
      .map(
        (spec) => `
      <div class="motion-lane" data-id="${spec.id}">
        <label class="check"><input type="checkbox" class="motion-on" /> ${spec.label}</label>
        <canvas class="motion-cv" height="80"></canvas>
        <span class="motion-readout"></span>
      </div>`
      )
      .join("");
  }
  const amber = getComputedStyle(document.documentElement).getPropertyValue("--amber").trim() || "#e8a23a";
  const line = getComputedStyle(document.documentElement).getPropertyValue("--line").trim() || "#2c2a25";
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#e8e2d6";
  const dpr = window.devicePixelRatio || 1;
  root.querySelectorAll(".motion-lane").forEach((row) => {
    const id = row.dataset.id;
    const lane = motion.lanes[id] || { on: false, a: 0, b: 0 };
    const onEl = row.querySelector(".motion-on");
    if (onEl && onEl.checked !== Boolean(lane.on)) onEl.checked = Boolean(lane.on);
    row.classList.toggle("off", !lane.on);
    const { min, max } = motionRange(id);
    const a = lane.a == null ? min : lane.a;
    const b = lane.b == null ? a : lane.b;
    const read = row.querySelector(".motion-readout");
    if (read) read.textContent = `${motionLabel(id, a)} → ${motionLabel(id, b)}`;
    const canvas = row.querySelector(".motion-cv");
    if (!canvas) return;
    const cssW = canvas.clientWidth || 240;
    const cssH = canvas.clientHeight || 72;
    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = line;
    ctx.fillRect(0, cssH / 2 - 1, cssW, 2);
    const yAt = (v) => {
      const span = Math.max(max - min, 0.0001);
      const u = (v - min) / span;
      return cssH - 7 - u * (cssH - 14);
    };
    const x0 = 10;
    const x1 = cssW - 10;
    ctx.beginPath();
    ctx.moveTo(x0, yAt(a));
    ctx.lineTo(x1, yAt(b));
    ctx.strokeStyle = lane.on ? amber : line;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const drawHandle = (x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = lane.on ? amber : ink;
      ctx.fill();
    };
    drawHandle(x0, yAt(a));
    drawHandle(x1, yAt(b));
    if (st.playing && lane.on) {
      const t = st.motionT || 0;
      const x = x0 + t * (x1 - x0);
      ctx.fillStyle = ink;
      ctx.fillRect(x, 2, 1, cssH - 4);
    }
    canvas._motion = { id, min, max };
  });
}

function motionDragToValue(canvas, ev) {
  const meta = canvas._motion;
  if (!meta) return null;
  const rect = canvas.getBoundingClientRect();
  const y = ev.clientY - rect.top;
  const u = 1 - (y - 7) / Math.max(rect.height - 14, 1);
  const v = meta.min + Math.min(1, Math.max(0, u)) * (meta.max - meta.min);
  const which = ev.clientX - rect.left < rect.width / 2 ? "a" : "b";
  return { id: meta.id, which, value: meta.id === "reverse" ? (v >= 0.5 ? 1 : 0) : Math.round(v) };
}

window.drawWaveform = drawWaveform;
window.drawStarChart = drawStarChart;
window.drawHelm = drawHelm;
window.drawSeqGrid = drawSeqGrid;
window.nearestHelmHandle = nearestHelmHandle;
window.helmDragToValue = helmDragToValue;
window.drawMotion = drawMotion;
window.motionDragToValue = motionDragToValue;
