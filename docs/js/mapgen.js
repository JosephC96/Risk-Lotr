/* World generation: fields, territories (geodesic growth), planar borders, painted static map */
(function (G) {
  const D = G.DATA, NZ = G.NZ;
  const { W, H, TERR } = D;
  const CELL = 2.5, GW = Math.round(W / CELL), GH = Math.round(H / CELL);
  const NT = TERR.length;
  const { N1, N2, N3, fbm, ridged, smoothstep, clamp, lerp, hash2 } = NZ;

  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------------- geometry helpers ---------------- */
  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  }
  function catmull(pts, step) {
    const out = [];
    const P = [pts[0], ...pts, pts[pts.length - 1]];
    for (let i = 1; i < P.length - 2; i++) {
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const n = Math.max(2, Math.ceil(len / step));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]]; const e2 = eps * eps;
    while (stack.length) {
      const [a, b] = stack.pop(); let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = segDist2(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
        if (d > md) { md = d; mi = i; }
      }
      if (md > e2) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function chaikin(pts, iter, closed) {
    let p = pts;
    for (let it = 0; it < iter; it++) {
      const o = [];
      const n = p.length;
      if (closed) {
        for (let i = 0; i < n - 1; i++) {
          const a = p[i], b = p[i + 1];
          o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
        }
        o.push(o[0].slice());
      } else {
        o.push(p[0]);
        for (let i = 0; i < n - 1; i++) {
          const a = p[i], b = p[i + 1];
          if (i > 0) o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25]);
          if (i < n - 2) o.push([a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
        }
        o.push(p[n - 1]);
      }
      p = o;
    }
    return p;
  }
  function wobble(pts, amp, scale, closed) {
    // subdivide + displace along normal, tapering to fixed endpoints
    const sub = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / 4));
      for (let k = 0; k < n; k++) sub.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    sub.push(pts[pts.length - 1].slice());
    let acc = 0; const cum = [0];
    for (let i = 1; i < sub.length; i++) { acc += Math.hypot(sub[i][0] - sub[i - 1][0], sub[i][1] - sub[i - 1][1]); cum.push(acc); }
    const out = sub.map((p, i) => {
      if (!closed && (i === 0 || i === sub.length - 1)) return p;
      const a = sub[Math.max(0, i - 1)], b = sub[Math.min(sub.length - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const taper = closed ? 1 : Math.min(1, cum[i] / 12, (acc - cum[i]) / 12);
      const d = amp * taper * (fbm(N2, p[0] / scale, p[1] / scale, 3) + 0.35 * N3(p[0] / 7, p[1] / 7));
      return [p[0] + nx * d, p[1] + ny * d];
    });
    if (closed) out[out.length - 1] = out[0].slice();
    return out;
  }

  /* ---------------- fields ---------------- */
  const seedSigma = TERR.map(t => t.biome === 'island' ? 70 : 108);
  function landField(x, y) {
    let s = 0;
    for (let i = 0; i < NT; i++) {
      const dx = x - TERR[i].sx, dy = y - TERR[i].sy, d2 = dx * dx + dy * dy, sg = seedSigma[i];
      if (d2 < 16 * sg * sg) s += Math.exp(-d2 / (2 * sg * sg));
    }
    for (const b of D.LAND_BLOBS) {
      const dx = x - b[0], dy = y - b[1], d2 = dx * dx + dy * dy;
      if (d2 < 16 * b[2] * b[2]) s += b[3] * Math.exp(-d2 / (2 * b[2] * b[2]));
    }
    s = Math.min(s, 1.4);
    for (const b of D.SEA_BLOBS) {
      const dx = x - b[0], dy = y - b[1], d2 = dx * dx + dy * dy;
      if (d2 < 16 * b[2] * b[2]) s -= b[3] * Math.exp(-d2 / (2 * b[2] * b[2]));
    }
    s += 0.40 * fbm(N1, x / 210, y / 210, 5) + 0.10 * fbm(N2, x / 60, y / 60, 3);
    const west = smoothstep(820, 300, x);
    s += west * (0.22 * fbm(N3, x / 38, y / 38, 3) - 0.16 * Math.max(0, ridged(N2, x / 70, y / 26, 2) - 0.55));
    for (const lk of D.LAKES) { const c = Math.cos(lk[4]), si = Math.sin(lk[4]); const dx = x - lk[0], dy = y - lk[1]; const u = (dx * c + dy * si) / lk[2], v = (-dx * si + dy * c) / lk[3]; const q = u * u + v * v + 0.18 * N2(x / 9, y / 9); if (q < 1.4) s -= 2.2 * smoothstep(1.4, 0.8, q); }
    s -= 0.45;
    const e = Math.min(x, (x < 900 ? H - y : 1e9), (x < 420 ? y : 1e9));
    if (e < 110) { const k = 1 - e / 110; s -= k * k * 1.3; }
    return s;
  }
  const ridgeSegs = [];
  D.RIDGES.forEach((r, ri) => {
    for (let i = 0; i < r.pts.length - 1; i++) ridgeSegs.push({ ri, type: r.type, w: r.w, h: r.h, a: r.pts[i], b: r.pts[i + 1] });
  });
  function ridgeAt(x, y) {
    // returns [spine, barrier]
    let sp = 0, ba = 0;
    const wx = x + 14 * N2(x / 60, y / 60), wy = y + 14 * N2(x / 60 + 9, y / 60 + 3);
    for (const s of ridgeSegs) {
      const d2 = segDist2(wx, wy, s.a[0], s.a[1], s.b[0], s.b[1]);
      const w = s.w * (0.8 + 0.45 * (N1(x / 140 + s.ri, y / 140) * 0.5 + 0.5));
      if (d2 > 9 * w * w) continue;
      const v = s.h * Math.exp(-d2 / (w * w));
      if (s.type === 'spine') { if (v > sp) sp = v; } else if (v > ba) ba = v;
    }
    return [sp, ba];
  }
  function forestAt(x, y) {
    let best = 0, kind = null;
    for (const f of D.FORESTS) {
      const dx = (x - f[0]) / f[2], dy = (y - f[1]) / f[3];
      const r = Math.sqrt(dx * dx + dy * dy) + 0.22 * N2(x / 50, y / 50);
      const v = f[4] * smoothstep(1.0, 0.45, r);
      if (v > best) { best = v; kind = f[5]; }
    }
    return [best, kind];
  }

  /* ---------------- heap ---------------- */
  class Heap {
    constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
    push(k, v) {
      if (this.n >= this.k.length) {
        const nk = new Float64Array(this.k.length * 2); nk.set(this.k); this.k = nk;
        const nv = new Int32Array(this.v.length * 2); nv.set(this.v); this.v = nv;
      }
      let i = this.n++; const K = this.k, V = this.v;
      while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
      K[i] = k; V[i] = v;
    }
    pop() {
      const K = this.k, V = this.v; const rk = K[0], rv = V[0];
      const n = --this.n; const lk = K[n], lv = V[n];
      let i = 0;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= lk) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = lk; V[i] = lv; this.lastKey = rk; return rv;
    }
  }

  /* ---------------- main generation ---------------- */
  async function generate(progress) {
    const N = GW * GH;
    const L = new Float32Array(N), SP = new Float32Array(N), BA = new Float32Array(N), FO = new Float32Array(N);
    const lab = new Int16Array(N).fill(-1);
    progress(0.02, 'Raising the mountains…');
    for (let gy = 0; gy < GH; gy++) {
      const y = (gy + 0.5) * CELL;
      for (let gx = 0; gx < GW; gx++) {
        const x = (gx + 0.5) * CELL, i = gy * GW + gx;
        L[i] = landField(x, y);
        const r = ridgeAt(x, y); SP[i] = r[0]; BA[i] = r[1];
        FO[i] = forestAt(x, y)[0];
      }
      if (gy % 40 === 0) { progress(0.02 + 0.25 * gy / GH, 'Raising the mountains…'); await tick(); }
    }
    // border ring forced sea
    for (let gx = 0; gx < GW; gx++) { L[gx] = -1; L[(GH - 1) * GW + gx] = -1; }
    for (let gy = 0; gy < GH; gy++) { L[gy * GW] = -1; L[gy * GW + GW - 1] = -1; }

    // rivers: smooth + meander, rasterize
    progress(0.3, 'Tracing the rivers…'); await tick();
    const rivers = D.RIVERS.map((r, ri) => {
      const base = catmull(r.pts, 6);
      const pts = base.map((p, i) => {
        const a = base[Math.max(0, i - 1)], b = base[Math.min(base.length - 1, i + 1)];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const nl = Math.hypot(nx, ny) || 1;
        const m = 9 * fbm(N3, p[0] / 70 + ri * 7, p[1] / 70, 3);
        return [p[0] + nx / nl * m, p[1] + ny / nl * m];
      });
      return { w: r.w, pts };
    });
    const RIV = new Uint8Array(N);
    for (const r of rivers) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.ceil(len / (CELL * 0.5));
        for (let k = 0; k <= n; k++) {
          const x = a[0] + (b[0] - a[0]) * k / n, y = a[1] + (b[1] - a[1]) * k / n;
          const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const X = gx + ox, Y = gy + oy; if (X >= 0 && Y >= 0 && X < GW && Y < GH) RIV[Y * GW + X] = 1;
          }
        }
      }
    }

    // geodesic growth (multi-source Dijkstra)
    progress(0.34, 'Dividing the realms…'); await tick();
    const COST = new Float32Array(N);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx; if (L[i] <= 0) { COST[i] = -1; continue; }
      const x = gx * CELL, y = gy * CELL;
      let c = 0.7 + 0.6 * (fbm(N3, x / 95, y / 95, 2) * 0.5 + 0.5);
      const sp = SP[i], band = sp > 0.08 ? 4 * sp * (1 - Math.min(sp, 1)) : 0;
      c *= 1 + 8 * BA[i] + 4.5 * band;
      COST[i] = RIV[i] ? -2 : c; // rivers are hard borders
    }
    const dist = new Float32Array(N).fill(Infinity);
    const heap = new Heap(1 << 20);
    TERR.forEach((t, ti) => {
      let gx = Math.floor(t.sx / CELL), gy = Math.floor(t.sy / CELL), found = -1;
      for (let r = 0; r < 40 && found < 0; r++) for (let oy = -r; oy <= r && found < 0; oy++) for (let ox = -r; ox <= r; ox++) {
        const X = gx + ox, Y = gy + oy; if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue;
        const i = Y * GW + X; if (COST[i] > 0 && lab[i] < 0) { found = i; break; }
      }
      if (found < 0) { console.warn('seed in sea', t.name); return; }
      dist[found] = 0; lab[found] = ti; heap.push(0, found);
    });
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [-1, 1, 1.4142], [1, -1, 1.4142], [-1, -1, 1.4142]];
    let popped = 0;
    while (heap.n) {
      const i = heap.pop(), k = heap.lastKey;
      if (k > dist[i]) continue;
      const gx = i % GW, gy = (i / GW) | 0, li = lab[i], ci = COST[i];
      for (const [ox, oy, f] of NB) {
        const X = gx + ox, Y = gy + oy; if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue;
        const j = Y * GW + X; const cj = COST[j]; if (cj < 0) continue;
        const nd = k + (ci + cj) * 0.5 * f;
        if (nd < dist[j]) { dist[j] = nd; lab[j] = li; heap.push(nd, j); }
      }
      if ((++popped & 0x1ffff) === 0) { progress(0.34 + 0.12 * Math.min(1, popped / (N * 0.6)), 'Dividing the realms…'); await tick(); }
    }
    // each river cell goes to the bank that reaches it first, so borders run mid-stream
    {
      let pending = []; for (let i = 0; i < N; i++) if (COST[i] === -2) pending.push(i);
      for (let guard = 0; guard < 80 && pending.length; guard++) {
        const next = [], give = [];
        for (const i of pending) {
          const gx = i % GW, gy = (i / GW) | 0; let l = -1;
          if (gx > 0 && lab[i - 1] >= 0) l = lab[i - 1]; else if (gx < GW - 1 && lab[i + 1] >= 0) l = lab[i + 1];
          else if (gy > 0 && lab[i - GW] >= 0) l = lab[i - GW]; else if (gy < GH - 1 && lab[i + GW] >= 0) l = lab[i + GW];
          if (l >= 0) give.push(i, l); else next.push(i);
        }
        if (!give.length) break;
        for (let k = 0; k < give.length; k += 2) { lab[give[k]] = give[k + 1]; COST[give[k]] = 1; }
        pending = next;
      }
      for (const i of pending) COST[i] = 1;
    }
    // unreachable land: sizeable isles join the nearest territory, specks sink
    {
      const seen = new Uint8Array(N); const q = new Int32Array(N);
      for (let s0 = 0; s0 < N; s0++) {
        if (!(COST[s0] > 0 && lab[s0] < 0) || seen[s0]) continue;
        let qh = 0, qt = 0; q[qt++] = s0; seen[s0] = 1; const cells = [];
        while (qh < qt) { const i = q[qh++]; cells.push(i); const gx = i % GW, gy = (i / GW) | 0;
          for (const j of [gx > 0 ? i - 1 : -1, gx < GW - 1 ? i + 1 : -1, gy > 0 ? i - GW : -1, gy < GH - 1 ? i + GW : -1]) if (j >= 0 && !seen[j] && COST[j] > 0 && lab[j] < 0) { seen[j] = 1; q[qt++] = j; } }
        if (cells.length < 30) { for (const i of cells) COST[i] = -1; continue; }
        let cx = 0, cy = 0; for (const i of cells) { cx += i % GW; cy += (i / GW) | 0; } cx = Math.round(cx / cells.length); cy = Math.round(cy / cells.length);
        let best = -1;
        for (let r = 1; r < 140 && best < 0; r++) for (let a = 0; a < 64; a++) { const X = Math.round(cx + Math.cos(a / 64 * 6.283) * r), Y = Math.round(cy + Math.sin(a / 64 * 6.283) * r); if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue; const l = lab[Y * GW + X]; if (l >= 0) { best = l; break; } }
        if (best < 0) { for (const i of cells) COST[i] = -1; continue; }
        for (const i of cells) lab[i] = best;
      }
    }

    // fill small enclosed seas (lakes) — keep large ones
    progress(0.47, 'Charting the coasts…'); await tick();
    {
      const comp = new Int32Array(N).fill(-1); let cid = 0; const q = new Int32Array(N);
      for (let s = 0; s < N; s++) {
        if (lab[s] >= 0 || comp[s] >= 0) continue;
        let qh = 0, qt = 0; q[qt++] = s; comp[s] = cid; let touches = false; const cells = [];
        while (qh < qt) {
          const i = q[qh++]; cells.push(i); const gx = i % GW, gy = (i / GW) | 0;
          if (gx === 0 || gy === 0 || gx === GW - 1 || gy === GH - 1) touches = true;
          const nb = [gx > 0 ? i - 1 : -1, gx < GW - 1 ? i + 1 : -1, gy > 0 ? i - GW : -1, gy < GH - 1 ? i + GW : -1];
          for (const j of nb) if (j >= 0 && lab[j] < 0 && comp[j] < 0) { comp[j] = cid; q[qt++] = j; }
        }
        const isLake = cells.some(i => { const x = (i % GW + .5) * CELL, y = ((i / GW | 0) + .5) * CELL; return D.LAKES.some(lk => Math.hypot(x - lk[0], y - lk[1]) < Math.min(lk[2], lk[3]) * 0.7); });
        if (!touches && !isLake && cells.length < 500) {
          // flood-fill from neighbours
          let pending = cells.slice(), guard = 0;
          while (pending.length && guard++ < 200) {
            const next = [];
            for (const i of pending) {
              const gx = i % GW, gy = (i / GW) | 0; let l = -1;
              if (gx > 0 && lab[i - 1] >= 0) l = lab[i - 1]; else if (gx < GW - 1 && lab[i + 1] >= 0) l = lab[i + 1];
              else if (gy > 0 && lab[i - GW] >= 0) l = lab[i - GW]; else if (gy < GH - 1 && lab[i + GW] >= 0) l = lab[i + GW];
              if (l >= 0) lab[i] = l; else next.push(i);
            }
            if (next.length === pending.length) break;
            pending = next;
          }
        }
        cid++;
      }
    }
    // remove isolated single-cell spurs (cells with <=1 same-label 4-neighbour)
    for (let pass = 0; pass < 2; pass++) for (let gy = 1; gy < GH - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) {
      const i = gy * GW + gx, l = lab[i];
      const n4 = [lab[i - 1], lab[i + 1], lab[i - GW], lab[i + GW]];
      let same = 0; for (const v of n4) if (v === l) same++;
      if (same <= 1) {
        const cnt = {}; let best = l, bc = 0;
        for (const v of n4) { if (v === -2) continue; cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > bc) { bc = cnt[v]; best = v; } }
        lab[i] = best;
      }
    }

    for (let gx = 0; gx < GW; gx++) { lab[gx] = -2; lab[(GH - 1) * GW + gx] = -2; }
    for (let gy = 0; gy < GH; gy++) { lab[gy * GW] = -2; lab[gy * GW + GW - 1] = -2; }

    // adjacency
    progress(0.5, 'Surveying the borders…'); await tick();
    const contact = new Map();
    const addC = (a, b) => { if (a < 0 || b < 0 || a === b) return; const k = a < b ? a * 64 + b : b * 64 + a; contact.set(k, (contact.get(k) || 0) + 1); };
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx;
      if (gx < GW - 1) addC(lab[i], lab[i + 1]);
      if (gy < GH - 1) addC(lab[i], lab[i + GW]);
    }
    const adj = TERR.map(() => new Set());
    for (const [k, c] of contact) if (c >= 4) { const a = (k / 64) | 0, b = k % 64; adj[a].add(b); adj[b].add(a); }
    for (const [a, b] of D.SEA_LINKS) { adj[a].add(b); adj[b].add(a); }

    // distance transforms: sea distance to land; land distance to territory edge
    progress(0.53, 'Surveying the borders…'); await tick();
    const seaD = chamfer(N, i => lab[i] >= 0);
    const edgeD = chamfer(N, i => {
      const l = lab[i]; if (l < 0) return true;
      const gx = i % GW, gy = (i / GW) | 0;
      return (gx > 0 && lab[i - 1] !== l) || (gx < GW - 1 && lab[i + 1] !== l) || (gy > 0 && lab[i - GW] !== l) || (gy < GH - 1 && lab[i + GW] !== l);
    });

    // label points: max inscribed distance, biased toward seed
    const labelPt = TERR.map(() => ({ x: 0, y: 0, s: -1e9 }));
    const area = new Int32Array(NT); const cen = TERR.map(() => [0, 0]);
    for (let i = 0; i < N; i++) {
      const l = lab[i]; if (l < 0) continue;
      const gx = i % GW, gy = (i / GW) | 0; const x = (gx + .5) * CELL, y = (gy + .5) * CELL;
      area[l]++; cen[l][0] += x; cen[l][1] += y;
      const t = TERR[l];
      const sc = Math.min(edgeD[i], 26) * 1.0 - Math.hypot(x - t.sx, y - t.sy) * 0.012 - SP[i] * 6 - BA[i] * 8;
      if (sc > labelPt[l].s) labelPt[l] = { x, y, s: sc };
    }
    TERR.forEach((t, i) => {
      t.lx = labelPt[i].x; t.ly = labelPt[i].y; t.area = area[i];
      t.cx = area[i] ? cen[i][0] / area[i] : t.sx; t.cy = area[i] ? cen[i][1] / area[i] : t.sy;
      t.adj = [...adj[i]].sort((a, b) => a - b);
    });

    // planar borders
    progress(0.56, 'Inking the borders…'); await tick();
    const borders = extractBorders(lab);

    return { CELL, GW, GH, L, SP, BA, FO, RIV, lab, seaD, edgeD, rivers, borders, adj };
  }

  function chamfer(N, isSource) {
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) d[i] = isSource(i) ? 0 : 1e6;
    const a = 1, b = 1.4142;
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx; let v = d[i];
      if (gx > 0) v = Math.min(v, d[i - 1] + a);
      if (gy > 0) { v = Math.min(v, d[i - GW] + a); if (gx > 0) v = Math.min(v, d[i - GW - 1] + b); if (gx < GW - 1) v = Math.min(v, d[i - GW + 1] + b); }
      d[i] = v;
    }
    for (let gy = GH - 1; gy >= 0; gy--) for (let gx = GW - 1; gx >= 0; gx--) {
      const i = gy * GW + gx; let v = d[i];
      if (gx < GW - 1) v = Math.min(v, d[i + 1] + a);
      if (gy < GH - 1) { v = Math.min(v, d[i + GW] + a); if (gx < GW - 1) v = Math.min(v, d[i + GW + 1] + b); if (gx > 0) v = Math.min(v, d[i + GW - 1] + b); }
      d[i] = v;
    }
    return d;
  }

  /* ---------------- planar border extraction ---------------- */
  function extractBorders(lab) {
    const CW = GW + 1;
    const segA = [], segB = [], segL = [], segR = [];
    for (let gy = 1; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const up = lab[(gy - 1) * GW + gx], dn = lab[gy * GW + gx];
      if (up !== dn) { segA.push(gy * CW + gx); segB.push(gy * CW + gx + 1); segL.push(up); segR.push(dn); }
    }
    for (let gy = 0; gy < GH; gy++) for (let gx = 1; gx < GW; gx++) {
      const lf = lab[gy * GW + gx - 1], rt = lab[gy * GW + gx];
      if (lf !== rt) { segA.push(gy * CW + gx); segB.push((gy + 1) * CW + gx); segL.push(lf); segR.push(rt); }
    }
    const NS = segA.length;
    const NC = CW * (GH + 1);
    const deg = new Uint8Array(NC), cs = new Int32Array(NC * 4);
    for (let s = 0; s < NS; s++) {
      const a = segA[s], b = segB[s];
      cs[a * 4 + deg[a]++] = s; cs[b * 4 + deg[b]++] = s;
    }
    const vis = new Uint8Array(NS);
    const polys = [];
    function walk(c0, s0) {
      const pts = [c0]; let c = c0, s = s0;
      while (true) {
        vis[s] = 1;
        const nx = segA[s] === c ? segB[s] : segA[s];
        pts.push(nx);
        if (nx === c0 || deg[nx] !== 2) break;
        const o0 = cs[nx * 4], o1 = cs[nx * 4 + 1];
        const ns = o0 === s ? o1 : o0;
        if (vis[ns]) break;
        c = nx; s = ns;
      }
      return pts;
    }
    for (let c = 0; c < NC; c++) {
      if (deg[c] === 0 || deg[c] === 2) continue;
      for (let k = 0; k < deg[c]; k++) { const s = cs[c * 4 + k]; if (!vis[s]) polys.push({ c: walk(c, s), l: segL[s], r: segR[s] }); }
    }
    for (let s = 0; s < NS; s++) if (!vis[s]) polys.push({ c: walk(segA[s], s), l: segL[s], r: segR[s] });

    // geometry
    const lines = polys.map(p => {
      let pts = p.c.map(c => [(c % CW) * CELL, ((c / CW) | 0) * CELL]);
      const closed = p.c[0] === p.c[p.c.length - 1];
      const coast = (p.l === -1 || p.r === -1) && p.l !== -2 && p.r !== -2;
      const frame = p.l === -2 || p.r === -2;
      const eps = CELL * 0.95;
      if (closed && pts.length > 4) {
        const m = pts.length >> 1;
        const h1 = rdp(pts.slice(0, m + 1), eps), h2 = rdp(pts.slice(m), eps);
        pts = h1.concat(h2.slice(1));
      } else pts = rdp(pts, eps);
      if (pts.length >= 3 || closed) pts = chaikin(pts, 2, closed);
      if (!frame) pts = wobble(pts, coast ? 3.2 : 1.3, coast ? 26 : 40, closed);
      return { pts, a: p.c[0], b: p.c[p.c.length - 1], closed, l: p.l, r: p.r, coast, frame };
    });

    function buildLoops(idxs) {
      const byC = new Map();
      for (const i of idxs) {
        const ln = lines[i]; if (ln.closed) continue;
        (byC.get(ln.a) || byC.set(ln.a, []).get(ln.a)).push(i);
        (byC.get(ln.b) || byC.set(ln.b, []).get(ln.b)).push(i);
      }
      const used = new Set(); const path = new Path2D(); const loops = [];
      for (const i of idxs) {
        if (used.has(i)) continue; used.add(i);
        const ln = lines[i];
        const loop = ln.pts.slice();
        if (!ln.closed) {
          const start = ln.a; let cur = ln.b; let guard = 0;
          while (cur !== start && guard++ < 5000) {
            const cand = (byC.get(cur) || []).filter(j => !used.has(j));
            if (!cand.length) break;
            const j = cand[0]; used.add(j); const q = lines[j];
            const fwd = q.a === cur;
            const qp = fwd ? q.pts : q.pts.slice().reverse();
            for (let k = 1; k < qp.length; k++) loop.push(qp[k]);
            cur = fwd ? q.b : q.a;
          }
        }
        loops.push(loop);
        path.moveTo(loop[0][0], loop[0][1]);
        for (let k = 1; k < loop.length; k++) path.lineTo(loop[k][0], loop[k][1]);
        path.closePath();
      }
      return { path, loops };
    }

    const terrPaths = TERR.map((t, ti) => {
      const idx = []; lines.forEach((ln, i) => { if (ln.l === ti || ln.r === ti) idx.push(i); });
      return buildLoops(idx);
    });
    const coastIdx = []; lines.forEach((ln, i) => { if ((ln.l < 0) !== (ln.r < 0)) coastIdx.push(i); });
    const land = buildLoops(coastIdx);
    const regionBorder = new Path2D(), terrBorder = new Path2D(), coastLine = new Path2D();
    for (const ln of lines) {
      if (ln.frame || (ln.l < 0 && ln.r < 0)) continue;
      const P = ln.coast ? coastLine : (TERR[ln.l].region !== TERR[ln.r].region ? regionBorder : terrBorder);
      P.moveTo(ln.pts[0][0], ln.pts[0][1]);
      for (let k = 1; k < ln.pts.length; k++) P.lineTo(ln.pts[k][0], ln.pts[k][1]);
    }
    // per-territory border lines (for highlight strokes)
    return { lines, terrPaths, land, regionBorder, terrBorder, coastLine };
  }

  /* ---------------- sampling helpers ---------------- */
  function makeSampler(world) {
    const { lab, SP, BA, FO, L, RIV, seaD } = world;
    const idx = (x, y) => { const gx = clamp(Math.floor(x / CELL), 0, GW - 1), gy = clamp(Math.floor(y / CELL), 0, GH - 1); return gy * GW + gx; };
    function bil(A, x, y) {
      const fx = x / CELL - 0.5, fy = y / CELL - 0.5;
      const x0 = clamp(Math.floor(fx), 0, GW - 2), y0 = clamp(Math.floor(fy), 0, GH - 2);
      const tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1); const i = y0 * GW + x0;
      return (A[i] * (1 - tx) + A[i + 1] * tx) * (1 - ty) + (A[i + GW] * (1 - tx) + A[i + GW + 1] * tx) * ty;
    }
    return {
      lab: (x, y) => lab[idx(x, y)],
      sp: (x, y) => bil(SP, x, y), ba: (x, y) => bil(BA, x, y), fo: (x, y) => bil(FO, x, y),
      land: (x, y) => bil(L, x, y), riv: (x, y) => RIV[idx(x, y)], seaD: (x, y) => bil(seaD, x, y), bil, idx,
    };
  }

  function paperTexture(size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); const id = x.createImageData(size, size); const d = id.data;
    const n = NZ.makeSimplex(77);
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      // tileable-ish noise via torus mapping
      const a = px / size * Math.PI * 2, b = py / size * Math.PI * 2;
      const v = 0.6 * n(Math.cos(a) * 3, Math.sin(a) * 3 + Math.cos(b) * 3) + 0.4 * n(Math.sin(b) * 9 + Math.cos(a) * 9, Math.sin(a) * 9);
      const g = 128 + v * 22 + (hash2(px, py) - 0.5) * 26;
      d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    // fibres
    const rnd = NZ.mulberry32(5);
    x.globalAlpha = 0.12; x.strokeStyle = '#000'; x.lineWidth = 0.6;
    for (let k = 0; k < 120; k++) { const sx = rnd() * size, sy = rnd() * size, a = rnd() * 6.28, l = 6 + rnd() * 18; x.beginPath(); x.moveTo(sx, sy); x.quadraticCurveTo(sx + Math.cos(a) * l * 0.5 + 3, sy + Math.sin(a) * l * 0.5, sx + Math.cos(a) * l, sy + Math.sin(a) * l); x.stroke(); }
    x.globalAlpha = 1;
    return c;
  }

  G.MAPGEN = { generate, makeSampler, CELL, GW, GH, paperTexture, catmull, forestAt, ridgeAt };
})(window);
