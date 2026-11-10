// VisionStrike: rendering, game logic, input mapping and hit detection.
import { HandTracker } from './vision.js';

const W = 1280, H = 720;
const HORIZON = 300;                 // y where corridors meet the floor
const SPAWN_X = [150, 400, 640, 880, 1130]; // 5 corridor exits
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const btnHand = document.getElementById('btn-hand');
const btnMouse = document.getElementById('btn-mouse');
const video = document.getElementById('cam');

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ *
 * Asset pipeline: everything is generated procedurally at load time,
 * so there are no binary files to ship. Swap in real images/sounds by
 * replacing the make* functions.
 * ------------------------------------------------------------------ */
const OBSTACLES = [
  { type: 'pillar', x: 250, w: 80,  h: 290, base: 470 },
  { type: 'pillar', x: 950, w: 80,  h: 290, base: 470 },
  { type: 'desk',   x: 540, w: 220, h: 100, base: 560 },
  { type: 'desk',   x: 70,  w: 240, h: 115, base: 650 },
  { type: 'desk',   x: 970, w: 240, h: 115, base: 650 },
].map(o => ({ ...o, y: o.base - o.h }));

function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function makeBackground() {
  const c = offscreen(W, H), g = c.getContext('2d');
  // back wall
  let grad = g.createLinearGradient(0, 0, 0, HORIZON);
  grad.addColorStop(0, '#0a0c1c'); grad.addColorStop(1, '#171a33');
  g.fillStyle = grad; g.fillRect(0, 0, W, HORIZON);
  // wall panels + ceiling lights
  g.strokeStyle = 'rgba(0,240,255,.10)'; g.lineWidth = 2;
  for (let x = 0; x <= W; x += 80) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, HORIZON); g.stroke(); }
  for (let x = 100; x < W; x += 220) {
    g.fillStyle = 'rgba(180,240,255,.85)'; g.fillRect(x, 18, 90, 8);
    const l = g.createRadialGradient(x + 45, 22, 2, x + 45, 22, 90);
    l.addColorStop(0, 'rgba(0,240,255,.25)'); l.addColorStop(1, 'rgba(0,240,255,0)');
    g.fillStyle = l; g.fillRect(x - 50, 0, 190, 120);
  }
  // stage banner
  g.fillStyle = '#12142a'; g.fillRect(430, 104, 420, 46);
  g.strokeStyle = '#ff2bd6'; g.lineWidth = 3; g.strokeRect(430, 104, 420, 46);
  g.fillStyle = '#ff2bd6'; g.font = '800 30px Orbitron, monospace'; g.textAlign = 'center';
  g.fillText('WELCOME  ASSEMBLY', 640, 138);
  // floor
  grad = g.createLinearGradient(0, HORIZON, 0, H);
  grad.addColorStop(0, '#10122a'); grad.addColorStop(1, '#222648');
  g.fillStyle = grad; g.fillRect(0, HORIZON, W, H - HORIZON);
  // perspective floor lines
  g.strokeStyle = 'rgba(0,240,255,.13)'; g.lineWidth = 1.5;
  for (let i = -14; i <= 14; i++) {
    g.beginPath(); g.moveTo(640 + i * 60, HORIZON); g.lineTo(640 + i * 260, H); g.stroke();
  }
  for (let i = 1; i < 12; i++) {
    const y = HORIZON + Math.pow(i / 12, 1.8) * (H - HORIZON);
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  // seat rows silhouettes on both sides
  for (let r = 0; r < 5; r++) {
    const y = HORIZON + 20 + r * 16 * (1 + r * .35), s = 1 + r * .35;
    g.fillStyle = `rgba(6,7,16,${.9 - r * .08})`;
    for (let k = 0; k < 4; k++) {
      g.fillRect(10 + k * 34 * s, y, 26 * s, 14 * s);
      g.fillRect(W - 36 * s - k * 34 * s, y, 26 * s, 14 * s);
    }
  }
  // corridor openings
  for (const x of SPAWN_X) {
    const dg = g.createLinearGradient(0, HORIZON - 110, 0, HORIZON);
    dg.addColorStop(0, '#000'); dg.addColorStop(1, '#2a0a12');
    g.fillStyle = dg; g.fillRect(x - 40, HORIZON - 110, 80, 110);
    g.strokeStyle = '#ff3b3b'; g.lineWidth = 2; g.strokeRect(x - 40, HORIZON - 110, 80, 110);
    g.fillStyle = '#ff3b3b'; g.font = '700 10px monospace'; g.textAlign = 'center';
    g.fillText('EXIT', x, HORIZON - 116);
    const glow = g.createRadialGradient(x, HORIZON, 5, x, HORIZON, 80);
    glow.addColorStop(0, 'rgba(255,40,60,.30)'); glow.addColorStop(1, 'rgba(255,40,60,0)');
    g.fillStyle = glow; g.fillRect(x - 80, HORIZON - 80, 160, 160);
  }
  return c;
}

