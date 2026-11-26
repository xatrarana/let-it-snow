// Seasonal themes: what falls, how it moves, and what colour the piles are.
// Each theme pre-renders a few small sprites; the overlay picks one per particle.

(function () {
  const SPRITE = 48;

  function makeCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = SPRITE;
    return [c, c.getContext('2d')];
  }

  // ---------- Snow ----------
  function snowSprite() {
    const [c, g] = makeCanvas();
    const S = SPRITE;
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
  }

  // ---------- Autumn leaves ----------
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }

  function mapleLeaf(color) {
    const [c, g] = makeCanvas();
    const S = SPRITE;
    g.translate(S / 2, S / 2 + 2);
    g.shadowColor = 'rgba(40,20,0,0.35)';
    g.shadowBlur = 2;
    // Five pointed lobes from a polar curve.
    g.beginPath();
    const R = S * 0.42;
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * Math.PI * 2;
      const a = t - Math.PI / 2;
      const lobes = Math.pow(Math.abs(Math.cos(2.5 * t)), 0.55);
      const bottomCut = Math.sin(a) > 0.55 ? 0.45 : 1; // flatter base near the stem
      const r = R * (0.42 + 0.58 * lobes) * bottomCut;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    const grad = g.createRadialGradient(0, -2, 1, 0, 0, R);
    grad.addColorStop(0, shade(color, 35));
    grad.addColorStop(1, shade(color, -25));
    g.fillStyle = grad;
    g.fill();
    g.shadowBlur = 0;
    // veins and stem
    g.strokeStyle = shade(color, -60);
    g.lineWidth = 1;
    g.beginPath();
    for (const ang of [-90, -18, -162, 40, 140]) {
      const a = (ang * Math.PI) / 180;
      g.moveTo(0, 2);
      g.lineTo(Math.cos(a) * R * 0.7, 2 + Math.sin(a) * R * 0.7);
    }
    g.moveTo(0, 2);
    g.lineTo(1, R * 0.62);
    g.stroke();
    return c;
  }

  function ovalLeaf(color) {
    const [c, g] = makeCanvas();
    const S = SPRITE;
    g.translate(S / 2, S / 2);
    g.rotate(-0.5);
    g.shadowColor = 'rgba(40,20,0,0.35)';
    g.shadowBlur = 2;
    const L = S * 0.4;
    const Wd = S * 0.18;
    g.beginPath();
    g.moveTo(0, -L);
    g.quadraticCurveTo(Wd * 1.6, -L * 0.2, 0, L * 0.8);
    g.quadraticCurveTo(-Wd * 1.6, -L * 0.2, 0, -L);
    g.closePath();
    const grad = g.createLinearGradient(-Wd, 0, Wd, 0);
    grad.addColorStop(0, shade(color, 25));
    grad.addColorStop(1, shade(color, -30));
    g.fillStyle = grad;
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = shade(color, -60);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, -L * 0.85);
    g.lineTo(0, L * 1.0);
    for (let k = -2; k <= 2; k++) {
      const y = k * L * 0.25;
      g.moveTo(0, y);
      g.lineTo(Wd * 0.8, y - L * 0.15);
      g.moveTo(0, y);
      g.lineTo(-Wd * 0.8, y - L * 0.15);
    }
    g.stroke();
    return c;
  }

  // ---------- Cherry blossoms ----------
  function petal(color) {
    const [c, g] = makeCanvas();
    const S = SPRITE;
    g.translate(S / 2, S / 2);
    g.shadowColor = 'rgba(150,60,90,0.35)';
    g.shadowBlur = 2;
    const L = S * 0.34;
    const Wd = S * 0.26;
    // Rounded petal with the little notch at the tip.
    g.beginPath();
    g.moveTo(0, L);
    g.bezierCurveTo(Wd * 1.25, L * 0.4, Wd * 1.0, -L * 0.85, Wd * 0.22, -L);
    g.lineTo(0, -L * 0.78);
    g.lineTo(-Wd * 0.22, -L);
    g.bezierCurveTo(-Wd * 1.0, -L * 0.85, -Wd * 1.25, L * 0.4, 0, L);
    g.closePath();
    const grad = g.createRadialGradient(0, L * 0.6, 1, 0, 0, L * 1.2);
    grad.addColorStop(0, shade(color, -30));
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, shade(color, 30));
    g.fillStyle = grad;
    g.fill();
    return c;
  }

  function blossom() {
    // A whole five-petal flower, now and then among the petals.
    const [c, g] = makeCanvas();
    const S = SPRITE;
    g.translate(S / 2, S / 2);
    const p = petal('#ffc4d6');
    for (let i = 0; i < 5; i++) {
      g.save();
      g.rotate((i * Math.PI * 2) / 5);
      g.translate(0, -S * 0.17);
      g.scale(0.55, 0.55);
      g.drawImage(p, -S / 2, -S / 2);
      g.restore();
    }
    g.fillStyle = '#f7d046';
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      g.beginPath();
      g.arc(Math.cos(a) * 3, Math.sin(a) * 3, 1.3, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#d9486f';
    g.beginPath();
    g.arc(0, 0, 2, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  const LEAF_COLORS = ['#d9480f', '#e8590c', '#f08c00', '#c92a2a', '#b5651d', '#e0a526', '#9c3b16'];
  const PETAL_COLORS = ['#ffc2d4', '#ffb0c8', '#ffd3e0', '#f7a6c0', '#ffe1ea'];

  const defs = {
    snow: {
      label: 'Snow',
      noun: 'Snow',
      sprites: () => [snowSprite()],
      density: 1,
      size: [1.1, 3.4], // radius: min + z² * extra
      drawScale: 3.4,
      fall: [22, 55], // px/s: min + z * extra
      sway: [8, 22],
      tumble: false,
      deposit: 1,
      pile: ['rgba(255,255,255,0.98)', 'rgba(222,236,252,0.96)'],
      shadow: 'rgba(110,140,185,0.5)',
      roof: '#ffffff',
    },
    leaves: {
      label: 'Autumn leaves',
      noun: 'Leaves',
      sprites: () => [...LEAF_COLORS.map(mapleLeaf), ...LEAF_COLORS.slice(0, 4).map(ovalLeaf)],
      density: 0.3,
      size: [5.5, 4],
      drawScale: 3.6,
      fall: [26, 38],
      sway: [30, 55],
      tumble: true,
      deposit: 0.32,
      pile: ['#e07a2c', '#8a4518'],
      shadow: 'rgba(70,35,10,0.45)',
      roof: '#d9661f',
    },
    blossoms: {
      label: 'Cherry blossoms',
      noun: 'Petals',
      sprites: () => [...PETAL_COLORS.map(petal), ...PETAL_COLORS.map(petal), blossom()],
      density: 0.55,
      size: [3.2, 2.6],
      drawScale: 3.6,
      fall: [16, 26],
      sway: [22, 45],
      tumble: true,
      deposit: 0.4,
      pile: ['#ffd6e2', '#f2a2bd'],
      shadow: 'rgba(170,80,110,0.4)',
      roof: '#ffc4d6',
    },
  };

  const cache = {};
  window.THEMES = {
    get(name) {
      const def = defs[name] || defs.snow;
      if (!cache[name]) cache[name] = { ...def, images: def.sprites() };
      return cache[name];
    },
  };
})();
