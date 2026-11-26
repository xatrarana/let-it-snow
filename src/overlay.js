// Falling snow drawn on a transparent full-screen canvas.
// Flakes drift with a slowly changing wind and, if enabled, pile up on the
// taskbar / dock line at the bottom of the screen.

const canvas = document.getElementById('snow');
const ctx = canvas.getContext('2d');

// Flakes per 1920x1080 screen.
const DENSITY = { light: 70, medium: 170, heavy: 360, blizzard: 700 };
const BIN = 4; // px width of each column in the snow pile
const MAX_PILE = 28; // px, so the pile never covers too much of the taskbar
const MELT_PER_SEC = 0.01; // px/s, a very slow melt so old snow fades over time

let cfg = { enabled: true, intensity: 'medium', pileUp: true, groundY: innerHeight, width: innerWidth, height: innerHeight };
let W = innerWidth;
let H = innerHeight;
let dpr = window.devicePixelRatio || 1;
let flakes = [];
let pile = new Float32Array(Math.ceil(W / BIN) + 1);
let running = false;
let last = 0;
let windT = Math.random() * 1000;

function resize() {
  W = innerWidth;
  H = innerHeight;
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const n = Math.ceil(W / BIN) + 1;
  if (n !== pile.length) {
    const old = pile;
    pile = new Float32Array(n);
    pile.set(old.subarray(0, Math.min(old.length, n)));
  }
}

function groundY() {
  // groundY is in window coordinates; fall back to the canvas bottom.
  const g = cfg.groundY;
  return g > 0 && g <= H ? g : H;
}

function newFlake(anywhere) {
  // Depth: far flakes are small, slow and faint; near flakes are big and fast.
  const z = Math.random();
  const r = 1.1 + z * z * 3.4;
  return {
    x: Math.random() * W,
    y: anywhere ? Math.random() * H : -10 - Math.random() * 40,
    r,
    vy: 22 + z * 55 + Math.random() * 12, // px/s
    sway: 8 + Math.random() * 22,
    phase: Math.random() * Math.PI * 2,
    freq: 0.4 + Math.random() * 1.1,
    alpha: 0.45 + z * 0.5,
    z,
  };
}

function targetCount() {
  const base = DENSITY[cfg.intensity] ?? DENSITY.medium;
  return Math.round(base * (W * H) / (1920 * 1080));
}

function adjustFlakeCount(initial) {
  const target = targetCount();
  while (flakes.length < target) flakes.push(newFlake(initial));
  if (flakes.length > target) flakes.length = target;
}

function addToPile(x, amount) {
  const i = Math.max(0, Math.min(pile.length - 1, Math.floor(x / BIN)));
  // Let snow slide off steep spots so the pile stays a smooth drift.
  let j = i;
  for (let step = 0; step < 6; step++) {
    const l = j > 0 ? pile[j - 1] : Infinity;
    const r = j < pile.length - 1 ? pile[j + 1] : Infinity;
    const lower = Math.min(l, r);
    if (pile[j] - lower > 1.2) j = l < r ? j - 1 : j + 1;
    else break;
  }
  pile[j] = Math.min(MAX_PILE, pile[j] + amount);
}

function pileHeightAt(x) {
  const i = Math.max(0, Math.min(pile.length - 1, Math.floor(x / BIN)));
  return pile[i];
}

function update(dt) {
  windT += dt * 0.07;
  // Smooth, gusty wind from a few layered sines.
  const wind = Math.sin(windT) * 14 + Math.sin(windT * 2.7 + 1.3) * 7 + (cfg.intensity === 'blizzard' ? 45 : 0);
  const g = groundY();

  for (let k = 0; k < flakes.length; k++) {
    const f = flakes[k];
    f.phase += f.freq * dt;
    f.y += f.vy * dt;
    f.x += (wind * (0.4 + f.z) + Math.sin(f.phase) * f.sway) * dt;

    if (f.x < -20) f.x += W + 40;
    else if (f.x > W + 20) f.x -= W + 40;

    const floor = cfg.pileUp ? g - pileHeightAt(f.x) : g + 20;
    if (f.y + f.r >= floor) {
      if (cfg.pileUp && f.x >= 0 && f.x < W) addToPile(f.x, f.r * 0.9);
      flakes[k] = newFlake(false);
    }
  }

  // Slow melting and a bit of smoothing.
  const melt = MELT_PER_SEC * dt;
  for (let i = 0; i < pile.length; i++) {
    if (pile[i] > 0) pile[i] = Math.max(0, pile[i] - (cfg.pileUp ? melt : 15 * dt));
  }
  for (let i = 1; i < pile.length - 1; i++) {
    const avg = (pile[i - 1] + pile[i + 1]) / 2;
    pile[i] += (avg - pile[i]) * 0.05;
  }
}

function drawPile() {
  const g = groundY();
  let any = false;
  for (let i = 0; i < pile.length; i++) if (pile[i] > 0.3) { any = true; break; }
  if (!any) return;

  ctx.beginPath();
  ctx.moveTo(0, g);
  for (let i = 0; i < pile.length; i++) {
    ctx.lineTo(i * BIN + BIN / 2, g - pile[i]);
  }
  ctx.lineTo(W, g);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, g - MAX_PILE, 0, g);
  grad.addColorStop(0, 'rgba(255,255,255,0.97)');
  grad.addColorStop(1, 'rgba(220,234,250,0.95)');
  ctx.fillStyle = grad;
  ctx.shadowColor = 'rgba(120,150,190,0.45)';
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
}

// One pre-rendered soft flake sprite, scaled per flake (much faster than shadows).
const sprite = (() => {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // faint dark halo so flakes stay visible over white windows
  let grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(60,90,130,0.5)');
  grad.addColorStop(1, 'rgba(70,100,140,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.3);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return c;
})();

function drawFlakes() {
  for (const f of flakes) {
    const d = f.r * 3.4;
    ctx.globalAlpha = f.alpha;
    ctx.drawImage(sprite, f.x - d / 2, f.y - d / 2, d, d);
  }
  ctx.globalAlpha = 1;
}

function frame(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - last) / 1000 || 0);
  last = t;
  update(dt);
  ctx.clearRect(0, 0, W, H);
  drawPile();
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
  ctx.clearRect(0, 0, W, H);
}

window.addEventListener('resize', () => {
  resize();
  adjustFlakeCount(true);
});

window.snow.onConfig((next) => {
  const firstConfig = flakes.length === 0;
  cfg = { ...cfg, ...next };
  resize();
  adjustFlakeCount(firstConfig);
  if (cfg.enabled) start();
  else stop();
});

resize();
