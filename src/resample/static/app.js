/** Chrome: Splice library, options/themes, shortcuts, Resample/undo, wiring to live.js. */

const $ = (id) => document.getElementById(id);

const state = { libTimer: null, analysis: null };
window.RESAMPLE_LOCKS = { speed: false, length: false, offset: false, pitch: false, pattern: false, density: false };
const live = window.ResampleLive;
const PREFS_KEY = "resample-options";

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    const { autoInspire, ...rest } = raw;
    return {
      theme: "dark",
      bpm: 128,
      loopBars: 1,
      autoResample: false,
      funMode: false,
      triplets: false,
      ...rest,
      autoResample: Boolean(raw.autoResample ?? autoInspire),
    };
  } catch {
    return { theme: "dark", bpm: 128, loopBars: 1, autoResample: false, funMode: false, triplets: false };
  }
}

function savePrefs(partial) {
  const next = { ...loadPrefs(), ...partial };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || "dark";
}

async function boot() {
  const prefs = loadPrefs();
  applyTheme(prefs.theme);
  bindCreeper();
  bindCats();
  bindOptions();
  bindSteppers();
  bindDeck();
  bindPicker();
  await loadLibraryInfo();
  await runLibrarySearch();
}

function bindSteppers() {
  document.querySelectorAll("[data-nudge]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const el = $(btn.dataset.nudge);
      if (!el) return;
      const step = Number(btn.dataset.dir) * (Number(el.step) || 1);
      const min = el.min === "" ? -Infinity : Number(el.min);
      const max = el.max === "" ? Infinity : Number(el.max);
      const next = (Number(el.value) || 0) + step;
      el.value = String(Math.min(max, Math.max(min, next)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}

function setPickerOpen(open) {
  const lib = $("library");
  const btn = $("lib-toggle");
  if (!lib) return;
  lib.classList.toggle("collapsed", !open);
  if (btn) {
    btn.classList.toggle("hidden", !state.analysis);
    btn.textContent = open ? "hide" : "change sample";
  }
}

function bindPicker() {
  const btn = $("lib-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const open = $("library").classList.contains("collapsed");
    setPickerOpen(open);
    if (open) $("library").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function bindOptions() {
  const modal = $("options");
  if (!modal) return;
  const prefs = loadPrefs();
  $("opt-theme").value = prefs.theme;
  $("opt-bpm").value = String(prefs.bpm);
  $("opt-loop").value = String(prefs.loopBars);
  $("opt-auto-resample").checked = Boolean(prefs.autoResample);
  if ($("opt-triplets")) $("opt-triplets").checked = Boolean(prefs.triplets);
  applyTripletsPref(Boolean(prefs.triplets));
  applyFunMode(Boolean(prefs.funMode));
  const open = () => {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  };
  const close = () => {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  };
  $("options-open").addEventListener("click", open);
  $("options-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  $("opt-theme").addEventListener("change", () => {
    const theme = $("opt-theme").value;
    if (theme === "pink") {
      $("opt-theme").value = loadPrefs().theme || "dark";
      close();
      runPinkFlash();
      return;
    }
    applyTheme(theme);
    savePrefs({ theme });
  });
  $("opt-bpm").addEventListener("change", () => {
    savePrefs({ bpm: Number($("opt-bpm").value) || 128 });
  });
  $("opt-loop").addEventListener("change", () => {
    savePrefs({ loopBars: Number($("opt-loop").value) || 1 });
  });
  $("opt-auto-resample").addEventListener("change", () => {
    savePrefs({ autoResample: $("opt-auto-resample").checked });
  });
  if ($("opt-triplets")) {
    $("opt-triplets").addEventListener("change", () => {
      savePrefs({ triplets: $("opt-triplets").checked });
      applyTripletsPref($("opt-triplets").checked);
    });
  }
  if ($("fun-mode")) {
    $("fun-mode").addEventListener("click", () => {
      applyFunMode(!loadPrefs().funMode);
    });
  }
}

function applyTripletsPref(on) {
  window.RESAMPLE_ALLOW_TRIPLETS = Boolean(on);
  if (live && live.set) live.set({ speedIndex: live.params.speedIndex });
  syncSpeedControl();
  if (typeof paintLabels === "function") paintLabels();
}

function speedAllowed() {
  if (window.allowedSpeedIndices) return window.allowedSpeedIndices();
  return [1, 2, 3, 5, 7];
}

function syncSpeedControl() {
  const el = $("speed");
  const ticks = $("speed-ticks");
  const lengths = window.RESAMPLE_NOTE_LENGTHS || [];
  const allowed = speedAllowed();
  if (el) {
    el.max = String(Math.max(allowed.length - 1, 0));
    let pos = allowed.indexOf(live.params.speedIndex);
    if (pos < 0) {
      const snapped = window.nearestAllowedSpeed
        ? window.nearestAllowedSpeed(live.params.speedIndex)
        : allowed[0];
      live.set({ speedIndex: snapped });
      pos = allowed.indexOf(live.params.speedIndex);
    }
    if (pos >= 0) el.value = String(pos);
  }
  if (ticks) {
    const short = {
      half: "1/2",
      quarter: "1/4",
      "8th": "1/8",
      "8th trip": "8t",
      "16th": "1/16",
      "16th trip": "16t",
      "32nd": "1/32",
    };
    ticks.innerHTML = allowed
      .map((i) => `<i>${short[lengths[i]?.label] || lengths[i]?.id || ""}</i>`)
      .join("");
  }
}

function syncPatternTicks() {
  const ticks = $("pattern-ticks");
  const ids = window.RESAMPLE_IDEA_IDS || [];
  const ideas = window.RESAMPLE_IDEAS || {};
  if (!ticks || !ids.length) return;
  ticks.innerHTML = ids.map((id) => `<i>${ideas[id]?.tick || id}</i>`).join("");
}

function applyFunMode(on) {
  savePrefs({ funMode: Boolean(on) });
  const btn = $("fun-mode");
  const toys = $("fun-toys");
  if (btn) btn.classList.toggle("on", on);
  if (toys) toys.classList.toggle("hidden", !on);
}

function bindCats() {
  const btn = $("cats-best");
  const overlay = $("cats-boom");
  const close = $("cats-close");
  const canvas = $("cats-fireworks");
  if (!btn || !overlay) return;
  let fireworks = null;
  const hide = () => {
    if (fireworks) fireworks.stop();
    fireworks = null;
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  };
  btn.addEventListener("click", () => {
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    if (canvas) fireworks = startFireworks(canvas);
    playMeow().catch(() => {});
  });
  if (close) close.addEventListener("click", hide);
}

function runPinkFlash() {
  const el = $("pink-flash");
  const canvas = $("pink-fireworks");
  if (!el) return;
  el.classList.remove("hidden", "to-white");
  el.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("to-white"));
  });
  const fw = canvas
    ? startFireworks(canvas, ["#1a4cff", "#3d7dff", "#6ec8ff", "#b8e4ff", "#ffffff", "#7aa8ff"])
    : null;
  setTimeout(() => {
    if (fw) fw.stop();
    el.classList.add("hidden");
    el.classList.remove("to-white");
    el.setAttribute("aria-hidden", "true");
  }, 3200);
}

function startFireworks(canvas, palette) {
  const ctx = canvas.getContext("2d");
  const colors = palette || ["#fff36a", "#ff4da6", "#ff9ad4", "#7ec8ff", "#ffffff", "#ffd14a"];
  let rockets = [];
  let sparks = [];
  let running = true;
  let nextAt = 0;
  const resize = () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  };
  resize();
  const burst = (x, y, color) => {
    const n = 36 + Math.floor(Math.random() * 24);
    for (let i = 0; i < n; i += 1) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
      const s = 1.6 + Math.random() * 3.8;
      sparks.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1,
        decay: 0.012 + Math.random() * 0.018,
        color: Math.random() < 0.35 ? "#fff7c2" : color,
        r: 1.4 + Math.random() * 1.8,
      });
    }
  };
  const launch = () => {
    const w = canvas.width;
    const h = canvas.height;
    rockets.push({
      x: w * (0.12 + Math.random() * 0.76),
      y: h + 8,
      vx: (Math.random() - 0.5) * 1.4,
      vy: -(4.8 + Math.random() * 3.2),
      color: colors[Math.floor(Math.random() * colors.length)],
      fuse: 0.42 + Math.random() * 0.22,
    });
  };
  const tick = () => {
    if (!running) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const now = performance.now();
    if (now > nextAt) {
      launch();
      if (Math.random() < 0.45) launch();
      nextAt = now + 280 + Math.random() * 420;
    }
    rockets = rockets.filter((rk) => {
      rk.x += rk.vx;
      rk.y += rk.vy;
      rk.vy += 0.045;
      rk.fuse -= 0.016;
      ctx.fillStyle = rk.color;
      ctx.fillRect(rk.x, rk.y, 2, 8);
      if (rk.fuse <= 0 || rk.vy > -0.4) {
        burst(rk.x, rk.y, rk.color);
        return false;
      }
      return rk.y > -20;
    });
    sparks = sparks.filter((sp) => {
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.vy += 0.04;
      sp.vx *= 0.985;
      sp.life -= sp.decay;
      if (sp.life <= 0) return false;
      ctx.globalAlpha = Math.max(0, sp.life);
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    });
    requestAnimationFrame(tick);
  };
  window.addEventListener("resize", resize);
  requestAnimationFrame(tick);
  return {
    stop() {
      running = false;
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

async function playMeow() {
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  const now = ctx.currentTime;
  const dur = 0.55;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(980, now);
  osc.frequency.exponentialRampToValueAtTime(420, now + 0.22);
  osc.frequency.exponentialRampToValueAtTime(620, now + 0.38);
  osc.frequency.exponentialRampToValueAtTime(280, now + dur);
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.Q.value = 6;
  filt.frequency.setValueAtTime(1400, now);
  filt.frequency.exponentialRampToValueAtTime(700, now + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.28, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.28);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(filt);
  filt.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
  await new Promise((r) => setTimeout(r, dur * 1000));
}

function bindCreeper() {
  const btn = $("creeper-hiss");
  const overlay = $("creeper-boom");
  if (!btn || !overlay) return;
  let busy = false;
  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    overlay.classList.remove("hidden", "kaboom");
    overlay.setAttribute("aria-hidden", "false");
    try {
      await playCreeperHissThenBoom();
    } catch {
      await new Promise((r) => setTimeout(r, 1400));
    }
    overlay.classList.add("kaboom");
    await new Promise((r) => setTimeout(r, 380));
    overlay.classList.add("hidden");
    overlay.classList.remove("kaboom");
    overlay.setAttribute("aria-hidden", "true");
    busy = false;
  });
}

