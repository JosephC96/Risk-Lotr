/* Board: the 2D map view. Camera, ownership washes, tokens, lettering, highlights,
   battle effects, and the living-map animations (clouds, ships, birds, smoke, rivers). */
(function (G) {
  const D = G.DATA; const { W, H, TERR } = D; const NT = TERR.length;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const SHIELD = new Path2D('M6 4 H94 V50 C94 84 72 104 50 117 C28 104 6 84 6 50 Z');
  const BASTION = new Path2D('M-5 -5h2v2h2v-2h2v2h2v-2h2v3l-1 2v5h-8v-5l-1-2z');
  const BASTION_X = -10, BASTION_Y = -16, BASTION_RADIUS = 9;
  const EMB = {}; for (const k in D.EMBLEMS) EMB[k] = new Path2D(D.EMBLEMS[k]);
  const INK = '#27241b';
  const B = {
    sel: -1, src: -1, hover: -1, targets: new Set(), targetKind: null, arrow: null, regionHi: -1,
    fx: [], life: true, dirty: true, onClick: null, onHover: null, cam: { x: W / 2, y: H / 2, z: 1 }, camT: null, shakeT: null,
    actionable: new Set(), vel: null, zoomT: null, pad: 0, padT: 0, keys: new Set(),
  };
  let cv, ctx, world, smp, statics, paths, regionPaths, tint, tintKey = '', riverPaths = [], cloudPat = null, puffs = [], clouds = [], ships = [], flocks = [], lastT = 0;
  let ownerPrev = null, armPrev = [], popT = [], popDir = [], motes = [];
  const TS = 0.7; // tint cache scale
  // Phones and tablets: the same picture, painted more cheaply (see mips, token sprites, the ambient frame rate)
  const LITE = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || Math.min(screen.width, screen.height) < 700;
  let mips = [], tintLo = null, lastDraw = 0, base = null, bctx = null, baseKey = '', keySeen = '';
  const sprites = new Map(); let spriteTs = 0, spriteDpr = 0, tsLast = 0, tsSince = 0;
  const gov = { prev: 0, sum: 0, n: 0, bad: 0, hold: 0, base: 0, q0: 1, locked: false };
  const SH = G.SHEET && G.SHEET.on ? G.SHEET : null;          // the sea, border, paper and table round the user's map
  const LIFE = () => (G.LIFE && G.LIFE.ready ? G.LIFE : null);
  const VIEW_H = 0.52;                                        // on a wide screen the home view shows this much of the map's height
  let mini = null, mctx = null, miniBase = null, miniOwn = null, miniOwnKey = '', miniKey = '', miniDrag = false;

  function init(canvas, w, staticCanvas) {
    cv = canvas; ctx = cv.getContext('2d'); world = w; statics = staticCanvas; smp = G.MAPGEN.makeSampler(world);
    paths = world.borders.terrPaths.map(p => p.path);
    regionPaths = D.REGIONS.map(r => { const p = new Path2D(); TERR.forEach((t, i) => { if (t.region === r.id) p.addPath(paths[i]); }); return p; });
    tint = document.createElement('canvas'); tint.width = Math.round(W * TS); tint.height = Math.round(H * TS);
    tintLo = document.createElement('canvas'); tintLo.width = Math.round(tint.width / 2); tintLo.height = Math.round(tint.height / 2);
    // Smaller copies of the map, each half the last. Seen from afar the frame samples the one nearest
    // its own size, instead of squeezing fifteen million pixels into a phone screen sixty times a second.
    mips = [{ c: statics, s: statics.width / W }];
    for (let cur = statics; cur.width > 1300;) { const m = document.createElement('canvas'); m.width = Math.round(cur.width / 2); m.height = Math.round(cur.height / 2); const x = m.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, m.width, m.height); mips.push({ c: m, s: m.width / W }); cur = m; }
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { sprites.clear(); B.dirty = true; });
    if (G.LIFE && world.custom) G.LIFE.init(world, smp); else buildLife();
    buildMini();
    resize(); window.addEventListener('resize', resize); bindInput(); requestAnimationFrame(loop);
  }

  /* ---------- camera ---------- */
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    const wasHome = B.homeZ && Math.abs(B.cam.z - B.homeZ) < B.homeZ * 0.012;
    B.dpr = Math.min(window.devicePixelRatio || 1, 2) * (B.q || 1); B.w = Math.max(50, r.width); B.h = Math.max(50, r.height);
    cv.width = Math.round(B.w * B.dpr); cv.height = Math.round(B.h * B.dpr); cv.style.width = B.w + 'px'; cv.style.height = B.h + 'px';
    const first = !B.homeZ;
    if (SH) {
      // Home fills the width of the window. A tall map on a wide screen is shown closer, and the
      // sea is carried on to the west for as far as the window needs, so there is never an empty margin.
      const edge = SH.BAND + 24, zAll = Math.min(B.w / (W + edge * 2), B.h / (H + edge * 2));
      let home = Math.min(B.w / (W + edge * 2), B.h / (H * VIEW_H)); if (home < zAll * 1.22) home = zAll;
      const apron = B.w / home - W - edge * 2; SH.layout(apron < 60 ? 0 : apron); if (LIFE()) LIFE().setApron(SH.A);
      B.bounds = SH.bounds; B.homeZ = home; B.homeX = (SH.print.x0 + SH.print.x1) / 2;
      B.allZ = Math.min(B.w / (SH.paper.x1 - SH.paper.x0), B.h / (SH.paper.y1 - SH.paper.y0));
    } else { B.bounds = { x0: 0, y0: 0, x1: W, y1: H }; B.homeZ = B.allZ = Math.min(B.w / W, B.h / H); B.homeX = W / 2; }
    B.fitZ = B.homeZ; B.coverZ = Math.max(B.w / W, B.h / H);
    B.minZ = Math.min(B.homeZ, B.allZ) * 0.98; B.maxZ = Math.max(B.homeZ * 4.2, 1.8);
    if (first || wasHome) { B.cam.z = B.homeZ; B.cam.x = B.homeX; if (first) B.cam.y = H / 2; }
    B.cam.z = clamp(B.cam.z, B.minZ, B.maxZ); clampCam(); sizeMini(); B.dirty = true;
  }
  // pad: screen pixels at the bottom covered by a panel (the battle table); the map makes room for it
  function clampCam() {
    // room is granted for the panel's full height at once, so a pan towards it is never cut short while it slides in
    const c = B.cam, b = B.bounds, hw = B.w / (2 * c.z), hh = B.h / (2 * c.z), pb = B.pad / c.z, pm = Math.max(B.pad, B.padT) / c.z, bw = b.x1 - b.x0, bh = b.y1 - b.y0, my = (b.y0 + b.y1) / 2;
    c.x = hw * 2 >= bw ? (b.x0 + b.x1) / 2 : clamp(c.x, b.x0 + hw, b.x1 - hw);
    c.y = hh * 2 - pb >= bh ? my + pb / 2 : hh * 2 >= bh ? clamp(c.y, my, my + pm / 2) : clamp(c.y, b.y0 + hh, b.y1 - hh + pm);
  }
  function setPad(px) { B.padT = px > 0 && B.h ? Math.min(px, B.h * 0.62) : 0; B.dirty = true; if (!B.padT && B.autoZ) { animTo({ z: B.autoZ }, 650); B.autoZ = null; } }
  const toWorld = (sx, sy) => [(sx - B.w / 2) / B.cam.z + B.cam.x, (sy - B.h / 2) / B.cam.z + B.cam.y];
  const toScreen = (x, y) => [(x - B.cam.x) * B.cam.z + B.w / 2, (y - B.cam.y) * B.cam.z + B.h / 2];
  function animTo(o, ms, ease) { B.vel = null; B.zoomT = null; B.camT = { from: { ...B.cam }, to: Object.assign({ ...B.cam }, o), t0: performance.now(), ms: ms || 550, ease: ease || 'out' }; }
  // home: the working view. overview: the whole sheet lying on the table. fit: toggles between the two.
  function goHome(keepY) { animTo({ x: B.homeX, y: keepY === true ? B.cam.y : H / 2, z: B.homeZ }); }
  function overview() { animTo({ x: (B.bounds.x0 + B.bounds.x1) / 2, y: (B.bounds.y0 + B.bounds.y1) / 2, z: Math.min(B.allZ, B.homeZ) }); }
  function fit() { const to = B.camT ? B.camT.to.z : B.cam.z; if (Math.abs(to - B.homeZ) < B.homeZ * 0.03 && B.allZ < B.homeZ * 0.96) overview(); else goHome(true); }
  // opening shot: start close on the White City and pull back to the working view
  function intro(ms = 3200) { const z = clamp(B.homeZ * 2.3, B.minZ, B.maxZ); B.cam.z = z; B.cam.x = W * 0.6; B.cam.y = H * 0.68; clampCam(); animTo({ x: B.homeX, y: H / 2, z: B.homeZ }, ms, 'inout'); return ms; }
  function focus(t) { animTo({ x: TERR[t].lx, y: TERR[t].ly }); }
  function zoomBy(f) { animTo({ z: clamp(B.cam.z * f, B.minZ, B.maxZ) }); }
  function ensureVisible(ts, bottom) {
    const m = Math.min(90, B.w * 0.16); let dx = 0, dy = 0; const mb = Math.min(B.h * 0.62, Math.max(m, bottom || 0));
    // two lands too far apart for this zoom (an attack along a sea lane): pull back just enough to hold both
    if (bottom && ts.length > 1) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const t of ts) { x0 = Math.min(x0, TERR[t].lx); x1 = Math.max(x1, TERR[t].lx); y0 = Math.min(y0, TERR[t].ly); y1 = Math.max(y1, TERR[t].ly); }
      const z = B.camT ? B.camT.to.z : B.cam.z, need = Math.min((B.w - m * 2) / Math.max(1, x1 - x0), (B.h - m - mb) / Math.max(1, y1 - y0)) * 0.9;
      if (need < z) { const nz = clamp(need, B.minZ, z); if (!B.autoZ) B.autoZ = z; animTo({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 + (mb - m) / (2 * nz), z: nz }, 650); return; }
    }
    for (const t of ts) { const [x, y] = toScreen(TERR[t].lx, TERR[t].ly); if (x < m) dx = Math.min(dx, x - m); if (x > B.w - m) dx = Math.max(dx, x - (B.w - m)); if (y < m) dy = Math.min(dy, y - m); if (y > B.h - mb) dy = Math.max(dy, y - (B.h - mb)); }
    if (dx || dy) animTo({ x: B.cam.x + dx / B.cam.z, y: B.cam.y + dy / B.cam.z });
  }
  function hit(sx, sy) {
    const scale = clamp(.35 + B.cam.z * 1.05, .5, 1.35);
    const bastions = G.GAME.S?.bastions;
    let nearest = -1, distance = Infinity;
    for (let i = 0; i < NT; i++) {
      const [tx, ty] = toScreen(TERR[i].lx, TERR[i].ly), dx = sx - tx, dy = sy - ty;
      if (Math.abs(dx - 6 * scale) < 24 * scale && Math.abs(dy) < 16 * scale) {
        const d = dx * dx + dy * dy;
        if (d < distance) { nearest = i; distance = d; }
      }
      if (bastions && TERR[i].bastion) {
        const d = (dx - BASTION_X * scale) ** 2 + (dy - BASTION_Y * scale) ** 2;
        if (d < distance && d <= (BASTION_RADIUS * scale) ** 2) { nearest = i; distance = d; }
      }
    }
    if (nearest >= 0) return nearest;
    const [x, y] = toWorld(sx, sy); if (x < 0 || y < 0 || x >= W || y >= H) return -1; const l = smp.lab(x, y); return l >= 0 ? l : -1;
  }

  /* ---------- ownership wash (cached) ---------- */
  function rebuildTint(S) {
    const key = S.owner.join(','); if (key === tintKey) return; tintKey = key;
    if (ownerPrev && ownerPrev.length === NT) {
      const ch = []; for (let i = 0; i < NT; i++) if (ownerPrev[i] !== S.owner[i] && S.owner[i] >= 0) ch.push(i);
      if (ch.length && ch.length <= 6) for (const i of ch) B.fx.push({ k: 'wash', t: i, from: ownerPrev[i] >= 0 && S.players[ownerPrev[i]] ? S.players[ownerPrev[i]].color : null, to: S.players[S.owner[i]].light, t0: now(), dur: 900 });
    }
    ownerPrev = S.owner.slice();
    const c = tint.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.clearRect(0, 0, tint.width, tint.height);
    c.setTransform(TS, 0, 0, TS, 0, 0); c.lineJoin = 'round';
    for (let i = 0; i < NT; i++) {
      const o = S.owner[i]; if (o < 0) continue; const p = S.players[o];
      // a clear wash of the owner's colour, a soft inner glow and a strong band hugging the border
      c.globalAlpha = 0.09; c.fillStyle = p.color; c.fill(paths[i], 'evenodd');
      c.save(); c.clip(paths[i], 'evenodd'); c.strokeStyle = p.color;
      c.globalAlpha = 0.09; c.lineWidth = 34; c.stroke(paths[i]); c.globalAlpha = 0.15; c.lineWidth = 18; c.stroke(paths[i]);
      c.globalAlpha = 0.7; c.lineWidth = 6; c.stroke(paths[i]); c.restore();
    }
    c.globalAlpha = 1;
    const lo = tintLo.getContext('2d'); lo.clearRect(0, 0, tintLo.width, tintLo.height); lo.imageSmoothingQuality = 'high'; lo.drawImage(tint, 0, 0, tintLo.width, tintLo.height);
  }

  /* ---------- tokens ---------- */
  function drawShield(c, x, y, w, p, glow) {
    if (G.MATERIALS.drawShield(c, x, y, w, p, glow)) return;
    const h = w * 1.18; c.save(); c.translate(x - w / 2, y - h / 2); c.scale(w / 100, h / 120);
    c.shadowColor = glow || 'rgba(0,0,0,0.55)'; c.shadowBlur = glow ? 14 : 5; c.shadowOffsetY = glow ? 0 : 2;
    const g = c.createLinearGradient(0, 0, 100, 120); g.addColorStop(0, p.light); g.addColorStop(0.45, p.color); g.addColorStop(1, p.dark);
    c.fillStyle = g; c.fill(SHIELD); c.shadowColor = 'transparent';
    c.lineWidth = 9; c.strokeStyle = '#1e1a12'; c.stroke(SHIELD);
    const gg = c.createLinearGradient(0, 0, 0, 120); gg.addColorStop(0, '#f6df98'); gg.addColorStop(0.5, '#c99a3e'); gg.addColorStop(1, '#8a6224'); c.lineWidth = 5; c.strokeStyle = gg; c.stroke(SHIELD);
    c.translate(22, 20); c.scale(0.56, 0.56); c.fillStyle = 'rgba(0,0,0,0.35)'; c.translate(2, 3); c.fill(EMB[p.emblem], 'evenodd'); c.translate(-2, -3); c.fillStyle = '#f7eed6'; c.fill(EMB[p.emblem], 'evenodd');
    c.restore();
  }
  function rr(c, x, y, w, h, r) { c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function drawToken(c, x, y, s, p, n, state, pop, dir) {
    // soft contact shadow so the piece sits on the parchment
    c.save(); c.globalAlpha = 0.28; c.fillStyle = '#1a1208'; c.beginPath(); c.ellipse(x + 2 * s, y + 13 * s, 21 * s, 5.5 * s, 0, 0, 7); c.fill(); c.restore();
    pop = pop || 0; const ps = s * (1 + 0.32 * pop);
    const px = x - 2 * s, pw = (n >= 100 ? 34 : n >= 10 ? 28 : 22) * ps, ph = 19 * ps;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 4; c.shadowOffsetY = 2;
    // the number plate carries the owner's colour so ownership reads at a glance
    const pg = c.createLinearGradient(0, y - ph / 2, 0, y + ph / 2); pg.addColorStop(0, p.dark); pg.addColorStop(1, '#17120c');
    c.beginPath(); rr(c, px, y - ph / 2, pw, ph, 4 * s); c.fillStyle = pg; c.fill(); c.shadowColor = 'transparent';
    c.lineWidth = 1.4 * s; c.strokeStyle = pop > 0.05 ? (dir > 0 ? '#ffe9a6' : '#ff8a72') : state === 'sel' ? '#ffe9a6' : p.color; c.stroke();
    c.globalAlpha = 0.22; c.strokeStyle = '#fff3d0'; c.lineWidth = 1 * s; c.beginPath(); c.moveTo(px + 6 * s, y - ph / 2 + 1.6 * s); c.lineTo(px + pw - 4 * s, y - ph / 2 + 1.6 * s); c.stroke(); c.globalAlpha = 1;
    c.font = `700 ${13.5 * ps}px Cinzel, Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = 2.6 * s; c.strokeStyle = 'rgba(15,10,5,0.75)'; c.strokeText(String(n), px + pw / 2 + 4 * s, y + 1 * s);
    c.fillStyle = pop > 0.05 ? (dir > 0 ? '#fff0b8' : '#ffc2b2') : '#fff6e0'; c.fillText(String(n), px + pw / 2 + 4 * s, y + 1 * s);
    c.restore();
    drawShield(c, x - 8 * s, y, 25 * s, p, state === 'sel' ? '#ffd36a' : state === 'target' ? '#ff5a3a' : state === 'move' ? '#ffe28a' : null);
  }

  // A token at rest is painted once into a small sprite and stamped each frame. Its blurred shadows
  // and the shield art are far too slow to redo for sixty-four tokens on every frame of a phone.
  function tokenSprite(p, n, state, s) {
    const key = p.faction + '|' + n + '|' + (state || ''); let sp = sprites.get(key); if (sp) return sp;
    if (sprites.size > 180) sprites.clear();
    const d = B.dpr, ox = 26 * s + 16, oy = 18 * s + 16, w = ox + 36 * s + 12, h = oy + 20 * s + 12;
    const c = document.createElement('canvas'); c.width = Math.ceil(w * d); c.height = Math.ceil(h * d);
    const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.imageSmoothingQuality = 'high'; drawToken(x, ox, oy, s, p, n, state, 0, 0);
    sp = { c, ox, oy, w: c.width / d, h: c.height / d }; sprites.set(key, sp); return sp;
  }

  /* ---------- effects ---------- */
  const now = () => performance.now();
  function floatText(t, text, color) { B.fx.push({ k: 'text', t, text, color, t0: now(), dur: 1300 }); }
  function burst(t, color) { const parts = []; for (let i = 0; i < 22; i++) { const a = Math.random() * 6.283, v = 30 + Math.random() * 70; parts.push([Math.cos(a) * v, Math.sin(a) * v - 20, 2 + Math.random() * 3]); } B.fx.push({ k: 'burst', t, color, parts, t0: now(), dur: 850 }); }
  function ring(t, color) { B.fx.push({ k: 'ring', t, color, t0: now(), dur: 650 }); }
  function flash(t, color) { B.fx.push({ k: 'flash', t, color: color || '#fff', t0: now(), dur: 800 }); }
  function moveFx(a, b, color) { B.fx.push({ k: 'move', a, b, color, t0: now(), dur: 700 }); }
  function shake(ms = 360, amp = 6) { B.shakeT = { t0: now(), ms, amp }; }
  function volley(a, b, n, color, delay = 0) {
    const seed = []; for (let i = 0; i < n; i++) seed.push({ d: Math.random() * 0.3, lift: 26 + Math.random() * 46, sx: (Math.random() - 0.5) * 26, sy: (Math.random() - 0.5) * 18 });
    B.fx.push({ k: 'volley', a, b, n, color, seed, t0: now() + delay, dur: 560 });
  }
  function sparks(t, color, n = 16, delay = 0) { const parts = []; for (let i = 0; i < n; i++) parts.push([Math.random() * 6.283, 40 + Math.random() * 120]); B.fx.push({ k: 'sparks', t, color: color || '#ffd27a', parts, t0: now() + delay, dur: 520 }); }
  function dust(t, delay = 0) { const parts = []; for (let i = 0; i < 7; i++) parts.push([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 14, 6 + Math.random() * 8]); B.fx.push({ k: 'dust', t, parts, t0: now() + delay, dur: 900 }); }
  function impact(t, color, delay = 0) { sparks(t, color, 14, delay); dust(t, delay); }
  function shock(t, color) { B.fx.push({ k: 'shock', t, color, t0: now(), dur: 750 }); }
  function flag(t, color, dark) { B.fx.push({ k: 'flag', t, color, dark: dark || '#2a1a0c', t0: now(), dur: 1900 }); }
  function regionFx(r, color) { B.fx.push({ k: 'region', r, color, t0: now(), dur: 1900 }); }
  function conquest(t, p) { flash(t, p.light); burst(t, p.light); shock(t, p.light); flag(t, p.color, p.dark); shake(420, 7); }

  /* ---------- living map ---------- */
  function buildLife() {
    const rnd = G.NZ.mulberry32(909);
    riverPaths = world.rivers.map(r => { const p = new Path2D(); let pen = false; for (const q of r.pts) { if (smp.lab(q[0], q[1]) < 0) { pen = false; continue; } if (pen) p.lineTo(q[0], q[1]); else { p.moveTo(q[0], q[1]); pen = true; } } return p; });
    puffs = [3, 11, 19].map(s => G.ATLAS.cloudPuffCanvas(s));
    for (let i = 0; i < 8; i++) clouds.push({ x: rnd() * (W + 800) - 400, y: rnd() * H, s: 1.5 + rnd() * 1.4, v: 9 + rnd() * 9, k: i % 3, a: 0.34 + rnd() * 0.2 });
    const sea = ([x, y]) => smp.lab(x, y) === -1 && smp.seaD(x, y) > 5;
    const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * 6.283) * r, cy + Math.sin(i / n * 6.283) * r * 0.8]);
    (D.SHIP_ROUTES || [[[[70, 330], [112, 480], [84, 650], [62, 900], [104, 1040], [44, 720], [36, 470]], 13, 1],
     [[[700, 1300], [780, 1245], [860, 1228], [890, 1280], [820, 1345], [720, 1352]], 9, 0.85],
     [circle(1665, 480, 30, 8), 6, 0.7],
     [[[470, 1090], [560, 1180], [620, 1300], [520, 1352], [462, 1235]], 11, 0.95]]).forEach(([pts, speed, size], k) => {
      const ok = pts.filter(sea); if (ok.length < 3) return;
      const loop = G.MAPGEN.catmull(ok.concat([ok[0]]), 8); let len = 0; const cum = [0];
      for (let i = 1; i < loop.length; i++) { len += Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]); cum.push(len); }
      ships.push({ loop, cum, len, d: rnd() * len, speed, size, ph: k * 1.7 });
    });
    for (let f = 0; f < 3; f++) flocks.push(newFlock(rnd, true));
    for (let i = 0; i < 54; i++) motes.push({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.5, vx: (Math.random() - 0.3) * 0.012, vy: -0.004 - Math.random() * 0.012, ph: Math.random() * 6.283, tw: 0.6 + Math.random() * 1.6 });
  }
  // candle-lit dust drifting above the table, in screen space
  function drawMotes(t, dt) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      m.x += (m.vx + Math.sin(t * 0.4 + m.ph) * 0.004) * dt; m.y += m.vy * dt;
      if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); } if (m.x < -0.02) m.x = 1.02; else if (m.x > 1.02) m.x = -0.02;
      const a = 0.1 + 0.2 * (0.5 + 0.5 * Math.sin(t * m.tw + m.ph));
      ctx.fillStyle = `rgba(255,232,170,${a})`; ctx.beginPath(); ctx.arc(m.x * B.w, m.y * B.h, m.r, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function newFlock(rnd, anywhere) {
    const ang = (rnd() - 0.5) * 0.8 + (rnd() < 0.5 ? Math.PI : 0); const fromLeft = Math.cos(ang) > 0;
    return { x: anywhere ? rnd() * W : (fromLeft ? -120 : W + 120), y: 120 + rnd() * (H - 240), ang, v: 44 + rnd() * 18, n: 4 + ((rnd() * 4) | 0), ph: rnd() * 6 };
  }
  function shipAt(s) {
    let i = 1; while (i < s.cum.length - 1 && s.cum[i] < s.d) i++;
    const a = s.loop[i - 1], b = s.loop[i], t = (s.d - s.cum[i - 1]) / Math.max(1e-6, s.cum[i] - s.cum[i - 1]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, b[0] - a[0]];
  }
  function drawShip(c, x, y, size, flip, t) {
    c.save(); c.translate(x, y + Math.sin(t * 1.6) * 0.8); c.rotate(Math.sin(t * 1.2) * 0.05); c.scale(flip ? -size : size, size);
    c.strokeStyle = INK; c.lineWidth = 1.1; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-13, -2); c.quadraticCurveTo(0, 8, 15, -3); c.lineTo(11, -6); c.lineTo(-10, -6); c.closePath(); c.fillStyle = '#8d7b58'; c.fill(); c.stroke();
    c.beginPath(); c.moveTo(1, -6); c.lineTo(1, -27); c.stroke();
    c.beginPath(); c.moveTo(-8, -24); c.quadraticCurveTo(-2, -15, -8, -8); c.lineTo(10, -8); c.quadraticCurveTo(15, -16, 10, -24); c.closePath(); c.fillStyle = '#e9e0c2'; c.fill(); c.stroke();
    c.beginPath(); c.moveTo(1, -27); c.lineTo(7, -25.5); c.lineTo(1, -24); c.fillStyle = '#8f2c22'; c.fill();
    c.strokeStyle = 'rgba(39,44,36,0.45)'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-17, 3); c.quadraticCurveTo(-22, 1, -27, 4); c.moveTo(-15, 7); c.quadraticCurveTo(-21, 6, -25, 9); c.stroke();
    c.restore();
  }
  function drawLife(t, dt, S) {
    const z = B.cam.z, px = 1 / z;
    // rivers run
    ctx.save(); ctx.lineCap = 'round'; ctx.setLineDash([3, 14]); ctx.lineDashOffset = -t * 22; ctx.strokeStyle = 'rgba(232,244,244,0.6)'; ctx.lineWidth = 1.3;
    for (const p of riverPaths) ctx.stroke(p); ctx.restore();
    // ships
    for (const s of ships) { s.d = (s.d + s.speed * dt) % s.len; const [x, y, dx] = shipAt(s); drawShip(ctx, x, y, s.size, dx < 0, t + s.ph); }
    // volcano breath and the watching spire
    const [vx, vy] = D.VOLCANO || [1655, 958];
    const fl = 0.7 + 0.2 * Math.sin(t * 7.3) + 0.12 * Math.sin(t * 17.1);
    let g = ctx.createRadialGradient(vx, vy, 1, vx, vy, 34); g.addColorStop(0, `rgba(255,120,40,${0.55 * fl})`); g.addColorStop(1, 'rgba(255,80,20,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(vx, vy, 34, 0, 7); ctx.fill();
    for (let i = 0; i < 8; i++) { const ph = (t * 0.07 + i / 8) % 1; ctx.fillStyle = `rgba(52,48,44,${0.42 * (1 - ph) * Math.min(1, ph * 7)})`; ctx.beginPath(); ctx.arc(vx + ph * 46 + Math.sin(i * 2.1 + t * 0.6) * 3, vy - 6 - ph * 78, 5 + ph * 20, 0, 7); ctx.fill(); }
    const [ex, ey] = D.DARK_TOWER || [1722, 908], ep = 0.5 + 0.5 * Math.sin(t * 2.3) ** 2;
    g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 13); g.addColorStop(0, `rgba(255,110,40,${0.75 * ep})`); g.addColorStop(1, 'rgba(255,70,20,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, ey, 13, 0, 7); ctx.fill();
    // birds
    ctx.save(); ctx.strokeStyle = 'rgba(30,26,20,0.85)'; ctx.lineWidth = 1.15; ctx.lineCap = 'round';
    for (let f = 0; f < flocks.length; f++) {
      const fk = flocks[f]; fk.x += Math.cos(fk.ang) * fk.v * dt; fk.y += Math.sin(fk.ang) * fk.v * dt;
      if (fk.x < -160 || fk.x > W + 160 || fk.y < -80 || fk.y > H + 80) { flocks[f] = newFlock(Math.random, false); continue; }
      const ca = Math.cos(fk.ang), sa = Math.sin(fk.ang);
      for (let b = 0; b < fk.n; b++) {
        const row = Math.ceil(b / 2), side = b % 2 ? 1 : -1; const bx = fk.x - ca * row * 13 - sa * side * row * 9, by = fk.y - sa * row * 13 + ca * side * row * 9;
        const fa = Math.sin(t * 9 + fk.ph + b) * 2.6; ctx.beginPath(); ctx.moveTo(bx - 5, by - 1 + fa); ctx.quadraticCurveTo(bx - 2, by - 3.2, bx, by); ctx.quadraticCurveTo(bx + 2, by - 3.2, bx + 5, by - 1 + fa); ctx.stroke();
      }
    }
    ctx.restore();
    // cloud shadows, then the clouds themselves
    if (!cloudPat) cloudPat = ctx.createPattern(G.ATLAS.cloudShadowCanvas(256), 'repeat');
    const k = 1150 / 256, ox = (t * 14) % (256 * k), oy = (t * 3) % (256 * k);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); ctx.globalCompositeOperation = 'multiply'; ctx.translate(ox, oy); ctx.scale(k, k); ctx.fillStyle = cloudPat; ctx.fillRect(-ox / k - 1, -oy / k - 1, W / k + 2, H / k + 2); ctx.restore();
    const zk = clamp(1.25 - (z / B.fitZ - 1) * 0.9, 0.2, 1);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    for (const c of clouds) {
      c.x += c.v * dt; c.y += c.v * 0.16 * dt; if (c.x > W + 420) { c.x = -520; c.y = Math.random() * H; }
      ctx.globalAlpha = c.a * zk; const w = 320 * c.s, h = 200 * c.s; ctx.drawImage(puffs[c.k], c.x - w / 2, c.y - h / 2, w, h);
    }
    ctx.restore();
  }

  /* ---------- frame ---------- */
  function loop(tm) { requestAnimationFrame(loop); govern(tm); step(tm); }
  // Safety net for slow phones. If frames keep arriving late the map is painted at a lower resolution;
  // if that buys nothing (the browser is simply capping the rate) the full resolution comes back for good.
  function govern(tm) {
    if (!LITE || gov.locked) return; const d = tm - gov.prev; gov.prev = tm;
    if (!G.GAME.S || document.hidden || d <= 0 || d > 250 || tm < gov.hold) { gov.sum = gov.n = 0; return; }
    gov.sum += d; if (++gov.n < 90) return; const avg = gov.sum / gov.n; gov.sum = gov.n = 0;
    if (gov.base) {
      if (avg > gov.base * 0.87) { B.q = gov.q0; gov.locked = true; resize(); } else if (B.q <= 0.7) gov.locked = true;
      gov.base = 0; gov.bad = 0; gov.hold = tm + 1500; return;
    }
    if (avg <= 21.5) { gov.bad = 0; return; }
    if (++gov.bad >= 2) { gov.base = avg; gov.q0 = B.q || 1; B.q = gov.q0 > 0.9 ? 0.8 : 0.66; gov.bad = 0; gov.hold = tm + 1200; resize(); }
  }
  function step(tm) {
    const S = G.GAME.S;
    if (B.camT) { const k = clamp((tm - B.camT.t0) / B.camT.ms, 0, 1), e = B.camT.ease === 'inout' ? (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2) : 1 - Math.pow(1 - k, 3); for (const q of ['x', 'y', 'z']) B.cam[q] = B.camT.from[q] + (B.camT.to[q] - B.camT.from[q]) * e; clampCam(); if (k >= 1) B.camT = null; B.dirty = true; }
    if (B.pad !== B.padT) { B.pad += (B.padT - B.pad) * 0.16; if (Math.abs(B.pad - B.padT) < 0.6) B.pad = B.padT; clampCam(); B.dirty = true; }
    const animating = B.fx.length || B.camT || B.vel || B.zoomT || B.keys.size || B.sel >= 0 || B.targets.size || B.arrow || B.shakeT || B.actionable.size || (B.life && S);
    if (!B.dirty && !animating) { lastT = 0; return; }
    // on a phone the ambient life alone runs at half rate; anything the player does is drawn at once
    if (LITE && !B.dirty && !(B.fx.length || B.camT || B.vel || B.zoomT || B.keys.size || B.shakeT || B.arrow) && tm - lastDraw < 30 && tm >= lastDraw) return;
    B.dirty = false; lastDraw = tm;
    const dt = clamp(lastT ? (tm - lastT) / 1000 : 0.016, 0, 0.1); lastT = tm;
    if (B.keys.size) panKeys(dt);
    if (B.zoomT) { const zt = B.zoomT, nz = B.cam.z + (zt.z - B.cam.z) * (1 - Math.exp(-dt * 16)); const done = Math.abs(nz - zt.z) < zt.z * 0.002; zoomAt(zt.sx, zt.sy, done ? zt.z : nz, true); if (done) B.zoomT = null; }
    if (B.vel) { B.cam.x -= B.vel.x * dt / B.cam.z; B.cam.y -= B.vel.y * dt / B.cam.z; clampCam(); const d = Math.exp(-dt * 5.5); B.vel.x *= d; B.vel.y *= d; if (Math.hypot(B.vel.x, B.vel.y) < 12) B.vel = null; }
    const t0 = performance.now(); draw(tm, dt, S); B.ms = performance.now() - t0;
  }
  function paintStill(g, view, z, dpr, S) {
    if (SH) SH.drawBase(g, view, z, dpr);
    const need = z * dpr; let mip = mips[0]; for (const m of mips) if (m.s >= need * 0.94) mip = m;
    g.drawImage(mip.c, 0, 0, W, H);
    if (S) g.drawImage(need < TS * 0.53 ? tintLo : tint, 0, 0, W, H);
    if (SH) SH.drawFrame(g);
  }
  function draw(tm, dt, S) {
    const dpr = B.dpr, c = B.cam, z = c.z, t = tm / 1000;
    let sx = 0, sy = 0;
    if (B.shakeT) { const k = (tm - B.shakeT.t0) / B.shakeT.ms; if (k >= 1) B.shakeT = null; else { const a = B.shakeT.amp * (1 - k); sx = (Math.random() - 0.5) * a; sy = (Math.random() - 0.5) * a; } }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, B.w, B.h);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (B.w / 2 - c.x * z + sx), dpr * (B.h / 2 - c.y * z + sy));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = LITE ? 'medium' : 'high';
    const view = { x0: c.x - B.w / (2 * z) - 8 / z, y0: c.y - B.h / (2 * z) - 8 / z, x1: c.x + B.w / (2 * z) + 8 / z, y1: c.y + B.h / (2 * z) + 8 / z, z, home: B.homeZ };
    // Everything that does not move (table, paper, sea, the map, the owners' colours, the border) is
    // painted straight to the screen while the camera travels. Once the camera rests it is painted once
    // into a picture the size of the screen, and each frame after that starts from a single copy of it.
    if (S) rebuildTint(S);
    const key = sx || sy ? '' : [c.x, c.y, z, cv.width, cv.height, tintKey, SH ? SH.rev : 0, S ? 1 : 0].join('|');
    if (key && key === keySeen) {
      if (baseKey !== key) {
        if (!base) { base = document.createElement('canvas'); bctx = base.getContext('2d'); }
        if (base.width !== cv.width || base.height !== cv.height) { base.width = cv.width; base.height = cv.height; }
        bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, base.width, base.height); bctx.setTransform(ctx.getTransform());
        bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high'; paintStill(bctx, view, z, dpr, S); baseKey = key;
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0); ctx.restore();
    } else { keySeen = key; paintStill(ctx, view, z, dpr, S); }
    const px = 1 / z; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const life = B.life && S ? LIFE() : null;
    if (life) { life.water(ctx, view, t, dt, S); life.ground(ctx, view, t, dt, S); life.sky(ctx, view, t, dt); }
    else if (B.life && S && !(G.LIFE && world.custom)) drawLife(t, dt, S);
    if (S?.campaign) drawConvoyRoute(S.campaign, px);
    const pulse = 0.5 + 0.5 * Math.sin(tm / 230);
    if (B.regionHi >= 0) { ctx.save(); ctx.fillStyle = 'rgba(255,236,170,0.22)'; ctx.fill(regionPaths[B.regionHi], 'evenodd'); ctx.setLineDash([10 * px, 6 * px]); ctx.lineDashOffset = -tm / 40 * px; ctx.strokeStyle = '#f2c95c'; ctx.lineWidth = 3 * px; ctx.stroke(regionPaths[B.regionHi]); ctx.restore(); }
    if (B.hover >= 0 && B.hover !== B.sel) { ctx.save(); ctx.clip(paths[B.hover], 'evenodd'); ctx.fillStyle = 'rgba(255,246,214,0.12)'; ctx.fill(paths[B.hover], 'evenodd'); ctx.strokeStyle = 'rgba(255,244,205,0.32)'; ctx.lineWidth = 16 * px; ctx.stroke(paths[B.hover]); ctx.strokeStyle = 'rgba(255,250,228,0.8)'; ctx.lineWidth = 3 * px; ctx.stroke(paths[B.hover]); ctx.restore(); }
    if (B.targets.size) {
      const col = B.targetKind === 'attack' ? '214,60,34' : '243,200,90';
      for (const tg of B.targets) { ctx.save(); ctx.clip(paths[tg], 'evenodd'); ctx.fillStyle = `rgba(${col},${0.1 + 0.1 * pulse})`; ctx.fill(paths[tg], 'evenodd'); ctx.strokeStyle = `rgba(${col},${0.6 + 0.4 * pulse})`; ctx.lineWidth = 8 * px; ctx.stroke(paths[tg]); ctx.restore(); }
    }
    for (const f of B.fx) {
      if (!WORLD_FX[f.k]) continue; const k = (tm - f.t0) / f.dur; if (k < 0 || k > 1) continue;
      if (f.k === 'flash') { ctx.save(); ctx.globalAlpha = (1 - k) * 0.7; ctx.fillStyle = f.color; ctx.fill(paths[f.t], 'evenodd'); ctx.restore(); }
      else if (f.k === 'wash') {
        // the old colours drain away while the new ink spreads from the heart of the land
        ctx.save(); ctx.clip(paths[f.t], 'evenodd');
        if (f.from) { ctx.strokeStyle = f.from; ctx.globalAlpha = 0.7 * (1 - k); ctx.lineWidth = 6; ctx.stroke(paths[f.t]); }
        const e = 1 - Math.pow(1 - k, 2.2), R = 30 + 330 * e; ctx.globalAlpha = 0.55 * (1 - k); ctx.strokeStyle = f.to; ctx.lineWidth = 44 * (1 - k) + 6; ctx.beginPath(); ctx.arc(TERR[f.t].lx, TERR[f.t].ly, R, 0, 7); ctx.stroke();
        ctx.restore();
      }
      else if (f.k === 'region') {
        const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85; ctx.save(); ctx.fillStyle = `rgba(255,224,140,${0.34 * a})`; ctx.fill(regionPaths[f.r], 'evenodd');
        ctx.shadowColor = 'rgba(255,214,110,0.9)'; ctx.shadowBlur = 22 * dpr; ctx.strokeStyle = `rgba(255,236,170,${a})`; ctx.lineWidth = (3 + 5 * a) * px; ctx.stroke(regionPaths[f.r]); ctx.restore();
      }
    }
    for (const s of new Set([B.sel, B.src])) if (s >= 0) {
      ctx.save(); ctx.shadowColor = 'rgba(255,205,90,0.95)'; ctx.shadowBlur = 18 * dpr; ctx.strokeStyle = `rgba(255,214,110,${0.75 + 0.25 * pulse})`; ctx.lineWidth = 4.5 * px; ctx.stroke(paths[s]);
      ctx.shadowBlur = 0; ctx.strokeStyle = '#fff6d8'; ctx.lineWidth = 1.4 * px; ctx.stroke(paths[s]); ctx.restore();
    }
    // an attack or a move along a printed sea lane sails it, instead of arcing over the water
    const sailed = B.arrow && LIFE() && S ? LIFE().invasion(ctx, view, t, B.arrow.a, B.arrow.b, B.arrow.kind, S.players[S.owner[B.arrow.a]]) : false;
    drawMini(S);
    // ---- screen space ----
    ctx.setTransform(dpr, 0, 0, dpr, dpr * sx, dpr * sy);
    if (B.arrow && !sailed) drawArrow(tm);
    for (const f of B.fx) if (f.k === 'move') drawMove(f, tm);
    if (!S) return;
    const ts = clamp(0.35 + z * 1.05, 0.5, 1.35);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (let i = 0; !D.PRINTED_LABELS && i < NT; i++) {
      const T = TERR[i]; const [x, y] = toScreen(T.lx, T.ly); if (x < -90 || y < -50 || x > B.w + 90 || y > B.h + 50) continue;
      const fs = clamp(T.fs * z * 1.7, B.w < 500 ? 8 : 10.5, 25);
      ctx.save(); ctx.translate(x, y - 15 * ts - fs * 0.55); ctx.rotate(T.ang || 0); ctx.font = `italic ${fs}px ${G.ATLAS.FONT}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2px';
      ctx.strokeStyle = 'rgba(239,223,186,0.88)'; ctx.lineWidth = 3; ctx.strokeText(T.name, 0, 0); ctx.fillStyle = i === B.sel ? '#5a1d08' : INK; ctx.fillText(T.name, 0, 0); ctx.restore();
    }
    // sprites follow the zoom: while it is changing they are stretched, and repainted sharp once it settles
    if (ts !== tsLast) { tsLast = ts; tsSince = tm; }
    if (spriteDpr !== dpr || !spriteTs || (ts !== spriteTs && (tm - tsSince > 140 || tm < tsSince || Math.abs(ts / spriteTs - 1) > 0.3))) { sprites.clear(); spriteTs = ts; spriteDpr = dpr; }
    let changed = 0; for (let i = 0; i < NT; i++) if (armPrev[i] !== S.armies[i]) changed++;
    for (let i = 0; i < NT; i++) if (armPrev[i] !== S.armies[i]) { if (armPrev[i] != null && changed <= 8) { popT[i] = tm; popDir[i] = S.armies[i] > armPrev[i] ? 1 : -1; } armPrev[i] = S.armies[i]; }
    for (let i = 0; i < NT; i++) {
      const T = TERR[i], o = S.owner[i]; const [x, y] = toScreen(T.lx, T.ly); if (x < -40 || y < -40 || x > B.w + 40 || y > B.h + 40) continue;
      if (S.bastions && T.bastion) {
        ctx.save();
        ctx.translate(x + BASTION_X * ts, y + BASTION_Y * ts);
        ctx.scale(ts, ts);
        ctx.fillStyle = '#291a10';
        ctx.strokeStyle = '#f2d595';
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        ctx.arc(0, 0, BASTION_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f2d595';
        ctx.fill(BASTION);
        ctx.restore();
      }
      if (o < 0) { ctx.beginPath(); ctx.arc(x, y, 5 * ts, 0, 7); ctx.fillStyle = 'rgba(39,36,27,0.6)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(240,230,196,0.9)'; ctx.stroke(); continue; }
      const st = i === B.sel || i === B.src ? 'sel' : B.targets.has(i) ? (B.targetKind === 'attack' ? 'target' : 'move') : null;
      let s = ts * (i === B.hover ? 1.09 : 1); const pf = B.fx.find(f => f.k === 'ring' && f.t === i); if (pf) { const k = (tm - pf.t0) / pf.dur; if (k >= 0 && k < 1) s *= 1 + 0.2 * Math.sin(k * Math.PI); }
      if (!st && B.actionable.has(i)) { ctx.save(); ctx.translate(x + 2 * s, y + 1 * s); ctx.rotate(tm / 2600); ctx.setLineDash([5 * s, 5 * s]); ctx.strokeStyle = `rgba(255,226,140,${0.45 + 0.35 * pulse})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 25 * s, 0, 6.283); ctx.stroke(); ctx.restore(); }
      const pk = popT[i] ? (tm - popT[i]) / 420 : 1; const pop = pk < 1 ? Math.sin(pk * Math.PI) : 0;
      if (s !== ts || pop > 0.02) drawToken(ctx, x + 6 * s, y, s, S.players[o], S.armies[i], st, pop, popDir[i] || 0);
      else { const sp = tokenSprite(S.players[o], S.armies[i], st, spriteTs), k = ts / spriteTs; ctx.drawImage(sp.c, Math.round((x + 6 * s - sp.ox * k) * dpr) / dpr, Math.round((y - sp.oy * k) * dpr) / dpr, sp.w * k, sp.h * k); }
      if (st === 'target' || st === 'move') drawBadge(x + 6 * s + 16 * s, y - 15 * s - 2.5 * Math.sin(tm / 260 + i), s, st);
      if (S.campaign?.commanders[o] === i) drawCampaignMarker(x - 11 * ts, y + 12 * ts, ts, '◆', S.players[o].light);
    }
    if (S.campaign) {
      const at = TERR[G.CAMPAIGN.current(S.campaign)];
      const [x, y] = toScreen(at.lx, at.ly);
      const marker = S.campaign.ring ? (S.campaign.ring.destroyed ? '✦' : '○') : String(S.campaign.step + 1);
      drawCampaignMarker(x + 5 * ts, y - 23 * ts, ts * 1.45, marker, '#ffe1a0');
    }
    const keep = [];
    for (const f of B.fx) {
      const k = (tm - f.t0) / f.dur; if (k > 1) continue; keep.push(f); if (k < 0 || f.k === 'move' || WORLD_FX[f.k]) continue;
      if (f.k === 'volley') { drawVolley(f, k); continue; }
      const [x, y] = toScreen(TERR[f.t].lx, TERR[f.t].ly);
      if (f.k === 'text') { const fs = 20 * (1 + 0.55 * Math.max(0, 1 - k * 7)); ctx.save(); ctx.globalAlpha = k < 0.75 ? 1 : (1 - k) / 0.25; ctx.font = `700 ${fs}px Cinzel, Georgia, serif`; ctx.textAlign = 'center'; ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(20,12,6,0.88)'; ctx.strokeText(f.text, x + 6, y - 26 - k * 38); ctx.fillStyle = f.color; ctx.fillText(f.text, x + 6, y - 26 - k * 38); ctx.restore(); }
      else if (f.k === 'sparks') { const e = 1 - Math.pow(1 - k, 2.4); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineWidth = 1.7; for (const [a, v] of f.parts) { const d = v * e, ca = Math.cos(a), sa = Math.sin(a), px2 = x + 4 + ca * d, py2 = y + sa * d * 0.8 + 46 * k * k, tl = 9 * (1 - k) + 1; ctx.strokeStyle = k < 0.25 ? '#fff6dc' : f.color; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.moveTo(px2, py2); ctx.lineTo(px2 - ca * tl, py2 - sa * tl * 0.8); ctx.stroke(); } ctx.restore(); }
      else if (f.k === 'dust') { ctx.save(); for (const [ox, oy, r] of f.parts) { ctx.fillStyle = `rgba(96,76,54,${0.3 * (1 - k)})`; ctx.beginPath(); ctx.arc(x + 4 + ox * (1 + 1.3 * k), y + 6 + oy * (1 + k) - 14 * k, r * (0.6 + 1.5 * k), 0, 7); ctx.fill(); } ctx.restore(); }
      else if (f.k === 'shock') { const e = 1 - Math.pow(1 - k, 3); ctx.save(); ctx.globalAlpha = Math.pow(1 - k, 1.4); ctx.strokeStyle = f.color; ctx.lineWidth = 8 * (1 - k) + 1; ctx.beginPath(); ctx.arc(x + 4, y, 14 + 96 * e, 0, 7); ctx.stroke(); ctx.strokeStyle = '#fff6dc'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + 4, y, 8 + 70 * e, 0, 7); ctx.stroke(); ctx.restore(); }
      else if (f.k === 'flag') drawFlag(f, k, x, y, tm, ts);
      else if (f.k === 'burst') { ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 8; for (const [vx, vy, r] of f.parts) { ctx.beginPath(); ctx.arc(x + vx * k, y + vy * k + 60 * k * k, r * (1 - k * 0.5), 0, 7); ctx.fill(); } ctx.restore(); }
      else if (f.k === 'ring') { ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x + 4, y, 14 + 30 * k, 0, 7); ctx.stroke(); ctx.restore(); }
    }
    B.fx = keep;
    if (B.life) drawMotes(t, dt);
  }
  const WORLD_FX = { flash: 1, wash: 1, region: 1 };
  function drawConvoyRoute(campaign, px) {
    const C = G.CAMPAIGN, at = C.current(campaign), onward = C.onward(campaign);
    const trail = campaign.ring ? campaign.ring.trail : C.ROUTE.slice(0, campaign.step + 1);
    const edges = campaign.ring ? C.RING_EDGES : C.ROUTE.slice(1).map((b, i) => [C.ROUTE[i], b]);
    ctx.save();
    for (const [a, b] of edges) {
      const lane = D.SEA_LINKS.findIndex(([p, q]) => p === a && q === b || p === b && q === a);
      const pts = D.SHIP_ROUTES[lane]?.[0] || [];
      const crossing = D.SEA_LINKS[lane]?.[0] === a ? pts : [...pts].reverse();
      ctx.beginPath();
      ctx.moveTo(TERR[a].lx, TERR[a].ly);
      for (const [x, y] of crossing) ctx.lineTo(x, y);
      ctx.lineTo(TERR[b].lx, TERR[b].ly);
      ctx.setLineDash([]);
      ctx.strokeStyle = '#301e15aa';
      ctx.lineWidth = 4.5 * px;
      ctx.stroke();
      ctx.setLineDash([5 * px, 4 * px]);
      const visited = trail.indexOf(a);
      ctx.strokeStyle = visited >= 0 && trail[visited + 1] === b ? '#c6e0bb' : a === at && onward.includes(b) ? '#ffe3a0' : '#d2b476';
      ctx.lineWidth = 1.9 * px;
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawCampaignMarker(x, y, scale, glyph, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#2e1c10';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '700 11px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(glyph, 0, 0.5);
    ctx.restore();
  }
  function drawBadge(x, y, s, kind) {
    const r = 8.5 * s; ctx.save(); ctx.translate(x, y);
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1.5;
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 1, 0, 0, r); if (kind === 'target') { g.addColorStop(0, '#e2553f'); g.addColorStop(1, '#7c1a10'); } else { g.addColorStop(0, '#f6dc94'); g.addColorStop(1, '#a8802f'); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.lineWidth = 1.2; ctx.strokeStyle = kind === 'target' ? '#ffd9c8' : '#fff4d0'; ctx.stroke();
    ctx.lineCap = 'round'; ctx.lineWidth = 1.6 * s; ctx.strokeStyle = kind === 'target' ? '#fff1e4' : '#3a2408'; const q = r * 0.48;
    ctx.beginPath(); if (kind === 'target') { const g2 = q * 0.42; ctx.moveTo(-q, -q); ctx.lineTo(q, q); ctx.moveTo(q, -q); ctx.lineTo(-q, q); ctx.moveTo(q * 0.3 + g2, q * 0.3 - g2); ctx.lineTo(q * 0.3 - g2, q * 0.3 + g2); ctx.moveTo(-q * 0.3 - g2, q * 0.3 - g2); ctx.lineTo(-q * 0.3 + g2, q * 0.3 + g2); } else { ctx.moveTo(-q * 0.5, -q); ctx.lineTo(q * 0.6, 0); ctx.lineTo(-q * 0.5, q); } ctx.stroke();
    ctx.restore();
  }
  function drawVolley(f, k) {
    const [ax, ay] = toScreen(TERR[f.a].lx, TERR[f.a].ly), [bx, by] = toScreen(TERR[f.b].lx, TERR[f.b].ly);
    ctx.save(); ctx.lineCap = 'round';
    for (const o of f.seed) {
      const t = (k - o.d) / 0.7; if (t <= 0 || t >= 1) continue;
      const ex = bx + 4 + o.sx, ey = by + o.sy, mx = (ax + ex) / 2, my = (ay + ey) / 2 - o.lift;
      const q = u => { u = clamp(u, 0, 1); const iu = 1 - u; return [iu * iu * ax + 2 * iu * u * mx + u * u * ex, iu * iu * ay + 2 * iu * u * my + u * u * ey]; };
      const p1 = q(t), p0 = q(t - 0.07), pt = q(t - 0.2);
      ctx.globalAlpha = 0.5; ctx.strokeStyle = f.color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(pt[0], pt[1]); ctx.lineTo(p0[0], p0[1]); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(28,20,10,0.95)'; ctx.lineWidth = 1.9; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      ctx.fillStyle = '#f4ead0'; ctx.beginPath(); ctx.arc(p1[0], p1[1], 1.3, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function drawFlag(f, k, x, y, tm, ts) {
    const d = Math.min(1, k / 0.16), drop = 1 - Math.pow(1 - d, 3) + Math.sin(d * Math.PI) * 0.12, a = k > 0.82 ? (1 - k) / 0.18 : 1, hgt = 34 * ts;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x - 24 * ts, y + 9 * ts - (1 - drop) * 46);
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(0.8, 1); ctx.lineTo(0.8, -hgt); ctx.stroke();
    ctx.strokeStyle = '#e9d7a8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -hgt); ctx.stroke();
    const w = 24 * ts, h2 = 13 * ts, wv = i => Math.sin(tm / 130 + i * 1.5) * 2.2 * ts;
    ctx.beginPath(); ctx.moveTo(0, -hgt); ctx.quadraticCurveTo(w * 0.5, -hgt + wv(0), w, -hgt + 2 * ts + wv(1)); ctx.lineTo(w * 0.72, -hgt + h2 * 0.5 + wv(2)); ctx.lineTo(w, -hgt + h2 + wv(1)); ctx.quadraticCurveTo(w * 0.5, -hgt + h2 + wv(0), 0, -hgt + h2); ctx.closePath();
    ctx.fillStyle = f.color; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.lineWidth = 1.1; ctx.strokeStyle = '#f6e4b4'; ctx.stroke();
    ctx.fillStyle = '#f6dc94'; ctx.beginPath(); ctx.arc(0, -hgt - 1.5, 2.2, 0, 7); ctx.fill();
    ctx.restore();
  }
  function arrowGeom(a, b) {
    const [ax, ay] = toScreen(TERR[a].lx, TERR[a].ly), [bx0, by0] = toScreen(TERR[b].lx, TERR[b].ly);
    const dx = bx0 - ax, dy = by0 - ay, L = Math.hypot(dx, dy) || 1; const bx = bx0 - dx / L * 24, by = by0 - dy / L * 24, sx = ax + dx / L * 24, sy = ay + dy / L * 24;
    return { sx, sy, mx: (sx + bx) / 2 - dy / L * L * 0.18, my: (sy + by) / 2 + dx / L * L * 0.18, bx, by };
  }
  function drawArrow(tm) {
    const g = arrowGeom(B.arrow.a, B.arrow.b); const col = B.arrow.kind === 'attack' ? '#c9301e' : '#e2b443';
    ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
    ctx.strokeStyle = 'rgba(255,246,226,0.95)'; ctx.lineWidth = 7; ctx.setLineDash([13, 8]); ctx.lineDashOffset = -tm / 26;
    ctx.beginPath(); ctx.moveTo(g.sx, g.sy); ctx.quadraticCurveTo(g.mx, g.my, g.bx, g.by); ctx.stroke(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.stroke(); ctx.setLineDash([]);
    const tx = g.bx - g.mx, ty = g.by - g.my, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl;
    ctx.beginPath(); ctx.moveTo(g.bx + ux * 13, g.by + uy * 13); ctx.lineTo(g.bx - ux * 6 - uy * 10, g.by - uy * 6 + ux * 10); ctx.lineTo(g.bx - ux * 6 + uy * 10, g.by - uy * 6 - ux * 10); ctx.closePath(); ctx.fillStyle = col; ctx.strokeStyle = 'rgba(255,246,226,0.95)'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawMove(f, tm) {
    const k = clamp((tm - f.t0) / f.dur, 0, 1), g = arrowGeom(f.a, f.b);
    ctx.save(); ctx.globalAlpha = 0.55 * (1 - k); ctx.setLineDash([3, 7]); ctx.lineCap = 'round'; ctx.strokeStyle = '#fff3d0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(g.sx, g.sy); ctx.quadraticCurveTo(g.mx, g.my, g.bx, g.by); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 12;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, fade = 1 - Math.max(0, k - 0.85) * 6;
    for (let i = 0; i < 8; i++) { const t = clamp(e - i * 0.035, 0, 1), it = 1 - t; ctx.globalAlpha = Math.max(0, fade * (1 - i / 9)); ctx.beginPath(); ctx.arc(it * it * g.sx + 2 * it * t * g.mx + t * t * g.bx, it * it * g.sy + 2 * it * t * g.my + t * t * g.by, Math.max(1, 6.5 - i * 0.7), 0, 7); ctx.fill(); }
    ctx.restore();
  }

  /* ---------- overview map ---------- */
  function buildMini() {
    if (mini || !cv.parentElement) return;
    mini = document.createElement('canvas'); mini.id = 'minimap'; mini.className = 'off'; mini.setAttribute('role', 'img'); mini.setAttribute('aria-label', 'Overview of the whole map. Click to move the view.');
    cv.parentElement.appendChild(mini); mctx = mini.getContext('2d'); miniBase = document.createElement('canvas'); miniOwn = document.createElement('canvas');
    const go = e => { const r = mini.getBoundingClientRect(); B.camT = null; B.vel = null; B.zoomT = null; B.cam.x = clamp((e.clientX - r.left) / r.width, 0, 1) * W; B.cam.y = clamp((e.clientY - r.top) / r.height, 0, 1) * H; clampCam(); B.dirty = true; };
    mini.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); miniDrag = true; go(e); try { mini.setPointerCapture(e.pointerId); } catch (err) { /* a pointer that is already gone */ } });
    mini.addEventListener('pointermove', e => { if (miniDrag) go(e); });
    const end = () => { miniDrag = false; }; mini.addEventListener('pointerup', end); mini.addEventListener('pointercancel', end);
    mini.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
  }
  function sizeMini() {
    if (!mini) return;
    const h = Math.round(clamp(B.h * 0.36, 130, 290)), w = Math.round(h * W / H);
    mini.style.width = w + 'px'; mini.style.height = h + 'px'; mini.width = Math.round(w * B.dpr); mini.height = Math.round(h * B.dpr);
    miniBase.width = miniOwn.width = mini.width; miniBase.height = miniOwn.height = mini.height;
    const c = miniBase.getContext('2d'); c.imageSmoothingQuality = 'high';
    // step the artwork down in halves so the little map stays clean
    let src = statics, sw = statics.width, sh = statics.height;
    while (sw > mini.width * 2.2) { const t = document.createElement('canvas'); t.width = Math.round(sw / 2); t.height = Math.round(sh / 2); const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(src, 0, 0, t.width, t.height); src = t; sw = t.width; sh = t.height; }
    c.drawImage(src, 0, 0, mini.width, mini.height);
    cv.parentElement.style.setProperty('--mini-w', w + 'px'); miniKey = ''; miniOwnKey = '';
  }
  function drawMini(S) {
    if (!mini) return;
    const c = B.cam, vw = B.w / c.z, vh = B.h / c.z, whole = vh >= H * 0.97 && vw >= W * 0.97, hide = whole || B.padT > 0 || !S;
    if (hide !== mini.classList.contains('off')) { mini.classList.toggle('off', hide); cv.parentElement.classList.toggle('has-mini', !hide); }
    if (hide) return;
    const key = tintKey.length + ':' + tintKey + '|' + Math.round(c.x) + ',' + Math.round(c.y) + ',' + c.z.toFixed(4) + '|' + B.sel; if (key === miniKey) return; miniKey = key;
    const k = mini.width / W;
    if (miniOwnKey !== tintKey) {
      miniOwnKey = tintKey; const o = miniOwn.getContext('2d'); o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, miniOwn.width, miniOwn.height); o.setTransform(k, 0, 0, k, 0, 0);
      for (let i = 0; i < NT; i++) { const ow = S.owner[i]; if (ow < 0) continue; o.globalAlpha = 0.66; o.fillStyle = S.players[ow].color; o.fill(paths[i], 'evenodd'); o.globalAlpha = 0.55; o.strokeStyle = '#1a1208'; o.lineWidth = 3; o.stroke(paths[i]); }
    }
    mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.drawImage(miniBase, 0, 0); mctx.drawImage(miniOwn, 0, 0);
    if (B.sel >= 0) { mctx.save(); mctx.setTransform(k, 0, 0, k, 0, 0); mctx.strokeStyle = '#fff3c4'; mctx.lineWidth = 9; mctx.stroke(paths[B.sel]); mctx.restore(); }
    const x0 = clamp((c.x - vw / 2) * k, 0, mini.width), y0 = clamp((c.y - vh / 2) * k, 0, mini.height), x1 = clamp((c.x + vw / 2) * k, 0, mini.width), y1 = clamp((c.y + vh / 2) * k, 0, mini.height);
    mctx.fillStyle = 'rgba(14,9,4,0.5)'; mctx.beginPath(); mctx.rect(0, 0, mini.width, mini.height); mctx.rect(x0, y0, x1 - x0, y1 - y0); mctx.fill('evenodd');
    const lw = 1.5 * B.dpr; mctx.strokeStyle = 'rgba(20,12,4,0.9)'; mctx.lineWidth = lw * 2.2; mctx.strokeRect(x0 + lw, y0 + lw, x1 - x0 - lw * 2, y1 - y0 - lw * 2);
    mctx.strokeStyle = '#ffe9a6'; mctx.lineWidth = lw; mctx.strokeRect(x0 + lw, y0 + lw, x1 - x0 - lw * 2, y1 - y0 - lw * 2);
  }

  /* ---------- input ---------- */
  function bindInput() {
    const pts = new Map(); let drag = null, pinch = null, moved = false, trail = [];
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]); B.camT = null; B.vel = null; B.zoomT = null; trail = [];
      if (pts.size === 1) { drag = { x: e.offsetX, y: e.offsetY, cx: B.cam.x, cy: B.cam.y }; moved = false; }
      else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: B.cam.z, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; drag = null; moved = true; }
    });
    cv.addEventListener('pointermove', e => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; zoomAt(pinch.mx, pinch.my, pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d); return; }
      if (drag) { const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 5) moved = true; if (moved) { B.cam.x = drag.cx - dx / B.cam.z; B.cam.y = drag.cy - dy / B.cam.z; clampCam(); B.dirty = true; cv.style.cursor = 'grabbing'; trail.push([e.offsetX, e.offsetY, performance.now()]); if (trail.length > 6) trail.shift(); } return; }
      const t = hit(e.offsetX, e.offsetY); if (t !== B.hover) { B.hover = t; B.dirty = true; } cv.style.cursor = t >= 0 ? 'pointer' : 'grab'; B.onHover && B.onHover(t, e);
    });
    const up = e => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (drag && !moved && e.type === 'pointerup') B.onClick && B.onClick(hit(e.offsetX, e.offsetY), e);
      if (drag && moved && e.type === 'pointerup' && trail.length >= 2) { const a = trail[0], b = trail[trail.length - 1], ms = b[2] - a[2]; if (ms > 8 && performance.now() - b[2] < 70) { const vx = (b[0] - a[0]) / ms * 1000, vy = (b[1] - a[1]) / ms * 1000; if (Math.hypot(vx, vy) > 160) B.vel = { x: clamp(vx, -2600, 2600), y: clamp(vy, -2600, 2600) }; } }
      if (!pts.size) drag = null; cv.style.cursor = 'grab';
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    window.addEventListener('blur', () => { B.keys.clear(); });
    cv.addEventListener('pointerleave', () => { if (B.hover !== -1) { B.hover = -1; B.dirty = true; } B.onHover && B.onHover(-1); });
    cv.addEventListener('wheel', e => { e.preventDefault(); B.camT = null; B.vel = null; const base = B.zoomT ? B.zoomT.z : B.cam.z; B.zoomT = { z: clamp(base * Math.pow(1.0022, -e.deltaY), B.minZ, B.maxZ), sx: e.offsetX, sy: e.offsetY }; }, { passive: false });
    cv.addEventListener('dblclick', e => zoomAt(e.offsetX, e.offsetY, B.cam.z * 1.6));
  }
  // arrow keys and WASD slide the map; the speed eases in so a tap is a nudge and a hold is a glide
  const PAN = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1] };
  let panV = 0;
  function panKeys(dt) {
    let dx = 0, dy = 0; for (const k of B.keys) { dx += PAN[k][0]; dy += PAN[k][1]; }
    if (!dx && !dy) { panV = 0; return; }
    panV = Math.min(1, panV + dt * 4.5); const v = (260 + 860 * panV) * dt / B.cam.z, n = Math.hypot(dx, dy);
    B.camT = null; B.vel = null; B.cam.x += dx / n * v; B.cam.y += dy / n * v; clampCam(); B.dirty = true;
  }
  function key(e, down) {
    const k = (e.key || '').toLowerCase(); if (!PAN[k]) return false;
    if (!down) { B.keys.delete(k); if (!B.keys.size) panV = 0; return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    B.keys.add(k); B.dirty = true; return true;
  }
  function zoomAt(sx, sy, nz, keep) { const [wx, wy] = toWorld(sx, sy); B.cam.z = clamp(nz, B.minZ, B.maxZ); B.cam.x = wx - (sx - B.w / 2) / B.cam.z; B.cam.y = wy - (sy - B.h / 2) / B.cam.z; clampCam(); B.dirty = true; B.camT = null; if (!keep) B.zoomT = null; }

  Object.assign(B, { init, resize, hit, focus, ensureVisible, fit, home: goHome, overview, zoomBy, intro, step, key, floatText, burst, ring, flash, moveFx, shake, volley, sparks, dust, impact, shock, flag, regionFx, conquest, toScreen, setPad, invalidate: () => { B.dirty = true; } });
  G.BOARD = B;
})(window);
