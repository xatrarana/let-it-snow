// Falling snow (or autumn leaves, or cherry blossoms; see themes.js) drawn on a
// transparent full-screen canvas.
// Flakes drift with a slowly changing wind and pile up on:
//   - the taskbar / dock line at the bottom of the screen (the "ground"), and
//   - the top edges of open windows (snow falls off when a window moves or closes).
// A little bulldozer drives along the ground to push the snow away.

const canvas = document.getElementById('snow');
const ctx = canvas.getContext('2d');

// Flakes per 1920x1080 screen.
const DENSITY = { light: 70, medium: 170, heavy: 360, blizzard: 700 };
const BIN = 4; // px width of each column in a snow pile
const GROUND_MAX = 28; // px, so the pile never covers too much of the taskbar
const WINDOW_MAX = 14; // px of snow on a window's top edge
const MELT_PER_SEC = 0.01; // px/s, a very slow melt so old snow fades over time
const MAX_EXTRA = 900; // cap on loose snow (falling off windows, bulldozer spray)
const AUTO_PLOW_LEVEL = 0.45; // send the bulldozer when the ground is this full on average
const AUTO_PLOW_GAP_MS = 120000; // and at most every 2 minutes

let cfg = {
  enabled: true,
  intensity: 'medium',
  pileUp: true,
  windowSnow: true,
  autoPlow: true,
  theme: 'snow',
  groundY: innerHeight,
  width: innerWidth,
  height: innerHeight,
};
let W = innerWidth;
let H = innerHeight;
// Draw at no more than 1 canvas pixel per screen point. On a 4K / Retina screen this makes
// the canvas 4x smaller in memory and much cheaper to composite; soft snow looks the same.
const MAX_RENDER_SCALE = 1;
const renderScale = () => Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE);
let dpr = renderScale();
let flakes = [];
let extraCount = 0;
let running = false;
let last = 0;
let windT = Math.random() * 1000;
let theme = window.THEMES.get('snow');