async function playCreeperHissThenBoom() {
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  const now = ctx.currentTime;
  const hissDur = 1.45;

  const hiss = ctx.createBufferSource();
  const n = ctx.sampleRate * hissDur;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) data[i] = (Math.random() * 2 - 1) * 0.55;
  hiss.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1800, now);
  filter.frequency.exponentialRampToValueAtTime(5200, now + hissDur);
  filter.Q.value = 1.2;
  const hissGain = ctx.createGain();
  hissGain.gain.setValueAtTime(0.0001, now);
  hissGain.gain.exponentialRampToValueAtTime(0.35, now + 0.15);
  hissGain.gain.exponentialRampToValueAtTime(0.7, now + hissDur - 0.08);
  hiss.connect(filter);
  filter.connect(hissGain);
  hissGain.connect(ctx.destination);
  hiss.start(now);
  hiss.stop(now + hissDur);

  const boomAt = now + hissDur;
  const boom = ctx.createBufferSource();
  const bn = Math.floor(ctx.sampleRate * 0.7);
  const bbuf = ctx.createBuffer(1, bn, ctx.sampleRate);
  const bd = bbuf.getChannelData(0);
  for (let i = 0; i < bn; i += 1) {
    const env = Math.pow(1 - i / bn, 2.4);
    bd[i] = (Math.random() * 2 - 1) * env;
  }
  boom.buffer = bbuf;
  const boomFilter = ctx.createBiquadFilter();
  boomFilter.type = "lowpass";
  boomFilter.frequency.setValueAtTime(900, boomAt);
  boomFilter.frequency.exponentialRampToValueAtTime(80, boomAt + 0.45);
  const boomGain = ctx.createGain();
  boomGain.gain.setValueAtTime(0.95, boomAt);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, boomAt + 0.65);
  const thump = ctx.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(70, boomAt);
  thump.frequency.exponentialRampToValueAtTime(28, boomAt + 0.4);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.7, boomAt);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, boomAt + 0.45);
  boom.connect(boomFilter);
  boomFilter.connect(boomGain);
  boomGain.connect(ctx.destination);
  thump.connect(thumpGain);
  thumpGain.connect(ctx.destination);
  boom.start(boomAt);
  boom.stop(boomAt + 0.7);
  thump.start(boomAt);
  thump.stop(boomAt + 0.5);

  await new Promise((r) => setTimeout(r, hissDur * 1000));
}