function makeObstacles() {
  // Each obstacle is pre-rendered into its own sprite.
  return OBSTACLES.map(o => {
    const c = offscreen(o.w, o.h), g = c.getContext('2d');
    if (o.type === 'pillar') {
      const gr = g.createLinearGradient(0, 0, o.w, 0);
      gr.addColorStop(0, '#2a2f4d'); gr.addColorStop(.5, '#4a5078'); gr.addColorStop(1, '#1f2340');
      g.fillStyle = gr; g.fillRect(0, 0, o.w, o.h);
      g.fillStyle = '#12142a'; g.fillRect(-2, 0, o.w + 4, 14); g.fillRect(-2, o.h - 18, o.w + 4, 18);
      g.strokeStyle = 'rgba(0,240,255,.7)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, o.w - 3, o.h - 3);
    } else {
      const top = Math.round(o.h * .32);
      g.fillStyle = '#6b4a30'; g.fillRect(0, 0, o.w, top);         // desk top
      g.fillStyle = '#8a6240'; g.fillRect(0, 0, o.w, 8);
      g.fillStyle = '#2b2d44'; g.fillRect(8, top, 12, o.h - top); g.fillRect(o.w - 20, top, 12, o.h - top);
      g.fillStyle = '#1a1c30'; g.fillRect(20, top, o.w - 40, o.h * .38);  // modesty panel
      g.strokeStyle = 'rgba(255,43,214,.75)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, o.w - 3, top);
    }
    return c;
  });
}

// Zombie sprite sheet: 4 walk frames x 3 variants (normal, runner, tank)
const SPR_W = 160, SPR_H = 240, FRAMES = 4;
const VARIANTS = [
  { skin: '#7fb06a', shirt: '#3b4a6b', pants: '#2a2f3a', eye: '#ff2a2a' },
  { skin: '#9bb8b0', shirt: '#7a3b3b', pants: '#33293a', eye: '#ffe14a' },
  { skin: '#a8645a', shirt: '#1d1f2b', pants: '#1a1a22', eye: '#ff2bd6' },
];

