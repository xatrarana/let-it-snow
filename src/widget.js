// Snow globe countdown. Click to shake it, drag to move it.

const canvas = document.getElementById('globe');
const ctx = canvas.getContext('2d');
const W = 220;
const H = 260;
const dpr = window.devicePixelRatio || 1;
canvas.width = W * dpr;
canvas.height = H * dpr;
canvas.style.width = W + 'px';
canvas.style.height = H + 'px';
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

// Globe geometry
const CX = W / 2;
const CY = 100;
const R = 86;
const GROUND = CY + R * 0.5; // snow floor inside the globe
// Top of the snowy hill at x (a gentle mound left of center).
const hillY = (x) => GROUND - 14 * Math.max(0, 1 - ((x - CX + 12) / (R * 0.95)) ** 2);

// ---------- Countdown ----------
function countdown(now = new Date()) {
  const y = now.getFullYear();
  if (now.getMonth() === 11 && now.getDate() === 25) return { xmas: true };
  let target = new Date(y, 11, 25);
  if (now > target) target = new Date(y + 1, 11, 25);
  const ms = target - now;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return { xmas: false, days, hours, mins };
}

// ---------- Snow inside the globe ----------
const N = 140;
const flakes = [];
function floorAt(x) {
  // Floor follows the bottom of the circle so snow settles in the bowl.
  const dx = x - CX;
  const circle = CY + Math.sqrt(Math.max(0, (R - 6) ** 2 - dx * dx));
  return Math.min(hillY(x), circle);
}
function inside(x, y) {
  return (x - CX) ** 2 + (y - CY) ** 2 < (R - 5) ** 2;
}
for (let i = 0; i < N; i++) {
  const x = CX + (Math.random() * 2 - 1) * R * 0.75;
  flakes.push({ x, y: hillY(x) + Math.random() * 3, vx: 0, vy: 0, r: 0.8 + Math.random() * 1.6, settled: true });
}
let shakeEnergy = 0;
function shake(strength = 1) {
  shakeEnergy = 1;
  for (const f of flakes) {
    f.settled = false;
    const a = Math.random() * Math.PI * 2;
    const s = (60 + Math.random() * 160) * strength;
    f.vx = Math.cos(a) * s;
    f.vy = Math.sin(a) * s - 120 * strength;
  }
}

function updateFlakes(dt) {
  shakeEnergy = Math.max(0, shakeEnergy - dt * 1.8);
  const t = performance.now() / 1000;
  for (const f of flakes) {
    if (f.settled) continue;
    // Water drag + a slow swirl, then gentle sinking.
    const drag = Math.exp(-dt * 2.2);
    f.vx = f.vx * drag + Math.sin(t * 1.3 + f.y * 0.05) * 6 * dt;
    f.vy = f.vy * drag + 14 * dt;
    f.vy = Math.min(f.vy, 10 + f.r * 4); // terminal sinking speed
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (!inside(f.x, f.y)) {
      // bounce off the glass
      const dx = f.x - CX;
      const dy = f.y - CY;
      const d = Math.hypot(dx, dy) || 1;
      f.x = CX + (dx / d) * (R - 6);
      f.y = CY + (dy / d) * (R - 6);
      f.vx *= -0.3;
      f.vy *= -0.3;
    }
    const fl = floorAt(f.x);
    if (f.y >= fl && f.vy > 0 && shakeEnergy < 0.6) {
      // Snow near the glass slides down into the bowl instead of sticking to the wall.
      const edge = R * 0.78;
      if (Math.abs(f.x - CX) > edge) f.x = CX + Math.sign(f.x - CX) * (edge - Math.random() * 6);
      f.y = hillY(f.x) + Math.random() * 3;
      f.settled = true;
    }
  }
}

// ---------- Drawing ----------
function drawTree(x, base, h) {
  ctx.fillStyle = '#5b3a22';
  ctx.fillRect(x - 3, base - 8, 6, 8);
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const w = h * (0.62 - i * 0.14);
    const top = base - 8 - h * (0.35 + i * 0.27);
    const bottom = base - 6 - h * i * 0.25;
    ctx.fillStyle = i % 2 ? '#1f7a4a' : '#22895a';
    ctx.beginPath();
    ctx.moveTo(x, top - h * 0.12);
    ctx.lineTo(x - w / 2, bottom);
    ctx.lineTo(x + w / 2, bottom);
    ctx.closePath();
    ctx.fill();
  }
  // star
  ctx.fillStyle = '#ffd34d';
  star(x, base - 8 - h * 1.0, 6, 2.6);
  // ornaments
  const balls = [[-10, -22, '#e2443b'], [8, -32, '#4da3ff'], [-5, -44, '#ffd34d'], [11, -16, '#ffd34d'], [3, -54, '#e2443b']];
  for (const [dx, dy, c] of balls) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x + dx * (h / 70), base + dy * (h / 70), 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}