async function loadLibraryInfo() {
  const info = await fetch("/api/library").then((r) => r.json());
  $("lib-root").value = info.root || info.detected[0] || "";
  $("lib-status").textContent = info.exists ? info.root : "set your Splice folder";
  return info;
}

async function saveLibraryRoot() {
  const body = new FormData();
  body.append("root", $("lib-root").value.trim());
  const res = await fetch("/api/library", { method: "POST", body });
  if (!res.ok) {
    $("lib-status").textContent = await res.text();
    return;
  }
  await loadLibraryInfo();
  await runLibrarySearch();
}

async function runLibrarySearch() {
  const root = $("lib-root").value.trim();
  const q = $("lib-q").value.trim();
  const kind = $("lib-kind").value;
  $("lib-status").textContent = "scanning…";
  const params = new URLSearchParams({
    q,
    kind,
    limit: "80",
  });
  if (root) params.set("root", root);
  const res = await fetch(`/api/library/search?${params}`);
  if (!res.ok) {
    $("lib-status").textContent = await res.text();
    $("lib-hits").innerHTML = "";
    return;
  }
  const data = await res.json();
  $("lib-status").textContent =
    `${data.matched} hits · ${data.vocal_count || 0} vox · ${data.bass_count || 0} bass · ${data.synth_count || 0} synth / ${data.scanned} files`;
  $("lib-hits").innerHTML = data.hits
    .map(
      (h) => `
      <li class="lib-hit" data-path="${escapeAttr(h.path)}">
        <button type="button" class="ghost use">✨ use</button>
        <button type="button" class="ghost preview">▶ play</button>
        <span class="name" title="${escapeAttr(h.rel)}">${escapeHtml(h.name)}</span>
        <span class="meta-line"><span class="kind">${escapeHtml(h.kind)}</span> · ${escapeHtml(h.pack)}</span>
      </li>`
    )
    .join("");
  prefetchLibraryHits(data.hits);
}

function prefetchLibraryHits(hits, priority = 2) {
  for (const h of (hits || []).slice(0, 10)) {
    prefetchLibraryPath(h.path, priority);
  }
}

function prefetchLibraryPath(path, priority = 2) {
  const body = new FormData();
  body.append("path", path);
  body.append("root", $("lib-root").value.trim());
  body.append("priority", String(priority));
  fetch("/api/library/prefetch", { method: "POST", body }).catch(() => {});
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function scheduleLibrarySearch() {
  clearTimeout(state.libTimer);
  state.libTimer = setTimeout(runLibrarySearch, 280);
}

$("lib-search").addEventListener("click", (e) => {
  e.preventDefault();
  runLibrarySearch();
});
$("lib-save").addEventListener("click", (e) => {
  e.preventDefault();
  saveLibraryRoot();
});
$("lib-detect").addEventListener("click", async (e) => {
  e.preventDefault();
  const info = await loadLibraryInfo();
  if (info.detected[0]) $("lib-root").value = info.detected[0];
  await runLibrarySearch();
});
$("lib-q").addEventListener("input", scheduleLibrarySearch);
$("lib-kind").addEventListener("change", runLibrarySearch);
$("lib-q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runLibrarySearch();
  }
});

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return "0:00";
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function resetLibButtons() {
  document.querySelectorAll("#lib-hits .preview").forEach((b) => {
    b.textContent = "▶ play";
    b.classList.remove("on");
  });
}