function drawZombieFrame(g, f, v) {
  const ph = (f / FRAMES) * Math.PI * 2, sw = Math.sin(ph), bob = Math.abs(Math.cos(ph)) * 4;
  g.save();
  g.translate(80, 140); g.rotate(sw * 0.045); g.translate(-80, -140 + bob * .5);
  g.lineCap = 'round';
  // legs
  g.strokeStyle = v.pants; g.lineWidth = 20;
  g.beginPath(); g.moveTo(68, 138); g.lineTo(66 + sw * 14, 228); g.stroke();
  g.beginPath(); g.moveTo(92, 138); g.lineTo(94 - sw * 14, 228); g.stroke();
  g.fillStyle = '#111'; g.fillRect(52 + sw * 14, 222, 28, 12); g.fillRect(80 - sw * 14, 222, 28, 12);
  // torso
  g.fillStyle = v.shirt; g.beginPath(); g.roundRect(52, 72, 56, 74, 10); g.fill();
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(60, 100, 14, 5); g.fillRect(84, 118, 18, 5);
  g.fillStyle = '#7a1018'; g.fillRect(56, 128, 10, 6);
  // arms stretched toward viewer
  g.strokeStyle = v.shirt; g.lineWidth = 15;
  g.beginPath(); g.moveTo(58, 88); g.lineTo(32, 112 + sw * 8); g.stroke();
  g.beginPath(); g.moveTo(102, 88); g.lineTo(128, 112 - sw * 8); g.stroke();
  g.fillStyle = v.skin;
  g.beginPath(); g.arc(30, 114 + sw * 8, 9, 0, 7); g.fill();
  g.beginPath(); g.arc(130, 114 - sw * 8, 9, 0, 7); g.fill();
  // head
  g.fillStyle = v.skin; g.beginPath(); g.arc(80, 48, 24, 0, 7); g.fill();
  g.fillStyle = '#1a1a1a';
  g.beginPath(); g.arc(80, 34, 25, Math.PI * 1.05, Math.PI * 1.95); g.fill();
  g.shadowColor = v.eye; g.shadowBlur = 8; g.fillStyle = v.eye;
  g.beginPath(); g.arc(71, 49, 4.5, 0, 7); g.fill();
  g.beginPath(); g.arc(89, 49, 4.5, 0, 7); g.fill();
  g.shadowBlur = 0;
  g.fillStyle = '#2a0505'; g.beginPath(); g.ellipse(80, 63, 9, 5 + (f % 2), 0, 0, 7); g.fill();
  g.restore();
}

function makeZombieSheets() {
  const sheet = offscreen(SPR_W * FRAMES, SPR_H * VARIANTS.length);
  const g = sheet.getContext('2d');
  VARIANTS.forEach((v, row) => {
    for (let f = 0; f < FRAMES; f++) {
      g.save(); g.translate(f * SPR_W, row * SPR_H);
      drawZombieFrame(g, f, v); g.restore();
    }
  });
  // white silhouette copy for hit flashes
  const flash = offscreen(sheet.width, sheet.height), fg = flash.getContext('2d');
  fg.drawImage(sheet, 0, 0);
  fg.globalCompositeOperation = 'source-in'; fg.fillStyle = '#fff'; fg.fillRect(0, 0, flash.width, flash.height);
  return { sheet, flash };
}

let assets = null;
function loadAssets() {
  const { sheet, flash } = makeZombieSheets();
  assets = { bg: makeBackground(), obstacles: makeObstacles(), sheet, flash };
}

/* ------------------------------ Audio ------------------------------ */
const sfx = (() => {
  let ac = null, noiseBuf = null;
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    ac = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(type, f0, f1, dur, vol = .2, delay = 0) {
    if (!ac) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
  }
  function noise(dur, vol = .3, freq = 2000) {
    if (!ac) return;
    const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    s.connect(f).connect(g).connect(ac.destination); s.start(t); s.stop(t + dur);
  }
  return {
    init,
    shoot() { noise(.18, .35, 3500); tone('square', 520, 60, .15, .15); },
    hit() { tone('sawtooth', 180, 60, .12, .2); },
    kill() { tone('sawtooth', 300, 40, .35, .22); noise(.2, .2, 800); },
    ricochet() { tone('triangle', 1800, 700, .1, .12); },
    empty() { tone('square', 140, 120, .05, .1); },
    reload() { tone('square', 300, 300, .04, .12); tone('square', 450, 450, .05, .12, .25); },
    hurt() { tone('sawtooth', 120, 40, .4, .3); noise(.25, .3, 600); },
    groan() { tone('sawtooth', rand(70, 110), rand(40, 60), .7, .06); },
    wave() { [330, 440, 550, 660].forEach((f, i) => tone('triangle', f, f, .2, .15, i * .1)); },
    over() { [400, 300, 220, 150].forEach((f, i) => tone('sawtooth', f, f * .8, .35, .2, i * .25)); },
  };
})();

/* ------------------------------ Zombie ------------------------------ */
const TYPES = {
  normal: { row: 0, speed: 1,   hp: 1, score: 100 },
  runner: { row: 1, speed: 1.8, hp: 1, score: 150 },
  tank:   { row: 2, speed: .65, hp: 4, score: 300 },
};