// ---------- Snow piles ----------
class Pile {
  constructor(x0, width, baseY, max, taper) {
    this.x0 = x0;
    this.width = width;
    this.y = baseY;
    this.max = max;
    this.taper = taper; // rounded ends, like snow on a ledge
    this.n = Math.max(1, Math.ceil(width / BIN));
    this.bins = new Float32Array(this.n);
    this.visible = new Uint8Array(this.n).fill(1);
    this.decals = []; // leaves / petals lying on top of the pile
  }
  clear() {
    this.bins.fill(0);
    this.decals = [];
  }
  addDecal(f) {
    const d = { x: f.x, img: f.img, rot: f.rot, size: f.r * theme.drawScale * 0.9 };
    const cap = Math.max(4, Math.floor(this.n * 0.7));
    if (this.decals.length < cap) this.decals.push(d);
    else this.decals[Math.floor(Math.random() * cap)] = d;
  }
  drawDecals() {
    for (const d of this.decals) {
      const i = this.index(d.x);
      if (!this.visible[i]) continue;
      const y = this.y - this.bins[i] + d.size * 0.12;
      const c = Math.cos(d.rot);
      const s = Math.sin(d.rot);
      // lying mostly flat: squashed vertically
      ctx.setTransform(c * dpr, s * 0.45 * dpr, -s * dpr, c * 0.45 * dpr, d.x * dpr, y * dpr);
      ctx.drawImage(d.img, -d.size / 2, -d.size / 2, d.size, d.size);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  contains(x) {
    return x >= this.x0 && x < this.x0 + this.width;
  }
  index(x) {
    return Math.max(0, Math.min(this.n - 1, Math.floor((x - this.x0) / BIN)));
  }
  heightAt(x) {
    return this.bins[this.index(x)];
  }
  isVisibleAt(x) {
    return this.visible[this.index(x)] === 1;
  }
  capAt(i) {
    if (!this.taper) return this.max;
    const edge = Math.min(i, this.n - 1 - i) * BIN;
    return Math.min(this.max, 1.5 + edge * 0.45);
  }
  add(x, amount) {
    const b = this.bins;
    let j = this.index(x);
    // Let snow slide off steep spots so the pile stays a smooth drift.
    for (let step = 0; step < 6; step++) {
      const l = j > 0 ? b[j - 1] : this.taper ? -1 : Infinity;
      const r = j < this.n - 1 ? b[j + 1] : this.taper ? -1 : Infinity;
      const lower = Math.min(l, r);
      if (b[j] - lower > 1.2) {
        const next = l < r ? j - 1 : j + 1;
        if (next < 0 || next >= this.n) return; // slid off the end of the ledge
        j = next;
      } else break;
    }
    b[j] = Math.min(this.capAt(j), b[j] + amount);
  }
  update(dt, melt) {
    const b = this.bins;
    for (let i = 0; i < this.n; i++) if (b[i] > 0) b[i] = Math.max(0, b[i] - melt * dt);
    for (let i = 1; i < this.n - 1; i++) b[i] += ((b[i - 1] + b[i + 1]) / 2 - b[i]) * 0.05;
  }
  total() {
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.bins[i];
    return s;
  }
  draw() {
    const b = this.bins;
    const y = this.y;
    let peak = 0;
    for (let i = 0; i < this.n; i++) if (b[i] > peak) peak = b[i];
    if (peak < 0.3) return; // nothing to draw
    ctx.beginPath();
    let open = false;
    let lastX = 0;
    for (let i = 0; i < this.n; i++) {
      const x = this.x0 + i * BIN + BIN / 2;
      const show = this.visible[i] && b[i] > 0.3;
      if (show) {
        if (!open) {
          ctx.moveTo(x - BIN / 2, y);
          open = true;
        }
        ctx.lineTo(x, y - b[i]);
        lastX = x;
      } else if (open) {
        ctx.lineTo(lastX + BIN / 2, y);
        ctx.closePath();
        open = false;
      }
    }
    if (open) {
      ctx.lineTo(lastX + BIN / 2, y);
      ctx.closePath();
    }
    // Gradient is cached until the pile moves or the theme changes.
    if (!this.grad || this.gradY !== y || this.gradTheme !== theme) {
      this.grad = ctx.createLinearGradient(0, y - this.max, 0, y);
      this.grad.addColorStop(0, theme.pile[0]);
      this.grad.addColorStop(1, theme.pile[1]);
      this.gradY = y;
      this.gradTheme = theme;
    }
    ctx.fillStyle = this.grad;
    ctx.fill();
    // A thin soft outline instead of a blurred shadow: looks the same, costs far less per frame.
    ctx.strokeStyle = theme.shadow;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Knock the snow loose (window moved or closed): it falls as clumps.
  shed() {
    for (let i = 0; i < this.n; i++) {
      const h = this.bins[i];
      if (h < 0.6 || !this.visible[i]) continue;
      const clumps = Math.min(3, Math.ceil(h / 4));
      for (let k = 0; k < clumps; k++) {
        spawnExtra(this.x0 + i * BIN + Math.random() * BIN, this.y - Math.random() * h, (Math.random() - 0.5) * 40, Math.random() * 30);
      }
    }
    this.clear();
  }
}

let ground = new Pile(0, W, H, GROUND_MAX, false);
let windowPiles = []; // front-most first
const windowPileById = new Map();

// ---------- Flakes ----------
// Flakes are reused in place when they land, so the animation creates no garbage
// (no garbage-collection pauses, steady memory).
function resetFlake(f, anywhere) {
  // Depth: far flakes are small, slow and faint; near flakes are big and fast.
  const z = Math.random();
  const t = theme;
  const r = t.size[0] + z * z * t.size[1];
  f.x = Math.random() * W;
  f.y = anywhere ? Math.random() * H : -10 - Math.random() * 40 - r * 4;
  f.r = r;
  f.vy = t.fall[0] + z * t.fall[1] + Math.random() * 12; // px/s
  f.vx = 0;
  f.g = 0;
  f.term = 0;
  f.sway = t.sway[0] + Math.random() * t.sway[1];
  f.phase = Math.random() * Math.PI * 2;
  f.freq = 0.4 + Math.random() * 1.1;
  f.alpha = t.tumble ? 0.8 + z * 0.2 : 0.45 + z * 0.5;
  f.z = z;
  f.extra = false;
  f.img = t.images[Math.floor(Math.random() * t.images.length)];
  f.rot = Math.random() * Math.PI * 2;
  f.rotV = (Math.random() - 0.5) * 3; // rad/s
  f.flip = Math.random() * Math.PI * 2; // tumbling: the leaf turns over as it falls
  f.flipV = 1.2 + Math.random() * 2.5;
  return f;
}

function newFlake(anywhere) {
  return resetFlake({}, anywhere);
}

// Loose snow thrown around (falls off a window, sprayed by the bulldozer).
// It flies like a small ballistic clump, then drifts like normal snow and is gone once it lands.
function spawnExtra(x, y, vx, vy) {
  if (extraCount >= MAX_EXTRA) return;
  const f = newFlake(false);
  f.x = x;
  f.y = y;
  f.vx = vx;
  f.vy = vy;
  f.g = 260;
  f.term = 45 + Math.random() * 30;
  f.r = theme.tumble ? theme.size[0] + Math.random() * theme.size[1] * 0.6 : 1.4 + Math.random() * 2.2;
  f.alpha = 0.95;
  f.sway = 4;
  f.extra = true;
  flakes.push(f);
  extraCount++;
}

function targetCount() {
  const base = (DENSITY[cfg.intensity] ?? DENSITY.medium) * theme.density;
  return Math.round((base * (W * H)) / (1920 * 1080));
}

function adjustFlakeCount(initial) {
  const regular = flakes.filter((f) => !f.extra);
  const target = targetCount();
  while (regular.length < target) regular.push(newFlake(initial));
  if (regular.length > target) regular.length = target;
  flakes = regular.concat(flakes.filter((f) => f.extra));
}

function groundY() {
  // groundY is in window coordinates; fall back to the canvas bottom.
  const g = cfg.groundY;
  return g > 0 && g <= H ? g : H;
}

function resize() {
  W = innerWidth;
  H = innerHeight;
  dpr = renderScale();
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = groundY();
  if (ground.width !== W) {
    const old = ground;
    ground = new Pile(0, W, g, GROUND_MAX, false);
    ground.bins.set(old.bins.subarray(0, Math.min(old.n, ground.n)));
  }
  ground.y = g;
}

// ---------- Windows ----------
function setWindows(list) {
  if (!cfg.windowSnow) list = [];
  const next = [];
  const seen = new Set();
  for (const w of list) {
    seen.add(w.id);
    let p = windowPileById.get(w.id);
    const moved = p && (Math.abs(p.x0 - w.x) > 2 || Math.abs(p.y - w.y) > 2 || Math.abs(p.width - w.w) > 2);
    if (moved) p.shed();
    if (!p || moved) {
      p = new Pile(w.x, w.w, w.y, WINDOW_MAX, true);
      windowPileById.set(w.id, p);
    }
    p.rect = w;
    next.push(p);
  }
  for (const [id, p] of windowPileById) {
    if (!seen.has(id)) {
      p.shed(); // closed or minimized
      windowPileById.delete(id);
    }
  }
  // Only the parts of a top edge that no window in front covers can hold snow.
  next.forEach((p, k) => {
    const y = p.y - 1;
    for (let i = 0; i < p.n; i++) {
      const x = p.x0 + i * BIN + BIN / 2;
      let vis = y > 4 && y < groundY() - 8; // not under the menu bar or at the very top
      for (let j = 0; vis && j < k; j++) {
        const r = next[j].rect;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) vis = false;
      }
      if (!vis && p.bins[i] > 0) p.bins[i] = 0;
      p.visible[i] = vis ? 1 : 0;
    }
  });
  windowPiles = next;
}

// ---------- Bulldozer ----------
const DOZER_SPEED = 130; // px/s
const DOZER_SCALE = 1.4;
const BLADE_X = 66; // blade front, from the bulldozer's back end (drawing units)
const BLADE = BLADE_X * DOZER_SCALE; // same, in screen px
let dozer = null;
let lastPlow = 0;
const puffs = [];

function startBulldozer() {
  if (dozer) return;
  dozer = { x: -BLADE - 30, load: 0, cleared: -1, t: 0, spray: 0 };
  lastPlow = performance.now();
}

function updateBulldozer(dt) {
  if (!dozer) {
    if (cfg.autoPlow && cfg.pileUp && performance.now() - lastPlow > AUTO_PLOW_GAP_MS) {
      if (ground.total() / ground.n > GROUND_MAX * AUTO_PLOW_LEVEL) startBulldozer();
    }
    return;
  }
  const d = dozer;
  d.t += dt;
  d.x += DOZER_SPEED * dt;
  const blade = d.x + BLADE;
  // Scoop up every column the blade has passed.
  const upTo = Math.min(ground.n - 1, Math.floor(blade / BIN));
  for (let i = Math.max(0, d.cleared + 1); i <= upTo; i++) {
    d.load += ground.bins[i];
    ground.bins[i] = 0;
  }
  d.cleared = Math.max(d.cleared, upTo);
  if (ground.decals.length) ground.decals = ground.decals.filter((dc) => dc.x > blade);
  d.load *= Math.exp(-dt * 0.04); // a little spills away

  // Spray a bit of snow off the top of the mound.
  const mound = moundSize(d.load);
  d.spray += dt * Math.min(25, d.load / 40);
  while (d.spray > 1) {
    d.spray -= 1;
    spawnExtra(blade + mound.w * DOZER_SCALE * 0.4, groundY() - mound.h * DOZER_SCALE, 30 + Math.random() * 70, -60 - Math.random() * 70);
  }

  // Exhaust puffs.
  if (Math.random() < dt * 6) puffs.push({ x: d.x + 42 * DOZER_SCALE, y: groundY() - 40 * DOZER_SCALE, r: 3, a: 0.5 });

  if (d.x > W + 40) {
    dozer = null; // drove off screen with the snow
  }
}

function moundSize(load) {
  const h = Math.min(34, load > 1 ? 3 + Math.sqrt(load) * 1.6 : 0);
  return { h, w: h * 1.7 };
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBulldozer() {
  // puffs (drawn even after the dozer leaves, until they fade)
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.y -= 18 / 60;
    p.x -= 10 / 60;
    p.r += 0.12;
    p.a -= 0.006;
    if (p.a <= 0) {
      puffs.splice(i, 1);
      continue;
    }
    ctx.fillStyle = `rgba(110,110,120,${p.a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!dozer) return;
  const d = dozer;
  const bob = Math.sin(d.t * 22) * 0.6;
  // Draw in the bulldozer's own units: (0, 0) is the back of the tracks on the ground.
  ctx.save();
  ctx.translate(d.x, groundY());
  ctx.scale(DOZER_SCALE, DOZER_SCALE);
  const x = 0;
  const y = bob;
  const g = 0;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 4;

  // Tracks
  ctx.fillStyle = '#2a2a2e';
  roundRect(x, y - 13, 58, 13, 6.5);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#55555c';
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    ctx.arc(x + 7 + k * 11, y - 6.5, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Moving track treads
  ctx.strokeStyle = '#1a1a1d';
  ctx.lineWidth = 1.2;
  const off = ((d.x / DOZER_SCALE) * 0.9) % 6;
  for (let tx = 4 - off; tx < 56; tx += 6) {
    ctx.beginPath();
    ctx.moveTo(x + tx, y - 13);
    ctx.lineTo(x + tx, y - 11);
    ctx.stroke();
  }

  // Body
  ctx.fillStyle = '#f5b400';
  roundRect(x + 4, y - 27, 48, 15, 3);
  ctx.fill();
  ctx.fillStyle = '#d99a00';
  ctx.fillRect(x + 4, y - 15, 48, 3);
  // Cab
  ctx.fillStyle = '#f5b400';
  roundRect(x + 6, y - 46, 24, 21, 3);
  ctx.fill();
  ctx.fillStyle = '#bfe3ff';
  roundRect(x + 10, y - 42, 17, 11, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(x + 12, y - 41, 3, 9);
  // Roof
  ctx.fillStyle = '#d99a00';
  roundRect(x + 4, y - 49, 28, 4, 2);
  ctx.fill();
  // Snow (or leaves / petals) on the roof
  ctx.fillStyle = theme.roof;
  roundRect(x + 5, y - 52, 26, 4, 2);
  ctx.fill();
  // Blinking beacon
  const on = Math.floor(d.t * 3) % 2 === 0;
  ctx.fillStyle = on ? '#ff7a00' : '#a8501a';
  if (on) {
    ctx.shadowColor = 'rgba(255,140,0,0.9)';
    ctx.shadowBlur = 8;
  }
  ctx.beginPath();
  ctx.arc(x + 18, y - 54, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Exhaust pipe
  ctx.fillStyle = '#3a3a40';
  ctx.fillRect(x + 40, y - 38, 3.5, 12);
  // Arm to the blade
  ctx.strokeStyle = '#3a3a40';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 48, y - 20);
  ctx.lineTo(x + 62, y - 14);
  ctx.stroke();

  // Snow mound in front of the blade
  const m = moundSize(d.load);
  if (m.h > 0.5) {
    const bx = x + BLADE_X - 1;
    ctx.fillStyle = theme.pile[0];
    ctx.shadowColor = theme.shadow;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(bx, g);
    ctx.lineTo(bx, g - m.h);
    ctx.quadraticCurveTo(bx + m.w * 0.55, g - m.h * 1.05, bx + m.w, g);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Blade
  const bladeGrad = ctx.createLinearGradient(x + 58, 0, x + BLADE_X, 0);
  bladeGrad.addColorStop(0, '#7d8690');
  bladeGrad.addColorStop(1, '#b8c0c8');
  ctx.fillStyle = bladeGrad;
  ctx.beginPath();
  ctx.moveTo(x + 58, y - 29);
  ctx.quadraticCurveTo(x + BLADE_X, y - 15, x + 59, y);
  ctx.lineTo(x + BLADE_X, y);
  ctx.quadraticCurveTo(x + BLADE_X + 6, y - 15, x + 63, y - 29);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------- Main loop ----------
function update(dt) {
  windT += dt * 0.07;
  // Smooth, gusty wind from a few layered sines.
  const wind = Math.sin(windT) * 14 + Math.sin(windT * 2.7 + 1.3) * 7 + (cfg.intensity === 'blizzard' ? 45 : 0);
  const g = groundY();
  const target = targetCount();
  let regular = 0;

  for (let k = flakes.length - 1; k >= 0; k--) {
    const f = flakes[k];
    const prevBottom = f.y + f.r;
    if (f.g) {
      f.vy = Math.min(f.term, f.vy + f.g * dt);
      f.vx *= Math.exp(-dt * 1.5);
    }
    f.phase += f.freq * dt;
    if (theme.tumble) {
      f.rot += f.rotV * dt;
      f.flip += f.flipV * dt;
    }
    f.y += f.vy * dt;
    f.x += (f.vx + wind * (0.4 + f.z) + Math.sin(f.phase) * f.sway) * dt;

    if (f.x < -20) f.x += W + 40;
    else if (f.x > W + 20) f.x -= W + 40;
    const bottom = f.y + f.r;

    // Landed on top of a window?
    let landed = false;
    if (f.vy > 0) {
      for (let i = 0; i < windowPiles.length; i++) {
        const p = windowPiles[i];
        if (!p.contains(f.x)) continue;
        const surface = p.y - p.heightAt(f.x);
        // Hidden parts of an edge (covered by a window in front) are skipped via isVisibleAt.
        if (prevBottom <= surface + 1.5 && bottom >= surface && p.isVisibleAt(f.x)) {
          p.add(f.x, f.r * 2.2 * theme.deposit);
          if (theme.tumble) p.addDecal(f);
          landed = true;
          break;
        }
      }
    }
    // Landed on the ground (taskbar / dock)?
    if (!landed) {
      const floor = cfg.pileUp ? g - ground.heightAt(f.x) : g + 20;
      if (bottom >= floor && f.vy > 0) {
        const underDozer = dozer && f.x > dozer.x && f.x < dozer.x + BLADE;
        if (cfg.pileUp && f.x >= 0 && f.x < W && !underDozer) {
          ground.add(f.x, f.r * 1.3 * theme.deposit);
          if (theme.tumble) ground.addDecal(f);
        }
        landed = true;
      }
    }
    if (landed) {
      if (f.extra) {
        flakes[k] = flakes[flakes.length - 1];
        flakes.pop();
        extraCount--;
        continue;
      }
      resetFlake(f, false);
    }
    if (!f.extra) regular++;
  }
  if (regular < target) for (let i = regular; i < target; i++) flakes.push(newFlake(false));

  ground.update(dt, cfg.pileUp ? MELT_PER_SEC : 15);
  for (const p of windowPiles) p.update(dt, MELT_PER_SEC);
  updateBulldozer(dt);
}

function drawFlakes() {
  if (!theme.tumble) {
    for (const f of flakes) {
      const d = f.r * theme.drawScale;
      ctx.globalAlpha = f.alpha;
      ctx.drawImage(f.img, f.x - d / 2, f.y - d / 2, d, d);
    }
  } else {
    // Rotate and "turn over" each leaf / petal (squash it sideways as it flips).
    for (const f of flakes) {
      const d = f.r * theme.drawScale;
      const c = Math.cos(f.rot);
      const s = Math.sin(f.rot);
      const sx = 0.25 + 0.75 * Math.abs(Math.cos(f.flip));
      ctx.globalAlpha = f.alpha;
      ctx.setTransform(c * sx * dpr, s * sx * dpr, -s * dpr, c * dpr, f.x * dpr, f.y * dpr);
      ctx.drawImage(f.img, -d / 2, -d / 2, d, d);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ctx.globalAlpha = 1;
}

function frame(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - last) / 1000 || 0);
  last = t;
  update(dt);
  ctx.clearRect(0, 0, W, H);
  for (const p of windowPiles) p.draw();
  ground.draw();
  if (theme.tumble) {
    for (const p of windowPiles) p.drawDecals();
    ground.drawDecals();
  }
  drawBulldozer();
  drawFlakes();
  requestAnimationFrame(frame);
}

function start() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

function stop() {
  running = false;
  dozer = null;
  ctx.clearRect(0, 0, W, H);
}

window.addEventListener('resize', () => {
  resize();
  adjustFlakeCount(true);
});

let pendingWindows = [];
window.snow.onConfig((next) => {
  const firstConfig = flakes.length === 0;
  const themeChanged = next.theme && next.theme !== cfg.theme;
  cfg = { ...cfg, ...next };
  if (themeChanged) {
    // New season: start fresh with the new theme's particles and empty piles.
    theme = window.THEMES.get(cfg.theme);
    flakes = [];
    extraCount = 0;
    ground.clear();
    for (const p of windowPiles) p.clear();
  }
  resize();
  adjustFlakeCount(firstConfig || themeChanged);
  setWindows(pendingWindows);
  if (cfg.enabled) start();
  else stop();
});

window.snow.onWindows((list) => {
  pendingWindows = list;
  setWindows(list);
});

window.snow.onBulldoze(() => {
  if (running) startBulldozer();
});

resize();