function markLibPlaying(path) {
  resetLibButtons();
  const row = [...document.querySelectorAll(".lib-hit")].find((el) => el.dataset.path === path);
  const btn = row && row.querySelector(".preview");
  if (btn) {
    btn.textContent = "⏹ stop";
    btn.classList.add("on");
  }
}

function stopLibPreview() {
  const player = $("lib-player");
  player.pause();
  player.removeAttribute("src");
  player.load();
  resetLibButtons();
  $("lib-fill").style.width = "0";
  $("lib-now").textContent = "0:00";
}

const libPlayer = $("lib-player");
libPlayer.addEventListener("timeupdate", () => {
  const dur = libPlayer.duration || 0;
  $("lib-fill").style.width = dur ? `${(libPlayer.currentTime / dur) * 100}%` : "0";
  $("lib-now").textContent = `${fmtTime(libPlayer.currentTime)} / ${fmtTime(dur)}`;
});
libPlayer.addEventListener("ended", () => resetLibButtons());
$("lib-scrub").addEventListener("click", (e) => {
  const rect = $("lib-scrub").getBoundingClientRect();
  const t = (e.clientX - rect.left) / rect.width;
  if (Number.isFinite(libPlayer.duration)) libPlayer.currentTime = t * libPlayer.duration;
});

$("lib-hits").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  const row = e.target.closest(".lib-hit");
  if (!btn || !row) return;
  const path = row.dataset.path;
  if (btn.classList.contains("preview")) {
    if (btn.classList.contains("on")) {
      stopLibPreview();
      return;
    }
    const root = encodeURIComponent($("lib-root").value.trim());
    libPlayer.src = `/api/library/file?path=${encodeURIComponent(path)}&root=${root}`;
    prefetchLibraryPath(path, 1);
    await libPlayer.play();
    markLibPlaying(path);
    return;
  }
  if (btn.classList.contains("use")) {
    stopLibPreview();
    $("status").textContent = "loading…";
    const body = new FormData();
    body.append("path", path);
    body.append("root", $("lib-root").value.trim());
    const res = await fetch("/api/library/open", { method: "POST", body });
    if (!res.ok) {
      $("status").textContent = await res.text();
      return;
    }
    applyAnalysis(await res.json());
  }
});

const fileInput = $("file");
$("browse").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) ingest(fileInput.files[0]);
});

async function ingest(file) {
  $("status").textContent = "loading…";
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/analyze", { method: "POST", body });
  if (!res.ok) {
    $("status").textContent = await res.text();
    return;
  }
  applyAnalysis(await res.json());
}

