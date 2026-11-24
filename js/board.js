/* Board: the 2D map view. Camera, ownership washes, tokens, lettering, highlights,
   battle effects, and the living-map animations (clouds, ships, birds, smoke, rivers). */
(function (G) {
  const D = G.DATA; const { W, H, TERR } = D; const NT = TERR.length;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const SHIELD = new Path2D('M6 4 H94 V50 C94 84 72 104 50 117 C28 104 6 84 6 50 Z');
  const EMB = {}; for (const k in D.EMBLEMS) EMB[k] = new Path2D(D.EMBLEMS[k]);
  const INK = '#27241b';
  const B = {
    sel: -1, src: -1, hover: -1, targets: new Set(), targetKind: null, arrow: null, regionHi: -1,
    fx: [], life: true, dirty: true, onClick: null, onHover: null, cam: { x: W / 2, y: H / 2, z: 1 }, camT: null, shakeT: null,
  };
  let cv, ctx, world, smp, statics, paths, regionPaths, tint, tintKey = '', riverPaths = [], cloudPat = null, puffs = [], clouds = [], ships = [], flocks = [], lastT = 0;
  const TS = 0.7; // tint cache scale

  function init(canvas, w, staticCanvas) {
    cv = canvas; ctx = cv.getContext('2d'); world = w; statics = staticCanvas; smp = G.MAPGEN.makeSampler(world);
    paths = world.borders.terrPaths.map(p => p.path);
    regionPaths = D.REGIONS.map(r => { const p = new Path2D(); TERR.forEach((t, i) => { if (t.region === r.id) p.addPath(paths[i]); }); return p; });
    tint = document.createElement('canvas'); tint.width = Math.round(W * TS); tint.height = Math.round(H * TS);
    buildLife();
    resize(); window.addEventListener('resize', resize); bindInput(); requestAnimationFrame(loop);
  }

  /* ---------- camera ---------- */
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    const wasFitted = B.fitZ && Math.abs(B.cam.z - B.fitZ) < .01;
    B.dpr = Math.min(window.devicePixelRatio || 1, 2); B.w = Math.max(50, r.width); B.h = Math.max(50, r.height);
    cv.width = Math.round(B.w * B.dpr); cv.height = Math.round(B.h * B.dpr); cv.style.width = B.w + 'px'; cv.style.height = B.h + 'px';
    const first = !B.fitZ; B.fitZ = Math.min(B.w / W, B.h / H); B.coverZ = Math.max(B.w / W, B.h / H);
    B.minZ = B.fitZ * 0.98; B.maxZ = Math.max(B.fitZ * 5, 1.8);
    if (first || wasFitted) B.cam.z = home();
    B.cam.z = clamp(B.cam.z, B.minZ, B.maxZ); clampCam(); B.dirty = true;
  }
  function home() { return B.fitZ; }
  function clampCam() { const c = B.cam, hw = B.w / (2 * c.z), hh = B.h / (2 * c.z); c.x = hw * 2 >= W ? W / 2 : clamp(c.x, hw, W - hw); c.y = hh * 2 >= H ? H / 2 : clamp(c.y, hh, H - hh); }
  const toWorld = (sx, sy) => [(sx - B.w / 2) / B.cam.z + B.cam.x, (sy - B.h / 2) / B.cam.z + B.cam.y];
  const toScreen = (x, y) => [(x - B.cam.x) * B.cam.z + B.w / 2, (y - B.cam.y) * B.cam.z + B.h / 2];
  function animTo(o) { B.camT = { from: { ...B.cam }, to: Object.assign({ ...B.cam }, o), t0: performance.now() }; }
  function fit() { animTo({ x: W / 2, y: H / 2, z: home() }); }
  function focus(t) { animTo({ x: TERR[t].lx, y: TERR[t].ly }); }
  function zoomBy(f) { animTo({ z: clamp(B.cam.z * f, B.minZ, B.maxZ) }); }
  function ensureVisible(ts) {
    const m = 90; let dx = 0, dy = 0;
    for (const t of ts) { const [x, y] = toScreen(TERR[t].lx, TERR[t].ly); if (x < m) dx = Math.min(dx, x - m); if (x > B.w - m) dx = Math.max(dx, x - (B.w - m)); if (y < m) dy = Math.min(dy, y - m); if (y > B.h - m) dy = Math.max(dy, y - (B.h - m)); }
    if (dx || dy) animTo({ x: B.cam.x + dx / B.cam.z, y: B.cam.y + dy / B.cam.z });
  }
  function hit(sx, sy) {
    const scale = clamp(.35 + B.cam.z * 1.05, .5, 1.35);
    let nearest = -1, distance = Infinity;
    for (let i = 0; i < NT; i++) {
      const [tx, ty] = toScreen(TERR[i].lx, TERR[i].ly), dx = sx - tx, dy = sy - ty;
      if (Math.abs(dx - 6 * scale) < 24 * scale && Math.abs(dy) < 16 * scale) {
        const d = dx * dx + dy * dy;
        if (d < distance) { nearest = i; distance = d; }
      }
    }
    if (nearest >= 0) return nearest;
    const [x, y] = toWorld(sx, sy); if (x < 0 || y < 0 || x >= W || y >= H) return -1; const l = smp.lab(x, y); return l >= 0 ? l : -1;
  }

  /* ---------- ownership wash (cached) ---------- */
  function rebuildTint(S) {
    const key = S.owner.join(','); if (key === tintKey) return; tintKey = key;
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
  function drawToken(c, x, y, s, p, n, state) {
    const px = x - 2 * s, pw = (n >= 100 ? 34 : n >= 10 ? 28 : 22) * s, ph = 19 * s;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 4; c.shadowOffsetY = 2;
    // the number plate carries the owner's colour so ownership reads at a glance
    const pg = c.createLinearGradient(0, y - ph / 2, 0, y + ph / 2); pg.addColorStop(0, p.dark); pg.addColorStop(1, '#17120c');
    c.beginPath(); rr(c, px, y - ph / 2, pw, ph, 4 * s); c.fillStyle = pg; c.fill(); c.shadowColor = 'transparent';
    c.lineWidth = 1.4 * s; c.strokeStyle = state === 'sel' ? '#ffe9a6' : p.color; c.stroke();
    c.font = `700 ${13.5 * s}px Cinzel, Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = 2.6 * s; c.strokeStyle = 'rgba(15,10,5,0.75)'; c.strokeText(String(n), px + pw / 2 + 4 * s, y + 1 * s);
    c.fillStyle = '#fff6e0'; c.fillText(String(n), px + pw / 2 + 4 * s, y + 1 * s);
    c.restore();
    drawShield(c, x - 8 * s, y, 25 * s, p, state === 'sel' ? '#ffd36a' : state === 'target' ? '#ff5a3a' : state === 'move' ? '#ffe28a' : null);
  }

  /* ---------- effects ---------- */
  const now = () => performance.now();
  function floatText(t, text, color) { B.fx.push({ k: 'text', t, text, color, t0: now(), dur: 1300 }); }
  function burst(t, color) { const parts = []; for (let i = 0; i < 22; i++) { const a = Math.random() * 6.283, v = 30 + Math.random() * 70; parts.push([Math.cos(a) * v, Math.sin(a) * v - 20, 2 + Math.random() * 3]); } B.fx.push({ k: 'burst', t, color, parts, t0: now(), dur: 850 }); }
  function ring(t, color) { B.fx.push({ k: 'ring', t, color, t0: now(), dur: 650 }); }
  function flash(t, color) { B.fx.push({ k: 'flash', t, color: color || '#fff', t0: now(), dur: 800 }); }
  function moveFx(a, b, color) { B.fx.push({ k: 'move', a, b, color, t0: now(), dur: 700 }); }
  function shake(ms = 360, amp = 6) { B.shakeT = { t0: now(), ms, amp }; }

  /* ---------- living map ---------- */
  function buildLife() {
    const rnd = G.NZ.mulberry32(909);
    riverPaths = world.rivers.map(r => { const p = new Path2D(); let pen = false; for (const q of r.pts) { if (smp.lab(q[0], q[1]) < 0) { pen = false; continue; } if (pen) p.lineTo(q[0], q[1]); else { p.moveTo(q[0], q[1]); pen = true; } } return p; });
    puffs = [3, 11, 19].map(s => G.ATLAS.cloudPuffCanvas(s));
    for (let i = 0; i < 8; i++) clouds.push({ x: rnd() * (W + 800) - 400, y: rnd() * H, s: 1.5 + rnd() * 1.4, v: 9 + rnd() * 9, k: i % 3, a: 0.34 + rnd() * 0.2 });
    const sea = ([x, y]) => smp.lab(x, y) === -1 && smp.seaD(x, y) > 5;
    const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * 6.283) * r, cy + Math.sin(i / n * 6.283) * r * 0.8]);
    [[[[70, 330], [112, 480], [84, 650], [62, 900], [104, 1040], [44, 720], [36, 470]], 13, 1],
     [[[700, 1300], [780, 1245], [860, 1228], [890, 1280], [820, 1345], [720, 1352]], 9, 0.85],
     [circle(1665, 480, 30, 8), 6, 0.7],
     [[[470, 1090], [560, 1180], [620, 1300], [520, 1352], [462, 1235]], 11, 0.95]].forEach(([pts, speed, size], k) => {
      const ok = pts.filter(sea); if (ok.length < 3) return;
      const loop = G.MAPGEN.catmull(ok.concat([ok[0]]), 8); let len = 0; const cum = [0];
      for (let i = 1; i < loop.length; i++) { len += Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]); cum.push(len); }
      ships.push({ loop, cum, len, d: rnd() * len, speed, size, ph: k * 1.7 });
    });
    for (let f = 0; f < 3; f++) flocks.push(newFlock(rnd, true));
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
    const vx = 1655, vy = 958;
    const fl = 0.7 + 0.2 * Math.sin(t * 7.3) + 0.12 * Math.sin(t * 17.1);
    let g = ctx.createRadialGradient(vx, vy, 1, vx, vy, 34); g.addColorStop(0, `rgba(255,120,40,${0.55 * fl})`); g.addColorStop(1, 'rgba(255,80,20,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(vx, vy, 34, 0, 7); ctx.fill();
    for (let i = 0; i < 8; i++) { const ph = (t * 0.07 + i / 8) % 1; ctx.fillStyle = `rgba(52,48,44,${0.42 * (1 - ph) * Math.min(1, ph * 7)})`; ctx.beginPath(); ctx.arc(vx + ph * 46 + Math.sin(i * 2.1 + t * 0.6) * 3, vy - 6 - ph * 78, 5 + ph * 20, 0, 7); ctx.fill(); }
    const ex = 1722, ey = 908, ep = 0.5 + 0.5 * Math.sin(t * 2.3) ** 2;
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
  function loop(tm) {
    requestAnimationFrame(loop);
    const S = G.GAME.S;
    if (B.camT) { const k = clamp((tm - B.camT.t0) / 550, 0, 1), e = 1 - Math.pow(1 - k, 3); for (const q of ['x', 'y', 'z']) B.cam[q] = B.camT.from[q] + (B.camT.to[q] - B.camT.from[q]) * e; clampCam(); if (k >= 1) B.camT = null; B.dirty = true; }
    const animating = B.fx.length || B.camT || B.sel >= 0 || B.targets.size || B.arrow || B.shakeT || (B.life && S);
    if (!B.dirty && !animating) return; B.dirty = false;
    const dt = Math.min(0.1, lastT ? (tm - lastT) / 1000 : 0.016); lastT = tm;
    const t0 = performance.now(); draw(tm, dt, S); B.ms = performance.now() - t0;
  }
  function draw(tm, dt, S) {
    const dpr = B.dpr, c = B.cam, z = c.z, t = tm / 1000;
    let sx = 0, sy = 0;
    if (B.shakeT) { const k = (tm - B.shakeT.t0) / B.shakeT.ms; if (k >= 1) B.shakeT = null; else { const a = B.shakeT.amp * (1 - k); sx = (Math.random() - 0.5) * a; sy = (Math.random() - 0.5) * a; } }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, B.w, B.h);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (B.w / 2 - c.x * z + sx), dpr * (B.h / 2 - c.y * z + sy));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(statics, 0, 0, W, H);
    if (S) { rebuildTint(S); ctx.drawImage(tint, 0, 0, W, H); }
    const px = 1 / z; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (B.life && S) drawLife(t, dt, S);
    const pulse = 0.5 + 0.5 * Math.sin(tm / 230);
    if (B.regionHi >= 0) { ctx.save(); ctx.fillStyle = 'rgba(255,236,170,0.22)'; ctx.fill(regionPaths[B.regionHi], 'evenodd'); ctx.setLineDash([10 * px, 6 * px]); ctx.lineDashOffset = -tm / 40 * px; ctx.strokeStyle = '#f2c95c'; ctx.lineWidth = 3 * px; ctx.stroke(regionPaths[B.regionHi]); ctx.restore(); }
    if (B.hover >= 0 && B.hover !== B.sel) { ctx.save(); ctx.fillStyle = 'rgba(255,246,214,0.2)'; ctx.fill(paths[B.hover], 'evenodd'); ctx.restore(); }
    if (B.targets.size) {
      const col = B.targetKind === 'attack' ? '214,60,34' : '243,200,90';
      for (const tg of B.targets) { ctx.save(); ctx.clip(paths[tg], 'evenodd'); ctx.fillStyle = `rgba(${col},${0.1 + 0.1 * pulse})`; ctx.fill(paths[tg], 'evenodd'); ctx.strokeStyle = `rgba(${col},${0.6 + 0.4 * pulse})`; ctx.lineWidth = 8 * px; ctx.stroke(paths[tg]); ctx.restore(); }
    }
    for (const f of B.fx) if (f.k === 'flash') { const k = (tm - f.t0) / f.dur; if (k > 1) continue; ctx.save(); ctx.globalAlpha = (1 - k) * 0.7; ctx.fillStyle = f.color; ctx.fill(paths[f.t], 'evenodd'); ctx.restore(); }
    for (const s of new Set([B.sel, B.src])) if (s >= 0) {
      ctx.save(); ctx.shadowColor = 'rgba(255,205,90,0.95)'; ctx.shadowBlur = 18 * dpr; ctx.strokeStyle = `rgba(255,214,110,${0.75 + 0.25 * pulse})`; ctx.lineWidth = 4.5 * px; ctx.stroke(paths[s]);
      ctx.shadowBlur = 0; ctx.strokeStyle = '#fff6d8'; ctx.lineWidth = 1.4 * px; ctx.stroke(paths[s]); ctx.restore();
    }
    // ---- screen space ----
    ctx.setTransform(dpr, 0, 0, dpr, dpr * sx, dpr * sy);
    if (B.arrow) drawArrow(tm);
    for (const f of B.fx) if (f.k === 'move') drawMove(f, tm);
    if (!S) return;
    const ts = clamp(0.35 + z * 1.05, 0.5, 1.35);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (let i = 0; i < NT; i++) {
      const T = TERR[i]; const [x, y] = toScreen(T.lx, T.ly); if (x < -90 || y < -50 || x > B.w + 90 || y > B.h + 50) continue;
      const fs = clamp(T.fs * z * 1.7, B.w < 500 ? 8 : 10.5, 25);
      ctx.save(); ctx.translate(x, y - 15 * ts - fs * 0.55); ctx.rotate(T.ang || 0); ctx.font = `italic ${fs}px ${G.ATLAS.FONT}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2px';
      ctx.strokeStyle = 'rgba(239,223,186,0.88)'; ctx.lineWidth = 3; ctx.strokeText(T.name, 0, 0); ctx.fillStyle = i === B.sel ? '#5a1d08' : INK; ctx.fillText(T.name, 0, 0); ctx.restore();
    }
    for (let i = 0; i < NT; i++) {
      const T = TERR[i], o = S.owner[i]; const [x, y] = toScreen(T.lx, T.ly); if (x < -40 || y < -40 || x > B.w + 40 || y > B.h + 40) continue;
      if (o < 0) { ctx.beginPath(); ctx.arc(x, y, 5 * ts, 0, 7); ctx.fillStyle = 'rgba(39,36,27,0.6)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(240,230,196,0.9)'; ctx.stroke(); continue; }
      const st = i === B.sel || i === B.src ? 'sel' : B.targets.has(i) ? (B.targetKind === 'attack' ? 'target' : 'move') : null;
      let s = ts; const pf = B.fx.find(f => f.k === 'ring' && f.t === i); if (pf) { const k = (tm - pf.t0) / pf.dur; if (k < 1) s *= 1 + 0.2 * Math.sin(k * Math.PI); }
      drawToken(ctx, x + 6 * s, y, s, S.players[o], S.armies[i], st);
    }
    const keep = [];
    for (const f of B.fx) {
      const k = (tm - f.t0) / f.dur; if (k > 1) continue; keep.push(f); if (f.k === 'move' || f.k === 'flash') continue;
      const [x, y] = toScreen(TERR[f.t].lx, TERR[f.t].ly);
      if (f.k === 'text') { ctx.save(); ctx.globalAlpha = k < 0.75 ? 1 : (1 - k) / 0.25; ctx.font = '700 19px Cinzel, Georgia, serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,12,6,0.85)'; ctx.strokeText(f.text, x + 6, y - 26 - k * 36); ctx.fillStyle = f.color; ctx.fillText(f.text, x + 6, y - 26 - k * 36); ctx.restore(); }
      else if (f.k === 'burst') { ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 8; for (const [vx, vy, r] of f.parts) { ctx.beginPath(); ctx.arc(x + vx * k, y + vy * k + 60 * k * k, r * (1 - k * 0.5), 0, 7); ctx.fill(); } ctx.restore(); }
      else if (f.k === 'ring') { ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x + 4, y, 14 + 30 * k, 0, 7); ctx.stroke(); ctx.restore(); }
    }
    B.fx = keep;
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
    ctx.save(); ctx.globalAlpha = 1 - Math.max(0, k - 0.85) * 6; ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 12;
    for (let i = 0; i < 5; i++) { const t = clamp(k - i * 0.05, 0, 1), it = 1 - t; ctx.beginPath(); ctx.arc(it * it * g.sx + 2 * it * t * g.mx + t * t * g.bx, it * it * g.sy + 2 * it * t * g.my + t * t * g.by, 6 - i, 0, 7); ctx.fill(); }
    ctx.restore();
  }

  /* ---------- input ---------- */
  function bindInput() {
    const pts = new Map(); let drag = null, pinch = null, moved = false;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]); B.camT = null;
      if (pts.size === 1) { drag = { x: e.offsetX, y: e.offsetY, cx: B.cam.x, cy: B.cam.y }; moved = false; }
      else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: B.cam.z, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; drag = null; moved = true; }
    });
    cv.addEventListener('pointermove', e => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; zoomAt(pinch.mx, pinch.my, pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d); return; }
      if (drag) { const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 5) moved = true; if (moved) { B.cam.x = drag.cx - dx / B.cam.z; B.cam.y = drag.cy - dy / B.cam.z; clampCam(); B.dirty = true; cv.style.cursor = 'grabbing'; } return; }
      const t = hit(e.offsetX, e.offsetY); if (t !== B.hover) { B.hover = t; B.dirty = true; } cv.style.cursor = t >= 0 ? 'pointer' : 'grab'; B.onHover && B.onHover(t, e);
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (drag && !moved && e.type === 'pointerup') B.onClick && B.onClick(hit(e.offsetX, e.offsetY), e); if (!pts.size) drag = null; cv.style.cursor = 'grab'; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (B.hover !== -1) { B.hover = -1; B.dirty = true; } B.onHover && B.onHover(-1); });
    cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, B.cam.z * Math.pow(1.0015, -e.deltaY)); }, { passive: false });
    cv.addEventListener('dblclick', e => zoomAt(e.offsetX, e.offsetY, B.cam.z * 1.6));
  }
  function zoomAt(sx, sy, nz) { const [wx, wy] = toWorld(sx, sy); B.cam.z = clamp(nz, B.minZ, B.maxZ); B.cam.x = wx - (sx - B.w / 2) / B.cam.z; B.cam.y = wy - (sy - B.h / 2) / B.cam.z; clampCam(); B.dirty = true; B.camT = null; }

  Object.assign(B, { init, resize, hit, focus, ensureVisible, fit, zoomBy, floatText, burst, ring, flash, moveFx, shake, invalidate: () => { B.dirty = true; } });
  G.BOARD = B;
})(window);