class Zombie {
  constructor(lane, type, wave) {
    this.lane = lane; this.type = type; const T = TYPES[type];
    this.spawnX = SPAWN_X[lane];
    this.endX = clamp(this.spawnX + rand(-260, 260), 120, W - 120);
    this.p = 0;                                    // progress 0 (corridor) -> 1 (player)
    this.speed = (0.045 + wave * 0.005) * T.speed * rand(.85, 1.15);
    this.hp = this.maxHp = T.hp + (type === 'normal' && wave >= 3 && Math.random() < .35 ? 1 : 0);
    this.score = T.score; this.row = T.row;
    this.phase = rand(0, 7); this.weave = rand(14, 34);
    this.anim = rand(0, 4); this.flash = 0; this.alive = true;
    this.update(0);
  }
  update(dt) {
    this.p += this.speed * dt;
    this.anim += dt * (4 + this.speed * 55);
    this.flash = Math.max(0, this.flash - dt);
    const p = this.p;
    this.scale = 0.3 + p * 1.0;                     // depth illusion
    this.y = HORIZON + p * (H + 30 - HORIZON);      // feet position
    this.x = lerp(this.spawnX, this.endX, p) + Math.sin(this.anim * .5 + this.phase) * this.weave * this.scale;
  }
  get box() {                                       // hitbox (feet at bottom-centre)
    const s = this.scale, w = SPR_W * s * .62, h = SPR_H * s * .97;
    return { x: this.x - w / 2, y: this.y - h, w, h };
  }
  contains(px, py, pad = 0) { const b = this.box; return px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad; }
  // Is an obstacle between the camera and this zombie (zombie's feet are above the cover's base)?
  coverOverlaps(o) {
    if (this.y >= o.base) return false;
    const b = this.box;
    return b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.base && b.y + b.h > o.y;
  }
  draw() {
    const s = this.scale, dw = SPR_W * s, dh = SPR_H * s, f = Math.floor(this.anim) % FRAMES;
    const sx = f * SPR_W, sy = this.row * SPR_H;
    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y - 2, dw * .26, dh * .04, 0, 0, 7); ctx.fill();
    ctx.drawImage(assets.sheet, sx, sy, SPR_W, SPR_H, this.x - dw / 2, this.y - dh * .97, dw, dh);
    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(1, this.flash * 6) * .8;
      ctx.drawImage(assets.flash, sx, sy, SPR_W, SPR_H, this.x - dw / 2, this.y - dh * .97, dw, dh);
      ctx.globalAlpha = 1;
    }
    if (this.maxHp > 1 && this.hp < this.maxHp) {   // health pip bar
      const bw = dw * .45, bx = this.x - bw / 2, by = this.y - dh * 1.02;
      ctx.fillStyle = '#300'; ctx.fillRect(bx, by, bw, 5 * Math.max(.6, s));
      ctx.fillStyle = '#ff3b3b'; ctx.fillRect(bx, by, bw * this.hp / this.maxHp, 5 * Math.max(.6, s));
    }
  }
}

/* --------------------------- Game state --------------------------- */
const state = {
  mode: 'menu',            // menu | playing | transition | gameover
  wave: 0, score: 0, best: 0, kills: 0, shots: 0, hits: 0,
  health: 100, ammo: 10, mag: 10, reload: 0,
  toSpawn: 0, spawnTimer: 0, timer: 0, shake: 0, hurtFlash: 0, lock: 0,
  zombies: [], particles: [], floaters: [], rings: [],
};
try { state.best = +localStorage.getItem('visionstrike-best') || 0; } catch (e) { /* ignore */ }

const aim = { x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, pinch: false, hand: false, history: [], mouseAt: 0 };
let tracker = null;

function resetGame() {
  Object.assign(state, {
    wave: 0, score: 0, kills: 0, shots: 0, hits: 0, health: 100, ammo: state.mag, reload: 0,
    zombies: [], particles: [], floaters: [], rings: [], hurtFlash: 0, shake: 0,
  });
  startWave();
}