async function applyAnalysis(data) {
  live.stop();
  $("play").textContent = "▶ play";
  $("play").classList.remove("on");
  state.analysis = data;
  $("workspace").classList.remove("hidden");
  stopLibPreview();
  setPickerOpen(false);
  $("src-name").textContent = `${data.filename} · ${data.duration_sec}s`;
  $("key-root").value = data.key_root;
  $("key-mode").value = data.key_mode;
  live.setKey(data.key_root, data.key_mode);
  syncPitchSlider(0);
  const prefs = loadPrefs();
  $("bpm").value = Math.round(data.estimated_bpm || prefs.bpm || 128);
  if ($("loop-bars")) $("loop-bars").value = String(prefs.loopBars || 1);
  $("status").textContent = "decoding…";
  $("play").disabled = true;
  try {
    live.set({ bpm: Number($("bpm").value) });
    await live.load(data.source_url);
    live.setNotes(data.notes || []);
    syncOffsetSlider();
    $("play").disabled = false;
    paintLabels();
    if (loadPrefs().autoResample && window.rollResample) window.rollResample();
    $("status").textContent = data.notes?.length
      ? `found ${data.notes.length} notes — resample or play`
      : "no sung notes found — using grid";
    $("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    $("status").textContent = String(err);
  }
}

function syncIdeaSlider(ideaId) {
  const el = $("pattern");
  const ids = window.RESAMPLE_IDEA_IDS || [];
  if (!el || !ids.length) return;
  el.max = String(ids.length - 1);
  const i = ids.indexOf(ideaId);
  if (i >= 0 && Number(el.value) !== i) el.value = String(i);
}

function syncPitchSlider(preferSemitones) {
  const ladder = live.ladder;
  const pitch = $("pitch");
  pitch.min = 0;
  pitch.max = Math.max(ladder.length - 1, 0);
  pitch.step = 1;
  let idx = ladder.indexOf(preferSemitones);
  if (idx < 0) idx = ladder.indexOf(0);
  if (idx < 0) idx = Math.floor(ladder.length / 2);
  pitch.value = String(idx);
}

function syncOffsetSlider() {
  const max = live.maxOffsetBars();
  const el = $("offset");
  el.max = String(Math.max(max, 0));
  if (Number(el.value) > max) el.value = String(max);
  const ticks = $("offset-ticks");
  if (ticks) {
    const marks = [];
    for (let i = 0; i <= max; i += 1) marks.push(`<i>${i + 1}</i>`);
    ticks.innerHTML = marks.length ? marks.join("") : "<i>1</i>";
  }
}

function readSliders() {
  const ladder = live.ladder;
  const idx = Number($("pitch").value);
  const lengths = window.RESAMPLE_LENGTH_BARS;
  return {
    bpm: Number($("bpm").value) || 128,
    speedIndex: speedAllowed()[Number($("speed").value)] ?? live.params.speedIndex,
    ideaId: (window.RESAMPLE_IDEA_IDS || [])[Number($("pattern").value)] || "lock",
    lengthBars: lengths[Number($("length").value)] ?? 2,
    offsetBars: Number($("offset").value) || 0,
    loopBars: Number($("loop-bars")?.value) || 1,
    pitch: ladder[idx] ?? 0,
    reverse: Boolean($("reverse") && $("reverse").checked),
    through: Boolean($("through") && $("through").checked),
    swing: Number($("swing")?.value || 0) / 100,
    density: (Number($("density")?.value) || 10) / 10,
  };
}

function bounceName() {
  const stem = (state.analysis?.filename || "vocal").replace(/\.[^.]+$/, "");
  const key = `${live.keyRoot.replace("#", "s")}${
    live.keyMode === "major" ? "maj" : live.keyMode === "minor" ? "min" : live.keyMode
  }`;
  return `${["resample", stem, key, live.noteLength().id.replace("/", ""), `${Math.round(live.params.bpm)}bpm`].join("_").replace(/[^\w.-]+/g, "_")}.wav`;
}

const bounceCache = { key: "", file: null, name: "" };

function bounceFingerprint() {
  return JSON.stringify({
    sliders: readSliders(),
    sequence: live.sequence,
    spans: live.spans,
    densityMask: live.densityMask,
    idea: live.idea,
    bars: Number($("bars")?.value) || 4,
    key: [live.keyRoot, live.keyMode],
  });
}

async function bounceFile() {
  if (!live.buffer) throw new Error("No sample loaded");
  const key = bounceFingerprint();
  if (bounceCache.file && bounceCache.key === key) return bounceCache;
  live.set(readSliders());
  const blob = await live.bounce(Number($("bars")?.value) || 4);
  const name = bounceName();
  bounceCache.key = key;
  bounceCache.file = new File([blob], name, { type: "audio/wav" });
  bounceCache.name = name;
  return bounceCache;
}

async function saveBounceToOut(file, name) {
  const body = new FormData();
  body.append("filename", name);
  body.append("file", file, name);
  const res = await fetch("/api/export", { method: "POST", body });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function paintLabels() {
  const noteLen = live.noteLength();
  const st = live.status();
  if ($("speed-val")) $("speed-val").textContent = noteLen ? noteLen.label : "";
  const ideaSpec = window.RESAMPLE_IDEAS && window.RESAMPLE_IDEAS[st.idea];
  if ($("pattern-val")) $("pattern-val").textContent = ideaSpec ? ideaSpec.label : st.idea || "—";
  syncIdeaSlider(st.idea);
  $("len-val").textContent = `${st.lengthBars} bar${st.lengthBars === 1 ? "" : "s"}`;
  $("off-val").textContent = `bar ${st.offsetBars + 1}`;
  if ($("swing-val")) $("swing-val").textContent = `${Math.round((st.swing || 0) * 100)}%`;
  if ($("density") && st.density != null) {
    const ticks = String(Math.min(10, Math.max(1, Math.round((st.density ?? 1) * 10) || 1)));
    if ($("density").value !== ticks) $("density").value = ticks;
  }
  if ($("density-val")) {
    const mask = st.densityMask || [];
    const n = mask.length || st.loopSteps || 0;
    const on = mask.reduce((a, v) => a + (v ? 1 : 0), 0);
    $("density-val").textContent = `${n ? Math.round((on / n) * 100) : Math.round((st.density ?? 1) * 100)}%`;
  }
  ["speed", "length", "offset", "pitch", "pattern", "density"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = Boolean(window.RESAMPLE_LOCKS[id]);
  });
  const stLabel = st.pitch === 0 ? "0" : `${st.pitch > 0 ? "+" : ""}${st.pitch}`;
  $("pitch-val").textContent = `${stLabel} · ${st.pitchNote}`;
  $("pitch-hint").textContent = `${st.keyRoot} ${st.keyMode} — ${st.ladder
    .map((n) => (n === 0 ? "0" : n > 0 ? `+${n}` : `${n}`))
    .join("  ")}`;
  drawNotes(st);
  if (window.drawWaveform) window.drawWaveform(st);
  if (window.drawStarChart) window.drawStarChart(st);
  if (window.drawHelm) window.drawHelm(st);
  if (window.drawSeqGrid) window.drawSeqGrid(st);
  const loopBits = $("loop-label");
  if (loopBits && st.loopSteps) {
    loopBits.textContent = `this loop is ${st.loopBars} bar${st.loopBars === 1 ? "" : "s"} · ${st.loopSteps} steps of ${st.noteLength.label}`;
  }
  if (st.ready) {
    const n = st.notes[st.slice];
    const feel = [
      st.reverse ? "rev" : "",
      st.through ? "through" : "",
      st.swing ? `swing ${Math.round(st.swing * 100)}%` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    $("status").textContent = st.playing
      ? `${st.idea ? `${st.idea} · ` : ""}${noteLen.label} · ${n ? n.name : `slice ${st.slice + 1}`}${feel ? ` · ${feel}` : ""}`
      : st.notes.length
        ? `${st.notes.length} notes · hit resample`
        : `${st.slices} slices · ${noteLen.label}`;
  }
}

function drawNotes(st) {
  const row = $("note-row");
  if (!row) return;
  if (!st.notes.length) {
    row.innerHTML = "";
    return;
  }
  const pool = new Set(st.pool);
  row.innerHTML = st.notes
    .map(
      (n, i) =>
        `<span class="note-chip${i === st.slice ? " on" : ""}${pool.has(i) ? " pool" : ""}">${escapeHtml(n.pc)}</span>`
    )
    .join("");
}

function fillKeySelects() {
  const root = $("key-root");
  const mode = $("key-mode");
  root.innerHTML = window.RESAMPLE_PITCH_CLASSES.map((n) => `<option value="${n}">${n}</option>`).join("");
  mode.innerHTML = window.RESAMPLE_SCALES.map((n) => `<option value="${n}">${n}</option>`).join("");
}

function bindDeck() {
  fillKeySelects();
  syncSpeedControl();
  syncPatternTicks();
  live.onTick = () => paintLabels();

  const apply = () => {
    live.set(readSliders());
    syncOffsetSlider();
    paintLabels();
  };

  const captureState = () => ({
    speed: $("speed").value,
    speedIndex: live.params.speedIndex,
    length: $("length").value,
    offset: $("offset").value,
    pitch: $("pitch").value,
    pattern: $("pattern").value,
    loopBars: $("loop-bars") ? $("loop-bars").value : "1",
    reverse: Boolean($("reverse") && $("reverse").checked),
    through: Boolean($("through") && $("through").checked),
    swing: $("swing") ? $("swing").value : "0",
    density: $("density") ? $("density").value : "10",
    densityMask: live.densityMask.slice(),
    bpm: $("bpm").value,
    keyRoot: $("key-root").value,
    keyMode: $("key-mode").value,
    idea: live.idea,
    sequence: live.sequence.slice(),
    chance: live.fitChance().slice(),
    spans: live.fitSpans().slice(),
    locks: { ...window.RESAMPLE_LOCKS },
  });

  let restoring = false;
  const restoreState = (prev) => {
    restoring = true;
    if (prev.speedIndex != null) live.params.speedIndex = Number(prev.speedIndex);
    else if (prev.patternIndex != null) live.params.speedIndex = Number(prev.patternIndex);
    else if (prev.speed != null) live.params.speedIndex = Number(prev.speed);
    syncSpeedControl();
    $("length").value = prev.length;
    $("offset").value = prev.offset;
    $("pitch").value = prev.pitch;
    $("pattern").value = prev.pattern;
    if ($("loop-bars")) $("loop-bars").value = prev.loopBars;
    if ($("reverse")) $("reverse").checked = Boolean(prev.reverse);
    if ($("through")) $("through").checked = Boolean(prev.through);
    if ($("swing") && prev.swing != null) $("swing").value = prev.swing;
    if ($("density") && prev.density != null) $("density").value = prev.density;
    if (prev.bpm) $("bpm").value = prev.bpm;
    if (prev.keyRoot) $("key-root").value = prev.keyRoot;
    if (prev.keyMode) $("key-mode").value = prev.keyMode;
    if (prev.locks) Object.assign(window.RESAMPLE_LOCKS, prev.locks);
    live.setKey($("key-root").value, $("key-mode").value);
    apply();
    if (prev.idea) live.idea = prev.idea;
    if (prev.sequence) live.sequence = prev.sequence.slice();
    if (prev.chance) live.chance = live.fitChance(prev.chance);
    if (prev.spans) live.spans = live.fitSpans(prev.spans);
    else live.spans = live.fitSpans([]);
    if (prev.densityMask) live.fitDensityMask({ mask: prev.densityMask });
    else if (prev.density == null) live.fitDensityMask({ mask: [] });
    paintLabels();
    restoring = false;
  };

  const undoStack = [];
  const sameState = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const snapshot = () => {
    if (restoring) return;
    const next = captureState();
    const last = undoStack[undoStack.length - 1];
    if (last && sameState(last, next)) return;
    undoStack.push(next);
    if (undoStack.length > 40) undoStack.shift();
  };
  const undoLast = () => {
    const prev = undoStack.pop();
    if (!prev) return;
    restoreState(prev);
  };

  ["speed", "pattern", "length", "offset", "pitch", "swing", "density"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("pointerdown", snapshot);
    el.addEventListener("focus", snapshot);
    el.addEventListener("input", apply);
  });
  if ($("reverse")) {
    $("reverse").addEventListener("pointerdown", snapshot);
    $("reverse").addEventListener("change", apply);
  }
  if ($("through")) {
    $("through").addEventListener("pointerdown", snapshot);
    $("through").addEventListener("change", apply);
  }
  $("bpm").addEventListener("pointerdown", snapshot);
  $("bpm").addEventListener("focus", snapshot);
  $("bpm").addEventListener("change", apply);
  $("bpm").addEventListener("input", apply);
  if ($("loop-bars")) {
    $("loop-bars").addEventListener("pointerdown", snapshot);
    $("loop-bars").addEventListener("change", apply);
  }

  const applyKey = () => {
    live.setKey($("key-root").value, $("key-mode").value);
    syncPitchSlider(live.params.pitch);
    apply();
  };
  $("key-root").addEventListener("pointerdown", snapshot);
  $("key-mode").addEventListener("pointerdown", snapshot);
  $("key-root").addEventListener("change", applyKey);
  $("key-mode").addEventListener("change", applyKey);

  const helm = $("helm");
  if (helm) {
    let dragAxis = null;
    const axisLocked = window.axisLocked || ((axis) => {
      if (!axis) return false;
      const locks = window.RESAMPLE_LOCKS || {};
      return Boolean(locks[axis.id] || locks[axis.slider]);
    });
    const pull = (e) => {
      if (!dragAxis || axisLocked(dragAxis)) return;
      const value = window.helmDragToValue(helm, e, dragAxis);
      if (value == null) return;
      const el = $(dragAxis.slider);
      if (!el) return;
      const lo = Number(el.min);
      const hi = Number(el.max);
      el.value = String(Math.min(hi, Math.max(lo, value)));
      apply();
    };
    const toggleLock = (axis) => {
      if (!axis) return;
      snapshot();
      const key = axis.id || axis.slider;
      window.RESAMPLE_LOCKS[key] = !window.RESAMPLE_LOCKS[key];
      dragAxis = null;
      paintLabels();
    };
    helm.addEventListener("pointerdown", (e) => {
      const axis = window.nearestHelmHandle && window.nearestHelmHandle(helm, e);
      if (!axis) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        toggleLock(axis);
        return;
      }
      if (axisLocked(axis)) return;
      snapshot();
      dragAxis = axis;
      helm.setPointerCapture(e.pointerId);
      pull(e);
    });
    helm.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const axis = window.nearestHelmHandle && window.nearestHelmHandle(helm, e);
      toggleLock(axis);
    });
    const setHover = (axis) => {
      const id = axis ? axis.id : "";
      if (helm._helmHover === id) return;
      helm._helmHover = id;
      if (window.drawHelm) window.drawHelm(live.status());
    };
    helm.addEventListener("pointermove", (e) => {
      pull(e);
      const axis = dragAxis || (window.nearestHelmHandle && window.nearestHelmHandle(helm, e));
      setHover(axis);
      helm.style.cursor = !axis ? "default" : axisLocked(axis) ? "default" : dragAxis ? "grabbing" : "grab";
    });
    helm.addEventListener("pointerleave", () => {
      if (dragAxis) return;
      setHover(null);
    });
    helm.addEventListener("pointerup", () => {
      dragAxis = null;
    });
    helm.addEventListener("pointercancel", () => {
      dragAxis = null;
    });
  }

  const grid = $("seq-grid");
  if (grid) {
    let chanceDrag = null;
    let noteDrag = null;
    const stepFromEvent = (e) => {
      const row = grid.querySelector(".seq-row:not(.chance-row)");
      if (!row) return null;
      const cells = row.querySelectorAll(".cell");
      if (!cells.length) return null;
      const first = cells[0].getBoundingClientRect();
      const last = cells[cells.length - 1].getBoundingClientRect();
      const t = (e.clientX - first.left) / Math.max(last.right - first.left, 1);
      return Math.min(cells.length - 1, Math.max(0, Math.floor(t * cells.length)));
    };
    grid.addEventListener("pointerdown", (e) => {
      const pad = e.target.closest(".chance");
      if (pad) {
        e.preventDefault();
        snapshot();
        chanceDrag = { step: Number(pad.dataset.step), y: e.clientY, moved: false, el: pad };
        pad.setPointerCapture(e.pointerId);
        return;
      }
      const cell = e.target.closest(".cell");
      if (!cell) return;
      e.preventDefault();
      snapshot();
      const step = Number(cell.dataset.step);
      const note = Number(cell.dataset.note);
      const cover = live.spanCover && live.spanCover(step);
      const same = cover && cover.note === note;
      noteDrag = {
        origin: same ? cover.start : step,
        from: step,
        note,
        drawing: !same,
        moved: false,
      };
      cell.setPointerCapture(e.pointerId);
    });
    grid.addEventListener("pointermove", (e) => {
      if (chanceDrag) {
        if (Math.abs(e.clientY - chanceDrag.y) > 4) chanceDrag.moved = true;
        if (!chanceDrag.moved) return;
        const rect = chanceDrag.el.getBoundingClientRect();
        const t = 1 - (e.clientY - rect.top) / Math.max(rect.height, 1);
        live.setChance(chanceDrag.step, Math.round(Math.min(1, Math.max(0, t)) * 20) / 20);
        paintLabels();
        return;
      }
      if (!noteDrag) return;
      const step = stepFromEvent(e);
      if (step == null) return;
      if (step !== noteDrag.from) noteDrag.moved = true;
      if (!noteDrag.moved) return;
      if (noteDrag.drawing) {
        const a = Math.min(noteDrag.from, step);
        const b = Math.max(noteDrag.from, step);
        live.setSpan(a, b - a + 1, noteDrag.note);
      } else {
        live.setSpan(noteDrag.origin, Math.max(1, step - noteDrag.origin + 1), noteDrag.note);
      }
      paintLabels();
    });
    grid.addEventListener("pointerup", () => {
      if (chanceDrag) {
        if (!chanceDrag.moved) live.cycleChance(chanceDrag.step);
        chanceDrag = null;
        paintLabels();
        return;
      }
      if (noteDrag) {
        if (!noteDrag.moved) live.setStep(noteDrag.from, noteDrag.note);
        noteDrag = null;
        paintLabels();
      }
    });
    grid.addEventListener("pointercancel", () => {
      chanceDrag = null;
      noteDrag = null;
    });
    grid.addEventListener("dblclick", (e) => {
      const pad = e.target.closest(".chance");
      if (!pad) return;
      e.preventDefault();
      snapshot();
      live.setChance(Number(pad.dataset.step), 1);
      paintLabels();
    });
  }

  const KITS_KEY = "resample-kits";
  const loadKits = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(KITS_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  };
  const storeKits = (kits) => localStorage.setItem(KITS_KEY, JSON.stringify(kits));
  const refreshKits = (selectName) => {
    const sel = $("kit-list");
    if (!sel) return;
    const kits = loadKits();
    sel.innerHTML = kits.length
      ? kits.map((k) => `<option value="${escapeAttr(k.name)}">${escapeHtml(k.name)}</option>`).join("")
      : `<option value="">no kits yet</option>`;
    if (selectName) sel.value = selectName;
  };
  refreshKits();
  if ($("kit-save")) {
    $("kit-save").addEventListener("click", () => {
      const name = ($("kit-name").value || "").trim();
      if (!name) {
        $("status").textContent = "name the kit first";
        return;
      }
      const kits = loadKits().filter((k) => k.name !== name);
      kits.push({ name, ...captureState() });
      storeKits(kits);
      refreshKits(name);
      $("status").textContent = `saved kit “${name}”`;
    });
    $("kit-load").addEventListener("click", () => {
      const name = $("kit-list").value;
      const kit = loadKits().find((k) => k.name === name);
      if (!kit) return;
      snapshot();
      restoreState(kit);
      $("kit-name").value = kit.name;
      $("status").textContent = `loaded kit “${name}”`;
    });
    $("kit-delete").addEventListener("click", () => {
      const name = $("kit-list").value;
      if (!name) return;
      storeKits(loadKits().filter((k) => k.name !== name));
      refreshKits();
      $("status").textContent = `deleted kit “${name}”`;
    });
  }

  window.rollResample = () => {
    snapshot();
    syncOffsetSlider();
    const pick = (id) => {
      if (window.RESAMPLE_LOCKS[id]) return;
      const el = $(id);
      if (!el) return;
      const lo = Number(el.min) || 0;
      const hi = Number(el.max) || 0;
      el.value = String(lo + Math.floor(Math.random() * (hi - lo + 1)));
    };
    pick("speed");
    pick("length");
    pick("offset");
    pick("pitch");
    pick("pattern");
    pick("density");
    live.set({ ...readSliders(), forceIdea: true });
    syncOffsetSlider();
    if (live.rerollDensity) live.rerollDensity();
    paintLabels();
    if (!live.playing && live.buffer && !$("play").disabled) {
      live.play().then(() => {
        $("play").textContent = "⏹ stop";
        $("play").classList.add("on");
        paintLabels();
      });
    }
  };
  $("resample").addEventListener("click", () => window.rollResample());

  $("export").addEventListener("click", async () => {
    if (!live.buffer) return;
    const btn = $("export");
    btn.disabled = true;
    $("status").textContent = "bouncing…";
    try {
      const pack = await bounceFile();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(pack.file);
      a.download = pack.name;
      a.click();
      URL.revokeObjectURL(a.href);
      let extra = "";
      try {
        const saved = await saveBounceToOut(pack.file, pack.name);
        extra = ` · ${saved.path}`;
      } catch {
        /* folder write is optional; download still happened */
      }
      $("status").textContent = `exported ${Number($("bars").value) || 4} bars${extra}`;
    } catch (err) {
      $("status").textContent = String(err);
    }
    btn.disabled = false;
  });

  const dragBtn = $("drag-live");
  if (dragBtn) {
    let justDragged = false;
    dragBtn.addEventListener("pointerdown", () => {
      if (!live.buffer) return;
      bounceFile()
        .then((pack) => saveBounceToOut(pack.file, pack.name))
        .then((saved) => {
          dragBtn.title = saved.path;
        })
        .catch(() => {});
    });
    dragBtn.addEventListener("dragstart", (e) => {
      justDragged = true;
      if (!bounceCache.file) {
        e.preventDefault();
        $("status").textContent = "bouncing… drag again in a second";
        bounceFile().catch((err) => {
          $("status").textContent = String(err);
        });
        return;
      }
      const { file, name } = bounceCache;
      e.dataTransfer.effectAllowed = "copy";
      try {
        e.dataTransfer.items.add(file);
      } catch {
        /* Chromium accepts File; others fall back to out/ */
      }
      const url = URL.createObjectURL(file);
      e.dataTransfer.setData("DownloadURL", `audio/wav:${name}:${url}`);
      e.dataTransfer.setData("text/uri-list", url);
      e.dataTransfer.setData("text/plain", name);
    });
    dragBtn.addEventListener("click", async () => {
      if (justDragged) {
        justDragged = false;
        return;
      }
      if (!live.buffer) return;
      $("status").textContent = "bouncing…";
      try {
        const pack = await bounceFile();
        const saved = await saveBounceToOut(pack.file, pack.name);
        dragBtn.title = saved.path;
        $("status").textContent = `saved ${saved.path} — drag this button or that file into Live`;
      } catch (err) {
        $("status").textContent = String(err);
      }
    });
  }

  const setStopped = () => {
    live.stop();
    apply();
    $("play").textContent = "▶ play";
    $("play").classList.remove("on");
    paintLabels();
  };

  const togglePlay = async () => {
    if ($("play").disabled || !live.buffer) return;
    stopLibPreview();
    if (live.playing) {
      setStopped();
      return;
    }
    await live.play();
    $("play").textContent = "⏹ stop";
    $("play").classList.add("on");
    paintLabels();
  };

  $("play").addEventListener("click", () => togglePlay());

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable;
    if (typing) return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      if (!e.repeat) togglePlay();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      if (!e.repeat) window.rollResample();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
      e.preventDefault();
      if (!e.repeat) undoLast();
    }
  });

  window.addEventListener("resize", () => {
    if (state.analysis) paintLabels();
  });

  paintLabels();
}

boot().catch((err) => {
  const el = $("lib-status") || $("status");
  if (el) el.textContent = String(err);
});
