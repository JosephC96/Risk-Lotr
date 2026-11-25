/* Atlas painter: a flat, hand-inked map. Grey-green sea with a bold coastline and a dashed
   offshore contour, khaki/olive lands with a soft inner shadow, wide rivers as borders,
   dotted territory limits, inked mountain clusters and trees, ghosted region lettering. */
(function (G) {
  const D = G.DATA, NZ = G.NZ, MG = G.MAPGEN; const { W, H, TERR } = D;
  const { N1, N2, N3, fbm, smoothstep, clamp, lerp, mulberry32, hash2 } = NZ;
  const tick = () => new Promise(r => setTimeout(r, 0));
  const INK = '#27241b';
  const FONT = '"IM Fell English", Georgia, serif';
  const PAL = {
    sea: [159, 173, 159], river: '#829798', lake: '#829798',
    region: ['#eee2c3', '#ddd4a2', '#e4d3ae', '#c7cc99', '#e9d0a2', '#dcd09b', '#ddd5b0', '#d8b293', '#ecd09b'],
    mLit: '#e9d7b3', mShade: '#ab9474', tree: '#858657', treeDark: '#5c6845', treeGold: '#b5a256', pine: '#737c54',
  };

  /* ---------- mountain ranges: warped spines with spurs ---------- */
  function segD(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px, qy = ay + t * dy - py; return [qx * qx + qy * qy, t];
  }
  function buildSegments() {
    const segs = []; const rnd = mulberry32(911);
    D.RIDGES.forEach((r, ri) => {
      if (Math.hypot(r.pts[0][0] - r.pts[r.pts.length - 1][0], r.pts[0][1] - r.pts[r.pts.length - 1][1]) < 5) return;
      const pts = MG.catmull(r.pts, 16);
      const mod = s => 0.62 + 0.5 * (N1(s / 120 + ri * 9.3, ri * 3.1) * 0.5 + 0.5) + 0.14 * N2(s / 40 + ri, 2.7);
      let arc = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const m0 = mod(arc), m1 = mod(arc + L);
        segs.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], w0: r.w * (0.7 + 0.45 * m0), w1: r.w * (0.7 + 0.45 * m1), h0: r.h * m0, h1: r.h * m1 });
        if (r.spurs > 0 && rnd() < 0.4 * r.spurs) {
          const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L; const side = rnd() < 0.5 ? -1 : 1;
          let dx = -ty * side + tx * (rnd() - 0.5) * 0.9, dy = tx * side + ty * (rnd() - 0.5) * 0.9; const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
          const len = r.w * (0.8 + rnd() * 1.4), hm = r.h * m0;
          segs.push({ ax: a[0], ay: a[1], bx: a[0] + dx * len, by: a[1] + dy * len, w0: r.w * 0.5, w1: r.w * 0.3, h0: hm * 0.7, h1: hm * 0.2 });
        }
        arc += L;
      }
    });
    for (const s of segs) { const m = Math.max(s.w0, s.w1) * 2.4; s.x0 = Math.min(s.ax, s.bx) - m; s.x1 = Math.max(s.ax, s.bx) + m; s.y0 = Math.min(s.ay, s.by) - m; s.y1 = Math.max(s.ay, s.by) + m; }
    return segs;
  }
  function rangeAt(x, y, segs) {
    const wx = x + 24 * fbm(N2, x / 95, y / 95, 2), wy = y + 24 * fbm(N2, x / 95 + 17, y / 95 - 5, 2);
    let v = 0;
    for (const s of segs) {
      if (wx < s.x0 || wx > s.x1 || wy < s.y0 || wy > s.y1) continue;
      const [d2, t] = segD(wx, wy, s.ax, s.ay, s.bx, s.by); const w = s.w0 + (s.w1 - s.w0) * t; const u2 = d2 / (w * w); if (u2 > 5.5) continue;
      const h = (s.h0 + (s.h1 - s.h0) * t) * Math.exp(-u2 * 1.25); if (h > v) v = h;
    }
    for (const [px, py, r, h] of D.PEAKS) { const d = Math.hypot(x - px, y - py); if (d < r * 1.5) { const c = h * Math.pow(Math.max(0, 1 - d / (r * 1.5)), 1.4); if (c > v) v = c; } }
    return v;
  }

  /* ---------- analysis: range mask, label angles ---------- */
  function prepare(world) {
    if (world.custom) return world;
    const { GW, GH, CELL, lab } = world;
    const segs = buildSegments(); const MR = new Float32Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) MR[gy * GW + gx] = rangeAt((gx + .5) * CELL, (gy + .5) * CELL, segs);
    world.MR = MR;
    const NTR = TERR.length, NR = D.REGIONS.length;
    const acc = n => Array.from({ length: n }, () => ({ n: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0 }));
    const ta = acc(NTR), ra = acc(NR);
    for (let i = 0; i < lab.length; i++) {
      const l = lab[i]; if (l < 0) continue; const x = (i % GW + .5) * CELL, y = ((i / GW | 0) + .5) * CELL;
      for (const a of [ta[l], ra[TERR[l].region]]) { a.n++; a.x += x; a.y += y; a.xx += x * x; a.yy += y * y; a.xy += x * y; }
    }
    const pca = a => {
      const mx = a.x / a.n, my = a.y / a.n; const sxx = a.xx / a.n - mx * mx, syy = a.yy / a.n - my * my, sxy = a.xy / a.n - mx * my;
      let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const tr = sxx + syy, det = sxx * syy - sxy * sxy, d = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      return { mx, my, ang, l1: Math.sqrt(tr / 2 + d), l2: Math.sqrt(Math.max(1e-6, tr / 2 - d)) };
    };
    TERR.forEach((t, i) => {
      const p = pca(ta[i]); const el = p.l1 / p.l2;
      t.ang = el < 1.35 ? 0 : clamp(p.ang, -0.3, 0.3) * clamp((el - 1.35) * 1.6, 0, 1);
      t.fs = clamp(11.5 + Math.sqrt(ta[i].n) * 0.085, 13, 19);
    });
    world.regionShape = ra.map(pca);
    return world;
  }

  /* ---------- contour loops of a cell mask ---------- */
  function maskLoops(GW, GH, CELL, inside) {
    const CW = GW + 1; const out = new Map();
    const add = (a, b) => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (!inside(x, y)) continue; const c = y * CW + x;
      if (y === 0 || !inside(x, y - 1)) add(c, c + 1);
      if (x === GW - 1 || !inside(x + 1, y)) add(c + 1, c + 1 + CW);
      if (y === GH - 1 || !inside(x, y + 1)) add(c + 1 + CW, c + CW);
      if (x === 0 || !inside(x - 1, y)) add(c + CW, c);
    }
    const loops = [];
    for (const [start] of out) {
      let l = out.get(start); if (!l || !l.length) continue;
      const pts = []; let cur = start, guard = 0;
      while (guard++ < 400000) { const nx = out.get(cur); if (!nx || !nx.length) break; const to = nx.pop(); pts.push([(cur % CW) * CELL, ((cur / CW) | 0) * CELL]); cur = to; if (cur === start) break; }
      if (pts.length > 12) loops.push(pts);
    }
    return loops;
  }
  function smoothLoop(pts, step) {
    const dec = pts.filter((_, i) => i % step === 0); if (dec.length < 4) return pts;
    let p = dec;
    for (let it = 0; it < 2; it++) { const o = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } p = o; }
    return p;
  }

  /* ---------- ink glyphs ---------- */
  function jag(ax, ay, bx, by, n, amp, rnd) {
    const pts = [[ax, ay]]; const nx = -(by - ay), ny = bx - ax, nl = Math.hypot(nx, ny) || 1;
    for (let i = 1; i < n; i++) { const t = i / n + (rnd() - 0.5) * 0.12, o = (rnd() - 0.5) * amp; pts.push([ax + (bx - ax) * t + nx / nl * o, ay + (by - ay) * t + ny / nl * o]); }
    pts.push([bx, by]); return pts;
  }
  const trace = (ctx, pts, move) => pts.forEach((p, i) => (i || !move) ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  function mountain(ctx, x, y, s, rnd, tone) {
    const h = s * (0.8 + 0.32 * rnd()); const px = x + (rnd() - .5) * s * 0.2, py = y - h;
    const lx = x - s * (0.52 + rnd() * 0.1), rx = x + s * (0.55 + rnd() * 0.1);
    const left = jag(lx, y, px, py, 4, s * 0.08, rnd), right = jag(px, py, rx, y, 4, s * 0.09, rnd);
    const mx = x + s * 0.1 + (rnd() - .5) * s * 0.12; const ridge = jag(px, py, mx, y + s * 0.02, 4, s * 0.1, rnd);
    const lit = tone === 'dark' ? '#b3a488' : tone === 'snow' ? '#eceada' : PAL.mLit, shade = tone === 'dark' ? '#7c6f59' : tone === 'snow' ? '#b2b09c' : PAL.mShade;
    ctx.beginPath(); trace(ctx, left, true); trace(ctx, ridge.slice(1)); ctx.closePath(); ctx.fillStyle = lit; ctx.fill();
    ctx.beginPath(); trace(ctx, ridge, true); trace(ctx, right.slice().reverse().slice(1)); ctx.closePath(); ctx.fillStyle = shade; ctx.fill();
    // hatching on the shaded face
    ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(0.55, s * 0.022); ctx.globalAlpha = 0.7;
    ctx.beginPath(); const nh = 4 + Math.floor(s / 7);
    for (let k = 1; k <= nh; k++) {
      const t = k / (nh + 1.2); const a = ridge[Math.min(ridge.length - 2, Math.floor(t * (ridge.length - 1)))], b = ridge[Math.min(ridge.length - 1, Math.floor(t * (ridge.length - 1)) + 1)];
      const f = t * (ridge.length - 1) % 1; const sx = a[0] + (b[0] - a[0]) * f + s * 0.02, sy = a[1] + (b[1] - a[1]) * f;
      const len = s * (0.1 + 0.2 * (1 - Math.abs(t - 0.55)));
      ctx.moveTo(sx, sy); ctx.lineTo(sx + len * 0.86, sy + len * 0.62);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    // a few strokes on the lit face
    ctx.lineWidth = Math.max(0.5, s * 0.02); ctx.beginPath();
    for (let k = 0; k < 2; k++) { const p = left[1 + k] || left[1]; ctx.moveTo(p[0] + s * 0.06, p[1] + s * 0.04); ctx.lineTo(p[0] + s * 0.12, p[1] + s * (0.16 + rnd() * 0.08)); }
    ctx.stroke();
    if (tone === 'snow') { ctx.beginPath(); ctx.moveTo(left[left.length - 2][0], left[left.length - 2][1]); ctx.lineTo(px, py); ctx.lineTo(right[1][0], right[1][1]); ctx.lineTo(px + s * 0.05, py + h * 0.3); ctx.lineTo(px - s * 0.04, py + h * 0.2); ctx.closePath(); ctx.fillStyle = '#f7f6ee'; ctx.fill(); }
    ctx.lineWidth = Math.max(0.9, s * 0.042); ctx.strokeStyle = INK;
    ctx.beginPath(); trace(ctx, left, true); trace(ctx, right.slice(1)); ctx.stroke();
    ctx.lineWidth = Math.max(0.6, s * 0.026); ctx.beginPath(); trace(ctx, ridge.slice(0, ridge.length - 1), true); ctx.stroke();
  }
  function hill(ctx, x, y, s, rnd) {
    ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
    const n = 1 + (rnd() < 0.55 ? 1 : 0) + (rnd() < 0.25 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const ox = x + (k - (n - 1) / 2) * s * 1.1, oy = y + (k % 2) * s * 0.25, w = s * (0.9 + rnd() * 0.4);
      ctx.beginPath(); ctx.moveTo(ox - w, oy); ctx.quadraticCurveTo(ox - w * 0.15, oy - w * 0.95, ox + w, oy); ctx.fillStyle = 'rgba(214,205,165,0.55)'; ctx.fill(); ctx.stroke();
      ctx.lineWidth = 0.55; ctx.beginPath();
      for (let j = 0; j < 3; j++) { const hx = ox + w * (0.2 + j * 0.22); ctx.moveTo(hx, oy - w * (0.42 - j * 0.12)); ctx.lineTo(hx + w * 0.1, oy - w * 0.04); }
      ctx.stroke(); ctx.lineWidth = 0.9;
    }
  }
  function tree(ctx, x, y, s, kind, r) {
    ctx.strokeStyle = INK; ctx.lineWidth = 0.75; ctx.lineCap = 'round';
    if (kind === 'pine' || kind === 'dark') {
      const h = s * (1.7 + r * 0.5), w = s * 0.5;
      ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - s * 0.2); ctx.lineTo(x - w, y - s * 0.2); ctx.closePath(); ctx.fillStyle = kind === 'dark' ? PAL.treeDark : PAL.pine; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - s * 0.2); ctx.lineTo(x, y + s * 0.12); ctx.moveTo(x, y - h * 0.8); ctx.lineTo(x, y - s * 0.35); ctx.stroke();
    } else {
      const rx = s * (0.42 + r * 0.1), ry = s * (0.6 + r * 0.14);
      ctx.beginPath(); ctx.moveTo(x, y + s * 0.15); ctx.lineTo(x, y - s * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y - s * 0.3 - ry, rx, ry, (r - 0.5) * 0.25, 0, Math.PI * 2); ctx.fillStyle = kind === 'gold' ? PAL.treeGold : PAL.tree; ctx.fill(); ctx.stroke();
      ctx.lineWidth = 0.5; ctx.beginPath(); ctx.ellipse(x + rx * 0.15, y - s * 0.3 - ry * 0.95, rx * 0.55, ry * 0.6, 0, -0.9, 1.1); ctx.stroke();
    }
  }
  function marsh(ctx, x, y, s, rnd) {
    ctx.strokeStyle = INK; ctx.lineWidth = 0.7; ctx.lineCap = 'round'; ctx.globalAlpha = 0.8; ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
    for (let k = -1; k <= 1; k++) { ctx.moveTo(x + k * s * 0.4, y); ctx.lineTo(x + k * s * 0.55, y - s * (0.6 + rnd() * 0.4)); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  function dune(ctx, x, y, s) {
    ctx.strokeStyle = INK; ctx.lineWidth = 0.75; ctx.globalAlpha = 0.7; ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x - s * 0.2, y - s * 0.55, x + s * 0.35, y - s * 0.1); ctx.quadraticCurveTo(x + s * 0.7, y, x + s, y - s * 0.06); ctx.stroke();
    ctx.fillStyle = INK; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x - s * 0.5 + k * s * 0.36, y + 3 + (k % 2) * 2, 0.55, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function ashMark(ctx, x, y, s, rnd) {
    ctx.strokeStyle = INK; ctx.lineWidth = 0.65; ctx.globalAlpha = 0.6; ctx.beginPath(); let cx = x, cy = y; ctx.moveTo(cx, cy);
    for (let k = 0; k < 4; k++) { cx += (rnd() - 0.3) * s; cy += (rnd() - 0.5) * s * 0.6; ctx.lineTo(cx, cy); } ctx.stroke(); ctx.globalAlpha = 1;
  }
  function tuft(ctx, x, y, s) { ctx.strokeStyle = INK; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(x - s * 0.4, y); ctx.lineTo(x - s * 0.6, y - s * 0.6); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 0.8); ctx.moveTo(x + s * 0.4, y); ctx.lineTo(x + s * 0.65, y - s * 0.55); ctx.stroke(); ctx.globalAlpha = 1; }

  function building(ctx, x, y, kind) {
    ctx.save(); ctx.translate(x, y); ctx.lineWidth = 0.9; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const wall = '#e9e0c2', roof = '#8d845f', dark = INK;
    const rect = (a, b, w, h, f) => { ctx.beginPath(); ctx.rect(a, b, w, h); ctx.fillStyle = f; ctx.fill(); ctx.stroke(); };
    const cren = (a, b, w) => { ctx.beginPath(); for (let k = 0; k < w; k += 4) ctx.rect(a + k, b - 2.4, 2.2, 2.4); ctx.fillStyle = wall; ctx.fill(); ctx.stroke(); };
    const house = (a, b, w) => { rect(a, b - w * 0.7, w, w * 0.7, wall); ctx.beginPath(); ctx.moveTo(a - 1.5, b - w * 0.7); ctx.lineTo(a + w / 2, b - w * 1.25); ctx.lineTo(a + w + 1.5, b - w * 0.7); ctx.closePath(); ctx.fillStyle = roof; ctx.fill(); ctx.stroke(); };
    const flag = (a, b) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(a, b - 9); ctx.stroke(); ctx.beginPath(); ctx.moveTo(a, b - 9); ctx.lineTo(a + 6.5, b - 7); ctx.lineTo(a, b - 5); ctx.fillStyle = '#8f2c22'; ctx.fill(); };
    switch (kind) {
      case 'tower': rect(-4, -20, 8, 20, wall); cren(-4, -20, 8); rect(-1.2, -13, 2.4, 4, dark); flag(0, -22); break;
      case 'citadel': rect(-17, -9, 34, 9, wall); cren(-17, -9, 34); rect(-12, -18, 24, 9, wall); cren(-12, -18, 24); rect(-7, -27, 14, 9, wall); cren(-7, -27, 14); rect(-2.2, -41, 4.4, 14, '#f6f1e0');
        ctx.beginPath(); ctx.moveTo(-3.2, -41); ctx.lineTo(0, -48); ctx.lineTo(3.2, -41); ctx.closePath(); ctx.fillStyle = '#f6f1e0'; ctx.fill(); ctx.stroke(); rect(-2, -6, 4, 6, dark); flag(0, -48); break;
      case 'port': house(-12, 0, 8); house(-2, -3, 9); house(8, 1, 7); ctx.beginPath(); ctx.moveTo(-15, 4); ctx.lineTo(15, 4); ctx.moveTo(12, 4); ctx.lineTo(12, 9); ctx.moveTo(6, 4); ctx.lineTo(6, 9); ctx.stroke(); break;
      case 'town': house(-12, 0, 8); house(-2, -3, 9); house(8, 1, 7); break;
      case 'gate': rect(-15, -22, 8, 22, '#6b6253'); rect(7, -22, 8, 22, '#6b6253'); rect(-7, -15, 14, 15, '#3a342b'); ctx.beginPath(); for (let k = -5; k <= 5; k += 3.3) { ctx.moveTo(k, -15); ctx.lineTo(k, 0); } ctx.stroke(); break;
      case 'mine': ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-9, -8); ctx.arc(0, -8, 9, Math.PI, 0); ctx.lineTo(9, 0); ctx.closePath(); ctx.fillStyle = wall; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-5, -7); ctx.arc(0, -7, 5, Math.PI, 0); ctx.lineTo(5, 0); ctx.closePath(); ctx.fillStyle = dark; ctx.fill(); break;
      case 'fort': rect(-15, -10, 30, 10, wall); cren(-15, -10, 30); rect(-19, -17, 7, 17, wall); cren(-19, -17, 7); rect(12, -17, 7, 17, wall); cren(12, -17, 7); rect(-3, -6, 6, 6, dark); break;
      case 'oasis': ctx.beginPath(); ctx.ellipse(0, 1, 12, 3.5, 0, 0, 7); ctx.fillStyle = PAL.lake; ctx.fill(); ctx.stroke();
        for (const [a, h] of [[-7, 16], [5, 13]]) { ctx.beginPath(); ctx.moveTo(a, 0); ctx.quadraticCurveTo(a + 2, -h / 2, a + 1, -h); ctx.stroke(); for (const r of [-2.5, -1.7, -0.8, 0.2, 0.9]) { ctx.beginPath(); ctx.moveTo(a + 1, -h); ctx.quadraticCurveTo(a + 1 + Math.cos(r) * 5, -h + Math.sin(r) * 5 - 2, a + 1 + Math.cos(r) * 8, -h + Math.sin(r) * 6 + 2); ctx.stroke(); } } break;
      case 'darktower': ctx.fillStyle = '#2c2822'; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-5, -30); ctx.lineTo(-9, -32); ctx.lineTo(-3, -40); ctx.lineTo(-2, -50); ctx.lineTo(0, -44); ctx.lineTo(2, -50); ctx.lineTo(3, -40); ctx.lineTo(9, -32); ctx.lineTo(5, -30); ctx.lineTo(8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#c8452a'; ctx.beginPath(); ctx.ellipse(0, -44, 2.6, 1.4, 0, 0, 7); ctx.fill(); break;
      case 'ringtower': ctx.beginPath(); ctx.ellipse(0, 0, 18, 7, 0, 0, 7); ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 0.9; ctx.fillStyle = '#35302a'; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-3, -26); ctx.lineTo(-5, -30); ctx.lineTo(-1, -29); ctx.lineTo(0, -33); ctx.lineTo(1, -29); ctx.lineTo(5, -30); ctx.lineTo(3, -26); ctx.lineTo(4, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'pillars': for (const s of [-1, 1]) { const px = s * 11; ctx.fillStyle = wall; ctx.beginPath(); ctx.moveTo(px - 3, 0); ctx.lineTo(px - 2.5, -15); ctx.lineTo(px - 1, -18); ctx.lineTo(px + 1, -18); ctx.lineTo(px + 2.5, -15); ctx.lineTo(px + 3, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(px, -20, 2, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(px + s * 2, -14); ctx.lineTo(px + s * 6, -18); ctx.stroke(); } break;
      case 'falls': ctx.lineWidth = 1.2; ctx.strokeStyle = '#eef3f0'; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * 2, -8); ctx.lineTo(k * 2.2, 3); ctx.stroke(); } break;
      case 'ruin': rect(-9, -7, 4, 7, wall); rect(-3, -12, 4, 12, wall); rect(4, -5, 4, 5, wall); ctx.beginPath(); ctx.moveTo(-3, -12); ctx.lineTo(-1, -14); ctx.lineTo(1, -12); ctx.stroke(); break;
      case 'stones': for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; rect(Math.cos(a) * 12 - 1.4, Math.sin(a) * 5 - 5, 2.8, 5 + (k % 3), wall); } break;
      case 'house': for (const [hx, hy, w] of [[-10, 0, 8], [1, -3, 9], [9, 2, 7]]) { rect(hx, hy - w * 0.6, w, w * 0.6, wall); ctx.beginPath(); ctx.moveTo(hx - 1, hy - w * 0.6); ctx.quadraticCurveTo(hx + w / 2, hy - w * 1.4, hx + w + 1, hy - w * 0.6); ctx.closePath(); ctx.fillStyle = roof; ctx.fill(); ctx.stroke(); } break;
    }
    ctx.restore();
  }
  function compass(ctx, x, y, r) {
    ctx.save(); ctx.translate(x, y); ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.63, 0, 7); ctx.stroke();
    for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2, r1 = r * 0.63, r2 = r * (k % 4 ? 0.59 : 0.53); ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); ctx.stroke(); }
    const star = (len, w, rot) => { for (let k = 0; k < 4; k++) { const a = rot + k * Math.PI / 2; const tx = Math.cos(a) * len, ty = Math.sin(a) * len, lx = Math.cos(a - Math.PI / 2) * w, ly = Math.sin(a - Math.PI / 2) * w;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tx, ty); ctx.lineTo(lx, ly); ctx.closePath(); ctx.fillStyle = '#d9d0ac'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tx, ty); ctx.lineTo(-lx, -ly); ctx.closePath(); ctx.fillStyle = INK; ctx.fill(); ctx.stroke(); } };
    star(r * 0.58, r * 0.085, Math.PI / 4); star(r, r * 0.13, -Math.PI / 2);
    ctx.fillStyle = INK; ctx.font = `${r * 0.3}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -r * 1.2); ctx.fillText('S', 0, r * 1.2); ctx.fillText('E', r * 1.2, 0); ctx.fillText('W', -r * 1.2, 0);
    ctx.restore();
  }
  function text(ctx, str, x, y, size, o = {}) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot || 0);
    ctx.font = `italic ${size}px ${FONT}`; ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (o.spacing || 0) + 'px';
    if (o.halo) { ctx.lineJoin = 'round'; ctx.strokeStyle = o.halo; ctx.lineWidth = 3; ctx.strokeText(str, 0, 0); }
    ctx.fillStyle = o.color || INK; ctx.fillText(str, 0, 0); ctx.restore();
  }

  /* ---------- paint ---------- */
  async function paint(world, progress, S) {
    const { GW, GH, CELL, lab, seaD, MR, RIV } = world; const B = world.borders;
    const c = document.createElement('canvas'); c.width = Math.round(W * S); c.height = Math.round(H * S);
    const ctx = c.getContext('2d'); ctx.setTransform(S, 0, 0, S, 0, 0); ctx.imageSmoothingQuality = 'high';
    if (G.MATERIALS.illustratedAtlas(ctx, world, W, H)) {
      progress(.94, 'Unfolding the illustrated atlas…'); await tick();
      return { canvas: c };
    }
    const smp = MG.makeSampler(world); const land = B.land.path;
    const mr = (x, y) => smp.bil(MR, x, y);
    progress(0.6, 'Laying down the sea…'); await tick();

    // sea: flat grey-green with a soft mottle
    {
      const mw = 500, mh = 350, m = document.createElement('canvas'); m.width = mw; m.height = mh; const mx = m.getContext('2d'); const id = mx.createImageData(mw, mh), d = id.data;
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
        const wx = x / mw * W, wy = y / mh * H; const n = fbm(N1, wx / 260, wy / 260, 3) * 7 + fbm(N2, wx / 50, wy / 50, 2) * 3;
        const sd = smp.seaD(wx, wy); const near = 5 * (1 - clamp(sd / 14, 0, 1)); const i = (y * mw + x) * 4;
        d[i] = PAL.sea[0] + n + near; d[i + 1] = PAL.sea[1] + n + near; d[i + 2] = PAL.sea[2] + n + near * 0.8; d[i + 3] = 255;
      }
      mx.putImageData(id, 0, 0); ctx.drawImage(m, 0, 0, W, H);
    }
    // offshore dashed contours
    {
      const edge = (x, y) => x < 3 || y < 3 || x > GW - 4 || y > GH - 4;
      for (const [dist, alpha, dash] of [[9, 0.55, [7, 5]], [19, 0.28, [3, 6]]]) {
        const loops = maskLoops(GW, GH, CELL, (x, y) => { const l = lab[y * GW + x]; return l < 0 && seaD[y * GW + x] > dist; });
        ctx.save(); ctx.setLineDash(dash); ctx.lineWidth = 1.05; ctx.strokeStyle = `rgba(38,44,36,${alpha})`; ctx.lineCap = 'round';
        for (const lp of loops) {
          const sm = smoothLoop(lp, 5); ctx.beginPath(); let pen = false;
          for (let i = 0; i <= sm.length; i++) { const p = sm[i % sm.length]; if (p[0] < 10 || p[1] < 10 || p[0] > W - 10 || p[1] > H - 10) { pen = false; continue; } if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; } }
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    progress(0.66, 'Colouring the realms…'); await tick();

    // lands: flat region colour with a pillowy inner shadow
    TERR.forEach((t, i) => {
      const path = B.terrPaths[i].path; const base = PAL.region[t.region];
      ctx.fillStyle = base; ctx.fill(path, 'evenodd');
      const v = hash2(i * 17, i * 5) - 0.5;
      ctx.fillStyle = v > 0 ? `rgba(255,250,225,${v * 0.22})` : `rgba(70,60,30,${-v * 0.16})`; ctx.fill(path, 'evenodd');
      ctx.save(); ctx.clip(path, 'evenodd'); ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(74,62,34,0.055)';
      for (const w of [54, 40, 28, 18, 10, 5]) { ctx.lineWidth = w; ctx.stroke(path); }
      ctx.restore();
    });
    // ghosted region lettering
    D.REGIONS.forEach((r, ri) => {
      const sh = world.regionShape[ri]; let ang = sh.ang; if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      if (sh.l1 / sh.l2 < 1.2) ang = 0;
      const name = r.name.replace(/^The /, '').toUpperCase(); const span = sh.l1 * 3.0;
      ctx.save(); ctx.font = `100px ${FONT}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '26px'; const wdt = ctx.measureText(name).width; ctx.restore();
      const size = clamp(100 * span / wdt, 40, 104);
      text(ctx, name, sh.mx, sh.my, size * .88, { rot: ang, spacing: size * 0.18, color: 'rgba(86,76,52,0.13)' });
    });
    G.MATERIALS.patina(ctx, W, H);
    // territory limits: dotted inside a region, dash-dot between regions; none where a river runs
    {
      const dotted = new Path2D(), regional = new Path2D();
      for (const ln of B.lines) {
        if (ln.frame || ln.coast || ln.l < 0 || ln.r < 0) continue;
        const P = TERR[ln.l].region !== TERR[ln.r].region ? regional : dotted; let pen = false;
        for (let k = 0; k < ln.pts.length; k++) {
          const p = ln.pts[k]; const onRiver = RIV[smp.idx(p[0], p[1])];
          if (onRiver) { pen = false; continue; }
          if (pen) P.lineTo(p[0], p[1]); else { P.moveTo(p[0], p[1]); pen = true; }
        }
      }
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(39,36,27,0.9)'; ctx.setLineDash([0.1, 4.6]); ctx.lineWidth = 1.9; ctx.stroke(dotted);
      ctx.setLineDash([7, 4, 0.1, 4]); ctx.lineWidth = 1.9; ctx.stroke(regional);
      ctx.restore();
    }
    // rivers: wide, outlined, tapering to the source
    ctx.save(); ctx.clip(land, 'evenodd'); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const riverW = (rv, t) => lerp(1.5, rv.w * 2.7, Math.pow(t, 0.75));
    for (const pass of [0, 1]) for (const rv of world.rivers) {
      const n = rv.pts.length;
      for (let i = 0; i < n - 1; i++) {
        const w = riverW(rv, i / (n - 1));
        ctx.beginPath(); ctx.moveTo(rv.pts[i][0], rv.pts[i][1]); ctx.lineTo(rv.pts[i + 1][0], rv.pts[i + 1][1]);
        if (pass === 0) { ctx.strokeStyle = INK; ctx.lineWidth = w + 2.6; } else { ctx.strokeStyle = PAL.river; ctx.lineWidth = w; }
        ctx.stroke();
      }
    }
    ctx.restore();
    // lakes and inland seas take the river colour
    // bold coastline
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 3.3; ctx.stroke(B.coastLine);
    progress(0.74, 'Inking mountains and forests…'); await tick();

    // ---- glyphs ----
    const rnd = mulberry32(2026);
    const zones = TERR.map(t => [t.lx, t.ly, 30 + t.name.length * 4.4]);
    const nearLabel = (x, y) => { for (const [ax, ay, rw] of zones) { const dx = (x - ax) / rw, dy = (y - ay + 12) / 30; if (dx * dx + dy * dy < 1) return true; } return false; };
    const busy = [...D.SETTLEMENTS.map(s => [s[0], s[1] - 8, 22]), ...D.LANDMARKS.map(l => [l[0], l[1] - 10, l[2] === 'lonely' ? 34 : l[2] === 'volcano' ? 40 : 20])];
    const nearBusy = (x, y) => busy.some(([bx, by, r]) => Math.hypot(x - bx, y - by) < r);
    const isLand = (x, y, m = 7) => smp.lab(x, y) >= 0 && smp.lab(x + m, y) >= 0 && smp.lab(x - m, y) >= 0 && smp.lab(x, y + m * 0.6) >= 0 && smp.lab(x, y - m) >= 0;
    const glyphs = [];
    // mountain clusters
    {
      const occ = []; const cand = [];
      for (let k = 0; k < 52000; k++) cand.push([rnd() * W, rnd() * H, rnd()]);
      for (const [x, y, r] of cand) {
        const m = mr(x, y); if (m < 0.2 || r > m * 1.35) continue;
        const s = 13 + 30 * Math.min(1.15, m) * (0.55 + 0.6 * rnd());
        if (!isLand(x, y, s * 0.45) || nearLabel(x, y) || nearBusy(x, y) || smp.riv(x, y) || smp.riv(x - s * 0.4, y) || smp.riv(x + s * 0.4, y)) continue;
        let ok = true; for (let j = occ.length - 1; j >= 0 && ok; j--) { const o = occ[j]; const dx = x - o[0], dy = (y - o[1]) * 1.9; if (dx * dx + dy * dy < Math.pow((o[2] + s) * 0.3, 2)) ok = false; }
        if (!ok) continue; occ.push([x, y, s]);
        const shadow = y > 740 && y < 1125 && x > 1410; const tone = shadow ? 'dark' : (y < 175 || (m > 1.0 && y < 420)) ? 'snow' : 'normal'; const sd = (rnd() * 1e9) | 0;
        glyphs.push({ y, f: () => mountain(ctx, x, y, s, mulberry32(sd), tone) });
      }
      // foothills and downs
      for (let y = 20; y < H - 10; y += 22) for (let x = 15; x < W - 10; x += 26) {
        const jx = x + (rnd() - .5) * 18, jy = y + (rnd() - .5) * 14; const m = mr(jx, jy);
        let hl = 0; for (const [hx, hy, hr, hh] of D.HILLS) { const d = Math.hypot(jx - hx, jy - hy); if (d < hr) hl = Math.max(hl, hh * (1 - d / hr)); }
        const want = (m > 0.07 && m < 0.2 && rnd() < 0.6) || (hl > 0.03 && rnd() < 0.2 + hl * 3);
        if (!want || !isLand(jx, jy, 9) || nearLabel(jx, jy) || nearBusy(jx, jy) || smp.riv(jx, jy) || smp.fo(jx, jy) > 0.3) continue;
        const s = 6 + rnd() * 5, sd = (rnd() * 1e9) | 0; glyphs.push({ y: jy, f: () => hill(ctx, jx, jy, s, mulberry32(sd)) });
      }
    }
    // forests and groves
    for (let y = 10; y < H - 6; y += 9.4) for (let x = 10; x < W - 6; x += 9.8) {
      const jx = x + (rnd() - .5) * 8, jy = y + (rnd() - .5) * 7;
      const [F, kind0] = MG.forestAt(jx, jy); let kind = kind0; const m = mr(jx, jy);
      let place = F * (0.55 + 0.8 * (N2(jx / 13, jy / 13) * 0.5 + 0.5)) > 0.52;
      if (!place && m < 0.12) {
        const l = smp.lab(jx, jy); const reg = l >= 0 ? TERR[l].region : -1; const grove = fbm(N1, jx / 40, jy / 40, 3);
        if ((reg === 1 || reg === 3 || reg === 5 || reg === 6 || reg === 4 || reg === 0) && grove > 0.38 && rnd() < 0.5) { place = true; kind = reg === 0 ? 'pine' : 'broad'; }
      }
      if (!place || m > 0.26 || !isLand(jx, jy, 5) || smp.riv(jx, jy) || nearLabel(jx, jy) || nearBusy(jx, jy)) continue;
      const s = 6.6 * (0.82 + 0.4 * rnd()), rr = rnd(); glyphs.push({ y: jy, f: () => tree(ctx, jx, jy, s, kind, rr) });
    }
    // plains, deserts, ash, marsh
    for (let y = 14; y < H - 10; y += 24) for (let x = 12; x < W - 10; x += 27) {
      const jx = x + (rnd() - .5) * 18, jy = y + (rnd() - .5) * 14;
      if (!isLand(jx, jy, 8) || nearLabel(jx, jy) || nearBusy(jx, jy) || smp.riv(jx, jy) || mr(jx, jy) > 0.14 || smp.fo(jx, jy) > 0.25) continue;
      const reg = TERR[smp.lab(jx, jy)].region; const sd = (rnd() * 1e9) | 0;
      if (reg === 8) { if (rnd() < 0.55) { const s = 8 + rnd() * 6; glyphs.push({ y: jy, f: () => dune(ctx, jx, jy, s) }); } }
      else if (reg === 7) { if (rnd() < 0.5) glyphs.push({ y: jy, f: () => ashMark(ctx, jx, jy, 6, mulberry32(sd)) }); }
      else if (rnd() < 0.3) glyphs.push({ y: jy, f: () => tuft(ctx, jx, jy, 3.6) });
    }
    for (const [mx, my, mrad] of D.MARSHES) for (let k = 0; k < mrad * 0.9; k++) {
      const a = rnd() * 6.283, d = Math.sqrt(rnd()) * mrad; const x = mx + Math.cos(a) * d, y = my + Math.sin(a) * d * 0.7;
      if (!isLand(x, y, 5) || nearLabel(x, y) || smp.riv(x, y)) continue; const sd = (rnd() * 1e9) | 0; glyphs.push({ y, f: () => marsh(ctx, x, y, 5, mulberry32(sd)) });
    }
    for (const s of D.SETTLEMENTS) glyphs.push({ y: s[1] + 0.5, f: () => building(ctx, s[0], s[1], s[2]) });
    for (const l of D.LANDMARKS) {
      if (l[2] === 'lonely') glyphs.push({ y: l[1] + 14, f: () => mountain(ctx, l[0], l[1] + 14, 56, mulberry32(5), 'snow') });
      else if (l[2] === 'volcano') glyphs.push({ y: l[1] + 16, f: () => { mountain(ctx, l[0], l[1] + 16, 62, mulberry32(9), 'dark'); ctx.fillStyle = '#c8452a'; ctx.beginPath(); ctx.ellipse(l[0], l[1] - 38, 5, 2.4, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#c8452a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(l[0] - 2, l[1] - 36); ctx.quadraticCurveTo(l[0] - 8, l[1] - 18, l[0] - 15, l[1] - 4); ctx.moveTo(l[0] + 3, l[1] - 36); ctx.quadraticCurveTo(l[0] + 8, l[1] - 20, l[0] + 6, l[1] - 2); ctx.stroke(); } });
      else if (l[2] === 'goldtree') glyphs.push({ y: l[1], f: () => tree(ctx, l[0], l[1], 15, 'gold', 0.6) });
      else glyphs.push({ y: l[1] + 0.4, f: () => building(ctx, l[0], l[1], l[2]) });
    }
    glyphs.sort((a, b) => a.y - b.y);
    for (let i = 0; i < glyphs.length; i++) { glyphs[i].f(); if (i % 2500 === 0) { progress(0.74 + 0.16 * i / glyphs.length, 'Inking mountains and forests…'); await tick(); } }

    // small painted names: landmarks, lakes, ranges, rivers
    for (const l of D.LANDMARKS) if (l[3]) text(ctx, l[3], l[0], l[1] + (l[2] === 'lonely' || l[2] === 'volcano' ? 24 : 11), 9.5, { halo: 'rgba(220,210,170,0.7)' });
    for (const lk of D.LAKES) if (lk[5]) text(ctx, lk[5], lk[0], lk[1] + lk[3] + 11, 9.5, { halo: 'rgba(220,210,170,0.7)' });
    for (const m of D.MARSHES) if (m[3]) text(ctx, m[3], m[0], m[1] + m[2] * 0.7 + 9, 9.5, { halo: 'rgba(220,210,170,0.7)' });
    for (const r of D.RIDGES) if (r.pts.length > 2 && r.name) {
      const k = Math.floor(r.pts.length / 2), a = r.pts[k - 1], b = r.pts[k]; let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      text(ctx, r.name, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 11, { rot: ang, spacing: 2, halo: 'rgba(222,213,173,0.75)' });
    }
    progress(0.92, 'Lettering the chart…'); await tick();

    // sea furniture: compass, legend, sea names, routes
    const seaOk = (x, y, d) => smp.lab(x, y) === -1 && smp.seaD(x, y) > d;
    const findSea = (x, y, d) => { for (let r = 0; r < 320; r += 8) for (let a = 0; a < 6.28; a += 0.4) { const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (px > 50 && py > 50 && px < W - 50 && py < H - 50 && seaOk(px, py, d)) return [px, py]; } return null; };
    const cp = findSea(140, 215, 30); if (cp) compass(ctx, cp[0], cp[1], 50);
    for (const L of D.SEA_LABELS) text(ctx, L.t, L.x, L.y, L.s * 0.72, { rot: L.r, spacing: 3, color: 'rgba(39,44,36,0.78)' });
    { // legend of regions and their bonuses
      const x0 = 300, y0 = 1128; ctx.save();
      D.REGIONS.forEach((r, i) => { const y = y0 + i * 25; text(ctx, r.name.replace(/^The /, ''), x0, y, 16.5, { align: 'right', spacing: 1 }); text(ctx, String(r.bonus), x0 + 34, y, 16.5, { align: 'center' }); });
      ctx.restore();
    }
    world.seaRoutes = D.SEA_LINKS.map(([a, b]) => { const A = TERR[a], Bq = TERR[b]; const mx = (A.lx + Bq.lx) / 2 + (A.ly - Bq.ly) * 0.12, my = (A.ly + Bq.ly) / 2 + (Bq.lx - A.lx) * 0.12; return [A.lx, A.ly, mx, my, Bq.lx, Bq.ly]; });
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(land, 'evenodd');
    // (clip to sea: frame rect minus land)
    ctx.restore();
    {
      const seaClip = new Path2D(); seaClip.rect(0, 0, W, H); seaClip.addPath(land);
      ctx.save(); ctx.clip(seaClip, 'evenodd'); ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(39,36,27,0.75)';
      for (const r of world.seaRoutes) { ctx.beginPath(); ctx.moveTo(r[0], r[1]); ctx.quadraticCurveTo(r[2], r[3], r[4], r[5]); ctx.stroke(); }
      ctx.restore();
    }
    // paper grain, edge burn, frame
    const tex = MG.paperTexture(384);
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.82; ctx.fillStyle = ctx.createPattern(tex, 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'multiply';
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.hypot(W, H) * 0.58);
    vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(1, 'rgba(96,84,58,0.22)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.strokeRect(7, 7, W - 14, H - 14); ctx.lineWidth = 0.9; ctx.strokeRect(13, 13, W - 26, H - 26);
    return { canvas: c };
  }

  /* ---------- clouds ---------- */
  function cloudShadowCanvas(size) {
    const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); const id = x.createImageData(size, size), d = id.data;
    const f = (px, py) => fbm(N1, px / size * 3.4 + 40, py / size * 3.4 + 40, 4) * 0.5 + 0.5;
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const wu = smoothstep(0.78, 1, px / size), wv = smoothstep(0.78, 1, py / size);
      const n = lerp(lerp(f(px, py), f(px - size, py), wu), lerp(f(px, py - size), f(px - size, py - size), wu), wv);
      const v = 255 * (1 - 0.17 * smoothstep(0.52, 0.72, n)); const i = (py * size + px) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    x.putImageData(id, 0, 0); return c;
  }
  function cloudPuffCanvas(seed) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200; const x = c.getContext('2d'); const rnd = mulberry32(seed);
    for (let k = 0; k < 18; k++) {
      const a = rnd() * 6.283, r = Math.sqrt(rnd()); const px = 160 + Math.cos(a) * r * 100, py = 104 + Math.sin(a) * r * 38; const rad = 30 + rnd() * 40;
      const g = x.createRadialGradient(px, py, 0, px, py, rad); g.addColorStop(0, 'rgba(250,248,238,0.5)'); g.addColorStop(0.6, 'rgba(250,248,238,0.18)'); g.addColorStop(1, 'rgba(250,248,238,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
    }
    return c;
  }

  /* ---------- ink sketches for the side panels ---------- */
  function sketch(canvas, kind) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); const w = canvas.clientWidth || 240, h = canvas.clientHeight || 120;
    canvas.width = w * dpr; canvas.height = h * dpr; const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry32(kind === 'tree' ? 77 : 21); const col = 'rgba(214,186,128,0.62)';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const n = NZ.makeSimplex(kind === 'tree' ? 9 : 4);
    const ridgeLine = (base, amp, f, lw, hatch) => {
      const pts = []; for (let x = -4; x <= w + 4; x += 3) { let v = 0, a = 1, ff = f; for (let o = 0; o < 4; o++) { v += a * (1 - Math.abs(n(x * ff, o * 7 + base))); a *= 0.5; ff *= 2.1; } pts.push([x, base - v * amp * 0.5]); }
      ctx.lineWidth = lw; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
      if (hatch) { ctx.lineWidth = 0.6; ctx.beginPath(); for (let i = 2; i < pts.length - 2; i += 2) { const s = pts[i + 1][1] - pts[i - 1][1]; if (s > 0.5) { ctx.moveTo(pts[i][0], pts[i][1] + 2); ctx.lineTo(pts[i][0] + 5, pts[i][1] + 9 + s * 2); } } ctx.stroke(); }
    };
    ridgeLine(h * 0.5, h * 0.55, 0.012, 1, true); ridgeLine(h * 0.72, h * 0.3, 0.02, 0.9, true);
    ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(0, h * 0.9); ctx.bezierCurveTo(w * 0.3, h * 0.82, w * 0.6, h * 0.95, w, h * 0.86); ctx.stroke();
    if (kind === 'tree') {
      const branch = (x, y, a, len, d) => { if (d === 0 || len < 3) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; ctx.lineWidth = Math.max(0.5, d * 0.55); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke(); branch(x2, y2, a - 0.35 - rnd() * 0.3, len * 0.74, d - 1); branch(x2, y2, a + 0.3 + rnd() * 0.35, len * 0.7, d - 1); };
      branch(w * 0.3, h * 0.9, -Math.PI / 2, h * 0.22, 6);
      const ax = w * 0.72, ay = h * 0.9; ctx.lineWidth = 1.1;
      for (const o of [-16, 16]) { ctx.beginPath(); ctx.rect(ax + o - 3, ay - 34, 6, 34); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(ax, ay - 34, 16, Math.PI, Math.PI * 1.62); ctx.stroke(); ctx.beginPath(); ctx.arc(ax, ay - 34, 16, Math.PI * 1.8, Math.PI * 2); ctx.stroke();
    } else {
      const ax = w * 0.68, ay = h * 0.9; ctx.lineWidth = 1.1;
      for (let k = 0; k < 4; k++) { const cx = ax + k * 15 - 22, ch = 26 + (k % 2) * 12 - (k === 3 ? 12 : 0); ctx.beginPath(); ctx.rect(cx - 2.5, ay - ch, 5, ch); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(ax - 14.5, ay - 38, 7.5, Math.PI, 0); ctx.stroke(); ctx.beginPath(); ctx.arc(ax + 0.5, ay - 38, 7.5, Math.PI, Math.PI * 1.55); ctx.stroke();
      for (let i = 0; i < 3; i++) { const bx = w * (0.3 + i * 0.09), by = h * (0.2 + (i % 2) * 0.07); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(bx - 4, by); ctx.quadraticCurveTo(bx - 2, by - 3, bx, by); ctx.quadraticCurveTo(bx + 2, by - 3, bx + 4, by); ctx.stroke(); }
    }
  }

  G.ATLAS = { prepare, paint, sketch, cloudShadowCanvas, cloudPuffCanvas, FONT, INK };
})(window);