function startWave() {
  state.wave++;
  state.mode = 'playing';
  state.toSpawn = 5 + state.wave * 3;
  state.spawnTimer = 1;
  state.timer = 0;
  sfx.wave();
}

function pickType(wave) {
  const r = Math.random();
  if (wave >= 4 && r < .15) return 'tank';
  if (wave >= 2 && r < .38) return 'runner';
  return 'normal';
}

function spawnZombie() {
  const lane = Math.floor(Math.random() * SPAWN_X.length);
  state.zombies.push(new Zombie(lane, pickType(state.wave), state.wave));
  state.toSpawn--;
  if (Math.random() < .4) sfx.groan();
}

/* ---------------------------- Effects ---------------------------- */
function burst(x, y, n, colors, speed = 260, size = 4) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(.2, 1) * speed;
    state.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: rand(.35, .8), max: .8,
      color: colors[Math.floor(Math.random() * colors.length)], size: rand(size * .5, size),
    });
  }
}
const floater = (x, y, text, color) => state.floaters.push({ x, y, text, color, life: 1 });
const ring = (x, y, color) => state.rings.push({ x, y, color, life: .25 });

function startReload() {
  if (state.reload > 0 || state.ammo === state.mag) return;
  state.reload = 1.0; sfx.reload();
}

/* ------------------------- Fire + hit detection ------------------------- */
function isOccluded(z, px, py) {
  return OBSTACLES.some(o => z.y < o.base && px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h);
}

function fire(px, py) {
  if (state.mode === 'gameover') {
    if (state.lock <= 0) resetGame();
    return;
  }
  if (state.mode !== 'playing' || state.reload > 0) return;
  if (state.ammo <= 0) { sfx.empty(); startReload(); return; }

  state.ammo--; state.shots++;
  sfx.shoot(); ring(px, py, '#00f0ff'); state.shake = Math.max(state.shake, 4);

  // Front-most zombie whose hitbox contains the shot and isn't hidden behind cover.
  const target = state.zombies
    .filter(z => z.alive && z.contains(px, py, 14) && !isOccluded(z, px, py)) // 14px aim-assist padding
    .sort((a, b) => b.y - a.y)[0];

  if (target) {
    const b = target.box, head = py < b.y + b.h * .27;
    target.hp -= head ? 2 : 1; target.flash = .15; state.hits++;
    burst(px, py, head ? 16 : 9, ['#7fff6a', '#b0ff90', '#ff3b3b'], 240);
    if (target.hp <= 0) {
      target.alive = false; state.kills++;
      const pts = target.score + (head ? 50 : 0);
      state.score += pts; sfx.kill();
      burst(target.x, b.y + b.h / 2, 34, ['#7fff6a', '#ff3b3b', '#00f0ff', '#ff2bd6'], 380, 6);
      floater(target.x, b.y, `+${pts}${head ? ' HEADSHOT' : ''}`, head ? '#ff2bd6' : '#00f0ff');
    } else {
      sfx.hit(); floater(px, py - 10, head ? 'HEAD' : 'HIT', '#ffe14a');
    }
  } else if (OBSTACLES.some(o => px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h)) {
    sfx.ricochet(); burst(px, py, 10, ['#ffe14a', '#fff'], 200, 3);
  }

  if (state.ammo === 0) startReload();
}