function star(x, y, ro, ri) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

function drawGlobe() {
  // Base
  const baseTop = CY + R * 0.88;
  const g1 = ctx.createLinearGradient(0, baseTop, 0, H);
  g1.addColorStop(0, '#b3262d');
  g1.addColorStop(1, '#6e1218');
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.moveTo(CX - R * 0.78, baseTop);
  ctx.lineTo(CX + R * 0.78, baseTop);
  ctx.quadraticCurveTo(CX + R * 0.98, H - 30, CX + R * 0.96, H - 8);
  ctx.quadraticCurveTo(CX, H + 2, CX - R * 0.96, H - 8);
  ctx.quadraticCurveTo(CX - R * 0.98, H - 30, CX - R * 0.78, baseTop);
  ctx.fill();
  // gold trim
  ctx.strokeStyle = '#e8c15a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CX - R * 0.8, baseTop + 3);
  ctx.lineTo(CX + R * 0.8, baseTop + 3);
  ctx.stroke();

  // Glass contents (clipped)
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, CY - R, 0, CY + R);
  sky.addColorStop(0, '#16244a');
  sky.addColorStop(1, '#3e6aa8');
  ctx.fillStyle = sky;
  ctx.fillRect(CX - R, CY - R, R * 2, R * 2);
  // little stars in the sky
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (const [sx, sy] of [[-40, -50], [30, -60], [55, -25], [-60, -15], [10, -35]]) ctx.fillRect(CX + sx, CY + sy, 1.5, 1.5);
  // snowy hill
  ctx.fillStyle = '#eef5ff';
  ctx.beginPath();
  ctx.moveTo(CX - R, hillY(CX - R) + 1);
  for (let x = CX - R; x <= CX + R; x += 4) ctx.lineTo(x, hillY(x) + 1);
  ctx.lineTo(CX + R, CY + R);
  ctx.lineTo(CX - R, CY + R);
  ctx.closePath();
  ctx.fill();
  drawTree(CX - 8, hillY(CX - 8) + 3, 66);
  // snow
  ctx.fillStyle = '#fff';
  for (const f of flakes) {
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Glass shine and rim
  const shine = ctx.createRadialGradient(CX - R * 0.35, CY - R * 0.45, 2, CX - R * 0.35, CY - R * 0.45, R * 0.6);
  shine.addColorStop(0, 'rgba(255,255,255,0.45)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(220,235,255,0.75)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawText() {
  const c = countdown();
  const baseTop = CY + R * 0.88;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  if (c.xmas) {
    ctx.font = '700 20px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('Merry Christmas!', CX, baseTop + 36);
  } else {
    ctx.font = '800 26px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(c.days === 1 ? '1 day' : `${c.days} days`, CX, baseTop + 32);
    ctx.font = '500 11.5px -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffe9b0';
    ctx.fillText(`${c.hours}h ${c.mins}m until Christmas`, CX, baseTop + 50);
  }
  ctx.shadowBlur = 0;
}

let last = performance.now();
let idleFrames = 0;
let sleepTimer = null;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  updateFlakes(dt);
  ctx.clearRect(0, 0, W, H);
  drawGlobe();
  drawText();
  // Once everything settles, redraw rarely to save battery.
  const moving = flakes.some((f) => !f.settled);
  idleFrames = moving ? 0 : idleFrames + 1;
  if (idleFrames > 2) {
    // Snow has settled: only refresh the countdown text every 30 seconds.
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      last = performance.now();
      requestAnimationFrame(frame);
    }, 30000);
  } else {
    requestAnimationFrame(frame);
  }
}

// ---------- Click to shake, drag to move ----------
let down = null;
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.screenX, y: e.screenY, moved: 0 };
});
window.addEventListener('mousemove', (e) => {
  if (!down) return;
  const dx = e.screenX - down.x;
  const dy = e.screenY - down.y;
  down.moved += Math.abs(dx) + Math.abs(dy);
  if (down.moved > 4) {
    canvas.classList.add('dragging');
    window.snow.dragBy(dx, dy);
  }
  down.x = e.screenX;
  down.y = e.screenY;
});
window.addEventListener('mouseup', () => {
  if (!down) return;
  if (down.moved <= 4) {
    shake(1);
    wake();
  } else {
    window.snow.dragEnd();
  }
  canvas.classList.remove('dragging');
  down = null;
});
document.getElementById('close').addEventListener('click', () => window.snow.hideWidget());

// If the loop is sleeping (all snow settled), wake it right away.
function wake() {
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
    idleFrames = 0;
    last = performance.now();
    requestAnimationFrame(frame);
  }
}

shake(0.5);
requestAnimationFrame(frame);