/* ------------------------------ Update ------------------------------ */
function update(dt, now) {
  updateAim(dt, now);
  state.lock = Math.max(0, state.lock - dt);
  state.shake = Math.max(0, state.shake - dt * 30);
  state.hurtFlash = Math.max(0, state.hurtFlash - dt * 2);

  for (const p of state.particles) { p.life -= dt; p.vy += 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  state.particles = state.particles.filter(p => p.life > 0);
  for (const f of state.floaters) { f.life -= dt; f.y -= 40 * dt; }
  state.floaters = state.floaters.filter(f => f.life > 0);
  for (const r of state.rings) r.life -= dt;
  state.rings = state.rings.filter(r => r.life > 0);

  if (state.mode === 'menu') return;

  for (const z of state.zombies) z.update(dt);

  if (state.mode === 'playing') {
    if (state.reload > 0) {
      state.reload -= dt;
      if (state.reload <= 0) { state.reload = 0; state.ammo = state.mag; }
    }
    if (state.toSpawn > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) { spawnZombie(); state.spawnTimer = Math.max(.5, 1.9 - state.wave * .12) * rand(.7, 1.3); }
    }
    // zombies that reach the player
    for (const z of state.zombies) {
      if (z.alive && z.p >= 1) {
        z.alive = false; state.health -= TYPES[z.type].hp > 1 ? 25 : 12;
        state.hurtFlash = 1; state.shake = 16; sfx.hurt();
      }
    }
    state.zombies = state.zombies.filter(z => z.alive);

    if (state.health <= 0) {
      state.health = 0; state.mode = 'gameover'; state.lock = 1.2; sfx.over();
      if (state.score > state.best) {
        state.best = state.score;
        try { localStorage.setItem('visionstrike-best', state.best); } catch (e) { /* ignore */ }
      }
    } else if (state.toSpawn === 0 && state.zombies.length === 0) {
      state.score += 50 * state.wave; state.health = Math.min(100, state.health + 15);
      state.mode = 'transition'; state.timer = 3.2;
    }
  } else if (state.mode === 'transition') {
    state.timer -= dt;
    if (state.timer <= 0) startWave();
  }
}

/* ----------------------- Input: hand + mouse mapping ----------------------- */
// Active camera zone mapped to the full canvas. Smaller than the whole frame so the edges of the
// screen are reachable while your hand is still comfortably (fully) inside the camera view.
const ZONE = { x0: 0.18, x1: 0.82, y0: 0.15, y1: 0.70 };
let lastShot = 0;

function updateAim(dt, now) {
  const hand = tracker ? tracker.detect(now) : null;
  aim.hand = !!hand;
  if (hand) {
    // Mirror horizontally (selfie view), then stretch the active zone over the whole canvas.
    aim.tx = clamp((1 - hand.x - ZONE.x0) / (ZONE.x1 - ZONE.x0), 0, 1) * W;
    aim.ty = clamp((hand.y - ZONE.y0) / (ZONE.y1 - ZONE.y0), 0, 1) * H;
    aim.ratio = hand.ratio;
    // Keep a short history of (position, pinch ratio). The index tip drifts while the thumb
    // closes, so a shot is fired at where the finger was *before* the pinch began.
    const last = aim.history[aim.history.length - 1];
    if (!last || last.t !== now) aim.history.push({ t: now, x: aim.tx, y: aim.ty, r: hand.ratio });
    while (aim.history.length > 1 && now - aim.history[0].t > 500) aim.history.shift();

    if (hand.pinching && !aim.pinch && now - lastShot > 140) {
      lastShot = now;
      const open = tracker.pinchOn * 1.7;  // "fingers still apart" threshold
      let s = null;
      for (let i = aim.history.length - 1; i >= 0; i--) {
        if (now - aim.history[i].t > 300) break;
        if (aim.history[i].r > open) { s = aim.history[i]; break; }
      }
      if (!s) s = aim.history.find(h => now - h.t <= 300) || aim.history[0];
      fire(s.x, s.y);
    }
    aim.pinch = hand.pinching;
  } else {
    aim.pinch = false; aim.ratio = null; aim.history.length = 0;
  }
  const k = 1 - Math.exp(-dt * (hand ? 45 : 28));
  aim.x = lerp(aim.x, aim.tx, k);
  aim.y = lerp(aim.y, aim.ty, k);
}

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
canvas.addEventListener('mousemove', e => {
  if (aim.hand) return;                       // hand tracking takes priority
  const p = canvasPoint(e); aim.tx = p.x; aim.ty = p.y;
});
canvas.addEventListener('mousedown', e => {
  const p = canvasPoint(e);
  if (!aim.hand) { aim.tx = aim.x = p.x; aim.ty = aim.y = p.y; }
  fire(p.x, p.y);
});
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); fire(aim.x, aim.y); }
  if (e.code === 'KeyR' && state.mode === 'playing') startReload();
  if (tracker && (e.key === '+' || e.key === '=')) tracker.pinchOn = Math.min(.6, tracker.pinchOn + .02);  // easier pinch
  if (tracker && (e.key === '-' || e.key === '_')) tracker.pinchOn = Math.max(.15, tracker.pinchOn - .02); // stricter pinch
});

/* ------------------------------ Rendering ------------------------------ */
function render(now) {
  ctx.save();
  if (state.shake > 0) ctx.translate(rand(-state.shake, state.shake) * .5, rand(-state.shake, state.shake) * .5);

  // Painter's algorithm: background -> distant zombies -> cover -> foreground zombies -> HUD
  ctx.drawImage(assets.bg, 0, 0);

  const sorted = [...state.zombies].sort((a, b) => a.y - b.y);
  const distant = [], foreground = [];
  for (const z of sorted) (OBSTACLES.some(o => z.coverOverlaps(o)) ? distant : foreground).push(z);

  distant.forEach(z => z.draw());
  OBSTACLES.forEach((o, i) => ctx.drawImage(assets.obstacles[i], o.x, o.y));
  foreground.forEach(z => z.draw());

  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawHUD(now);
}

function neonText(text, x, y, size, color, align = 'left') {
  ctx.font = `800 ${size}px Orbitron, 'Courier New', monospace`;
  ctx.textAlign = align; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fillStyle = color;
  ctx.fillText(text, x, y); ctx.shadowBlur = 0;
}

function drawHUD(now) {
  if (state.hurtFlash > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .9);
    g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, `rgba(255,0,0,${state.hurtFlash * .55})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  for (const r of state.rings) {
    const t = 1 - r.life / .25;
    ctx.strokeStyle = r.color; ctx.lineWidth = 3; ctx.globalAlpha = 1 - t;
    ctx.beginPath(); ctx.arc(r.x, r.y, 12 + t * 40, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (const f of state.floaters) {
    ctx.globalAlpha = clamp(f.life * 1.5, 0, 1); neonText(f.text, f.x, f.y, 22, f.color, 'center'); ctx.globalAlpha = 1;
  }

  if (state.mode !== 'menu') {
    // health bar
    ctx.fillStyle = 'rgba(5,6,13,.7)'; ctx.fillRect(24, 22, 330, 44);
    ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 2; ctx.strokeRect(24, 22, 330, 44);
    const hp = state.health / 100;
    ctx.fillStyle = hp > .5 ? '#00f0ff' : hp > .25 ? '#ffe14a' : '#ff3b3b';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10; ctx.fillRect(32, 30, 314 * hp, 28); ctx.shadowBlur = 0;
    neonText('HEALTH', 32, 90, 15, '#00f0ff');

    // wave + score
    neonText(`WAVE ${state.wave}`, W / 2, 48, 30, '#ff2bd6', 'center');
    const left = state.toSpawn + state.zombies.length;
    neonText(`HOSTILES: ${left}`, W / 2, 76, 15, '#ff7a7a', 'center');
    neonText(`SCORE ${String(state.score).padStart(6, '0')}`, W - 24, 48, 28, '#00f0ff', 'right');
    neonText(`BEST ${String(state.best).padStart(6, '0')}`, W - 24, 76, 15, '#8fdcff', 'right');

    // ammo
    for (let i = 0; i < state.mag; i++) {
      const x = 32 + i * 26, on = i < state.ammo;
      ctx.fillStyle = on ? '#ffe14a' : 'rgba(255,225,74,.15)';
      ctx.shadowColor = '#ffe14a'; ctx.shadowBlur = on ? 8 : 0;
      ctx.fillRect(x, H - 64, 14, 34); ctx.fillRect(x + 3, H - 72, 8, 8); ctx.shadowBlur = 0;
    }
    if (state.reload > 0) {
      ctx.fillStyle = 'rgba(255,225,74,.25)'; ctx.fillRect(32, H - 22, 200, 8);
      ctx.fillStyle = '#ffe14a'; ctx.fillRect(32, H - 22, 200 * (1 - state.reload / 1.0), 8);
      neonText('RELOADING', 244, H - 14, 14, '#ffe14a');
    } else if (state.ammo === 0) neonText('PINCH TO RELOAD', 32, H - 14, 14, '#ff3b3b');

    // tracker status
    const label = tracker && tracker.ready ? (aim.hand ? (aim.pinch ? 'HAND: PINCH' : 'HAND: TRACKING') : 'HAND: SEARCHING...') : 'INPUT: MOUSE';
    if (tracker && tracker.ready) neonText(`PINCH SENS ${Math.round(tracker.pinchOn * 100)}  (+/-)`, W - 24, H - 42, 12, '#8fdcff', 'right');
    neonText(label, W - 24, H - 20, 14, aim.hand ? '#7fff6a' : '#ffd24a', 'right');
  }

  if (state.mode === 'transition') {
    ctx.fillStyle = 'rgba(3,4,12,.55)'; ctx.fillRect(0, H / 2 - 90, W, 180);
    neonText(`WAVE ${state.wave} CLEARED`, W / 2, H / 2 - 15, 54, '#00f0ff', 'center');
    neonText(`+${50 * state.wave} BONUS  //  WAVE ${state.wave + 1} INCOMING`, W / 2, H / 2 + 40, 22, '#ff2bd6', 'center');
  } else if (state.mode === 'gameover') {
    ctx.fillStyle = 'rgba(20,0,5,.78)'; ctx.fillRect(0, 0, W, H);
    neonText('YOU WERE OVERRUN', W / 2, H / 2 - 100, 60, '#ff3b3b', 'center');
    const acc = state.shots ? Math.round(state.hits / state.shots * 100) : 0;
    neonText(`SCORE ${state.score}   BEST ${state.best}`, W / 2, H / 2 - 30, 30, '#00f0ff', 'center');
    neonText(`WAVE ${state.wave}   KILLS ${state.kills}   ACCURACY ${acc}%`, W / 2, H / 2 + 20, 22, '#bfefff', 'center');
    if (state.lock <= 0 && Math.floor(now / 500) % 2 === 0) neonText('PINCH OR CLICK TO RETRY', W / 2, H / 2 + 100, 28, '#ff2bd6', 'center');
  }

  drawCrosshair(now);
}

function drawCrosshair(now) {
  const { x, y } = aim, c = aim.pinch ? '#ff2bd6' : '#00f0ff', r = aim.pinch ? 17 : 24;
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2.5; ctx.shadowColor = c; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  ctx.rotate(now / 1500);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(r - 6, 0); ctx.lineTo(r + 12, 0); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();
  ctx.restore();
  if (aim.ratio != null && tracker) {          // pinch meter: fills as the fingers close; full = fires
    const f = clamp(1 - (aim.ratio - tracker.pinchOn) / (tracker.pinchOn * 1.4), 0, 1);
    ctx.save(); ctx.translate(x, y); ctx.lineWidth = 4; ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(0, 0, 38, 0, 7); ctx.stroke();
    ctx.strokeStyle = aim.pinch ? '#ff2bd6' : '#ffe14a';
    ctx.beginPath(); ctx.arc(0, 0, 38, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

/* ------------------------------ Boot / loop ------------------------------ */
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  update(dt, now);
  render(now);
  requestAnimationFrame(frame);
}

function begin() {
  overlay.classList.add('hidden');
  resetGame();
}

btnMouse.addEventListener('click', () => { sfx.init(); begin(); });
btnHand.addEventListener('click', async () => {
  sfx.init();
  btnHand.disabled = btnMouse.disabled = true;
  try {
    tracker = new HandTracker(video);
    await tracker.init(msg => { statusEl.textContent = msg; });
    statusEl.textContent = '';
    begin();
  } catch (err) {
    console.error(err);
    tracker = null;
    statusEl.textContent = `Hand tracking unavailable (${err.message || err.name}). You can still play with the mouse.`;
  } finally {
    btnHand.disabled = btnMouse.disabled = false;
  }
});

loadAssets();
requestAnimationFrame(frame);
