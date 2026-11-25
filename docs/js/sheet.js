/* Sheet: what lies around the user's map. The western sea carries on past the edge of the
   drawing (so a wide screen is filled with chart, not with empty margin), an atlas border
   frames the print, and the paper rests on the walnut war table. Nothing here touches the
   artwork: it is all drawn around it, in the same flat ink. */
(function (G) {
  const D = G.DATA, W = D.W, H = D.H;
  const SEA = '#899080', INK = '#27241b', PAPER = '#d9cfad', TAN = '#c3bd97';
  const UNCIAL = '"Uncial Antiqua", "IM Fell English", Georgia, serif', FELL = '"IM Fell English", Georgia, serif';
  const BAND = 15, GAP = 9, MARGIN = 74, TABLE = 44;
  const TAU = Math.PI * 2;
  const S = { on: !!D.MAP_IMAGE, A: 0, decor: false, BAND, MARGIN, TABLE, rose: null };
  let wood = null, woodPat = null, rules = null, keysDark = null, paper = null, ticks = null, rose = null, rhumb = null, built = -1;

  function loadWood() {
    const img = new Image();
    img.onload = () => {
      // mirrored 2x2 so the planks tile without a seam
      const n = 512, c = document.createElement('canvas'); c.width = c.height = n * 2; const x = c.getContext('2d');
      for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { x.save(); x.translate(fx ? n * 2 : 0, fy ? n * 2 : 0); x.scale(fx ? -1 : 1, fy ? -1 : 1); x.drawImage(img, 0, 0, n, n); x.restore(); }
      wood = c; woodPat = null; if (G.BOARD) G.BOARD.dirty = true;
    };
    img.src = 'assets/painted-walnut.png';
  }

  /* everything that depends on how far the sea runs west */
  function layout(A) {
    A = Math.max(0, Math.round(A)); if (A === built) return; built = A; S.A = A; S.decor = A >= 430;
    const rnd = G.NZ.mulberry32(7331);
    const x0 = -A, x1 = W, y0 = 0, y1 = H;
    S.print = { x0, y0, x1, y1 };
    S.paper = { x0: x0 - MARGIN, y0: y0 - MARGIN, x1: x1 + MARGIN, y1: y1 + MARGIN };
    S.bounds = { x0: S.paper.x0 - TABLE, y0: S.paper.y0 - TABLE, x1: S.paper.x1 + TABLE, y1: S.paper.y1 + TABLE };

    // the three rules of the border
    rules = [new Path2D(), new Path2D(), new Path2D()];
    rules[0].rect(x0, y0, x1 - x0, y1 - y0);
    rules[1].rect(x0 - BAND, y0 - BAND, x1 - x0 + BAND * 2, y1 - y0 + BAND * 2);
    rules[2].rect(x0 - BAND - GAP, y0 - BAND - GAP, x1 - x0 + (BAND + GAP) * 2, y1 - y0 + (BAND + GAP) * 2);
    // the alternating "piano key" scale that runs round an atlas plate
    keysDark = new Path2D(); const step = 100;
    for (let x = Math.floor(x0 / step) * step, k = 0; x < x1; x += step, k++) {
      const a = Math.max(x, x0), b = Math.min(x + step, x1); if (b <= a) continue;
      if ((Math.round(x / step) & 1) === 0) { keysDark.rect(a, y0 - BAND, b - a, BAND); } else { keysDark.rect(a, y1, b - a, BAND); }
    }
    for (let y = 0; y < y1; y += step) {
      const b = Math.min(y + step, y1);
      if ((Math.round(y / step) & 1) === 0) keysDark.rect(x1, y, BAND, b - y); else keysDark.rect(x0 - BAND, y, BAND, b - y);
    }
    // the paper, cut by hand
    paper = new Path2D(); const P = S.paper, pts = [];
    const edge = (ax, ay, bx, by) => { const n = Math.max(4, Math.round(Math.hypot(bx - ax, by - ay) / 70)); for (let i = 0; i < n; i++) { const k = i / n; pts.push([ax + (bx - ax) * k + (rnd() - 0.5) * 5, ay + (by - ay) * k + (rnd() - 0.5) * 5]); } };
    edge(P.x0, P.y0, P.x1, P.y0); edge(P.x1, P.y0, P.x1, P.y1); edge(P.x1, P.y1, P.x0, P.y1); edge(P.x0, P.y1, P.x0, P.y0);
    pts.forEach((p, i) => i ? paper.lineTo(p[0], p[1]) : paper.moveTo(p[0], p[1])); paper.closePath();

    ticks = null; rose = null; rhumb = null; S.rose = null;
    if (!S.decor) return;
    const cx = -A / 2;
    S.title = { x: cx, y: H * 0.108, w: Math.min(A * 0.8, 780) };
    S.name = { x: cx, y: H * 0.335, fs: Math.min(A * 0.118, 148), w: A * 0.7 };
    S.rose = { x: cx, y: H * 0.585, r: Math.min(A * 0.3, 285) };
    S.scale = { x: cx, y: H * 0.945, w: Math.min(A * 0.52, 500) };
    // rhumb lines from the rose, as on a portolan chart
    rhumb = new Path2D();
    for (let i = 0; i < 32; i++) { const a = i / 32 * TAU, far = A + H; rhumb.moveTo(S.rose.x + Math.cos(a) * S.rose.r * 1.02, S.rose.y + Math.sin(a) * S.rose.r * 1.02); rhumb.lineTo(S.rose.x + Math.cos(a) * far, S.rose.y + Math.sin(a) * far); }
    // the rose itself: dark and light halves of each point
    const R = S.rose.r, dark = new Path2D(), light = new Path2D(), ring = new Path2D();
    const point = (ang, len, wid) => {
      const ca = Math.cos(ang), sa = Math.sin(ang), tx = ca * len, ty = sa * len, px = -sa * wid, py = ca * wid, bx = ca * wid * 0.9, by = sa * wid * 0.9;
      dark.moveTo(0, 0); dark.lineTo(tx, ty); dark.lineTo(bx + px, by + py); dark.closePath();
      light.moveTo(0, 0); light.lineTo(tx, ty); light.lineTo(bx - px, by - py); light.closePath();
    };
    for (let i = 0; i < 16; i++) if (i % 2) point(i / 16 * TAU - Math.PI / 2, R * 0.46, R * 0.055);
    for (let i = 0; i < 8; i++) if (i % 2) point(i / 8 * TAU - Math.PI / 2, R * 0.66, R * 0.085);
    for (let i = 0; i < 4; i++) point(i / 4 * TAU - Math.PI / 2, R * 0.93, R * 0.115);
    for (let i = 0; i < 64; i++) { const a = i / 64 * TAU, r0 = R * (i % 4 === 0 ? 0.9 : 0.94); ring.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ring.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
    ring.moveTo(R, 0); ring.arc(0, 0, R, 0, TAU); ring.moveTo(R * 0.94, 0); ring.arc(0, 0, R * 0.94, 0, TAU); ring.moveTo(R * 0.5, 0); ring.arc(0, 0, R * 0.5, 0, TAU);
    rose = { dark, light, ring };
    // little pen strokes of swell, thinning out towards the drawing so the join never shows
    ticks = new Path2D(); const keep = [[S.rose.x, S.rose.y, S.rose.r * 1.15], [S.title.x, S.title.y, S.title.w * 0.6], [S.name.x, S.name.y, S.name.w * 0.6], [S.scale.x, S.scale.y, S.scale.w * 0.7]];
    const n = Math.round(A * H / 30000);
    for (let i = 0; i < n; i++) {
      const x = -rnd() * A, y = 30 + rnd() * (H - 60); if (rnd() > Math.min(1, -x / 520)) continue;
      if (x < -A + 26 || keep.some(k => Math.hypot(x - k[0], (y - k[1]) * 1.5) < k[2])) continue;
      const w = 7 + rnd() * 7, h = 3 + rnd() * 2.5, m = 1 + (rnd() < 0.45 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0);
      for (let j = 0; j < m; j++) { const ox = x + j * w * 1.7 - (m - 1) * w * 0.85, oy = y + (j % 2) * 2; ticks.moveTo(ox - w, oy); ticks.quadraticCurveTo(ox - w / 2, oy - h, ox, oy); ticks.quadraticCurveTo(ox + w / 2, oy - h, ox + w, oy); }
    }
  }

  /* under the map: table, paper, and the sea that continues the drawing */
  function drawBase(ctx, v, z, dpr) {
    const P = S.paper, covered = v.x0 >= P.x0 + 8 && v.x1 <= P.x1 - 8 && v.y0 >= P.y0 + 8 && v.y1 <= P.y1 - 8;
    if (!covered) {
      ctx.save();
      if (wood) { if (!woodPat) woodPat = ctx.createPattern(wood, 'repeat'); const k = 1.9; ctx.scale(k, k); ctx.fillStyle = woodPat; ctx.fillRect(v.x0 / k - 1, v.y0 / k - 1, (v.x1 - v.x0) / k + 2, (v.y1 - v.y0) / k + 2); ctx.scale(1 / k, 1 / k); ctx.fillStyle = 'rgba(14,8,3,0.42)'; }
      else ctx.fillStyle = '#24180d';
      ctx.fillRect(v.x0 - 1, v.y0 - 1, v.x1 - v.x0 + 2, v.y1 - v.y0 + 2);
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 44 * z * dpr; ctx.shadowOffsetX = 8 * z * dpr; ctx.shadowOffsetY = 16 * z * dpr;
      ctx.fillStyle = PAPER; ctx.fill(paper); ctx.restore();
    }
    ctx.fillStyle = PAPER; ctx.fill(paper);
    ctx.save(); ctx.clip(paper); ctx.lineJoin = 'round';
    for (const [w, a] of [[58, 0.07], [30, 0.09], [12, 0.14]]) { ctx.strokeStyle = `rgba(104,78,40,${a})`; ctx.lineWidth = w; ctx.stroke(paper); }
    ctx.restore();
    if (S.A <= 0) return;
    ctx.fillStyle = SEA; ctx.fillRect(-S.A, 0, S.A + 1.5, H);
    if (!S.decor) return;
    const A = S.A;
    ctx.save(); ctx.beginPath(); ctx.rect(-A, 0, A, H); ctx.clip(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // light of the West: the far edge of the chart dissolves into haze
    let g = ctx.createLinearGradient(-A, 0, -A + Math.min(520, A * 0.4), 0); g.addColorStop(0, 'rgba(204,211,194,0.62)'); g.addColorStop(1, 'rgba(204,211,194,0)');
    ctx.fillStyle = g; ctx.fillRect(-A, 0, Math.min(520, A * 0.4), H);
    // rhumb lines, fading out before they reach the drawing
    g = ctx.createLinearGradient(-A, 0, 0, 0); g.addColorStop(0, 'rgba(48,56,48,0.20)'); g.addColorStop(Math.max(0.01, 1 - 330 / A), 'rgba(48,56,48,0.17)'); g.addColorStop(Math.max(0.02, 1 - 60 / A), 'rgba(48,56,48,0)'); g.addColorStop(1, 'rgba(48,56,48,0)');
    ctx.strokeStyle = g; ctx.lineWidth = Math.max(0.8, 0.8 / z); ctx.stroke(rhumb);
    ctx.strokeStyle = 'rgba(39,44,36,0.34)'; ctx.lineWidth = 1.25; ctx.stroke(ticks);
    drawName(ctx); drawRose(ctx); drawTitle(ctx); drawScale(ctx);
    ctx.restore();
  }

  function spaced(ctx, text, x, y, width) {
    // letter by letter, so the name can be stretched across the water like the region names on the map
    const ws = [...text].map(ch => ctx.measureText(ch).width), total = ws.reduce((a, b) => a + b, 0), gap = Math.max(0, (width - total) / (text.length - 1));
    let px = x - (total + gap * (text.length - 1)) / 2;
    [...text].forEach((ch, i) => { const k = (px + ws[i] / 2 - x) / (width / 2 || 1); ctx.save(); ctx.translate(px + ws[i] / 2, y + k * k * width * 0.045); ctx.rotate(k * 0.11); ctx.fillText(ch, 0, 0); ctx.restore(); px += ws[i] + gap; });
  }
  function drawName(ctx) {
    const N = S.name; ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(54,62,52,0.30)'; ctx.font = `${N.fs}px ${UNCIAL}`; spaced(ctx, 'BELEGAER', N.x, N.y, N.w);
    ctx.fillStyle = 'rgba(39,44,36,0.62)'; ctx.font = `italic ${N.fs * 0.3}px ${FELL}`; ctx.fillText('the Great Sea', N.x, N.y + N.fs * 1.02);
    ctx.restore();
  }
  function drawRose(ctx) {
    const R = S.rose; ctx.save(); ctx.translate(R.x, R.y);
    ctx.fillStyle = 'rgba(137,144,128,0.85)'; ctx.beginPath(); ctx.arc(0, 0, R.r * 0.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(39,36,27,0.72)'; ctx.lineWidth = 1.5; ctx.stroke(rose.ring);
    ctx.fillStyle = TAN; ctx.fill(rose.light); ctx.fillStyle = 'rgba(39,36,27,0.86)'; ctx.fill(rose.dark);
    ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(39,36,27,0.9)'; ctx.stroke(rose.light); ctx.stroke(rose.dark);
    ctx.fillStyle = TAN; ctx.beginPath(); ctx.arc(0, 0, R.r * 0.05, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(39,36,27,0.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${R.r * 0.2}px ${UNCIAL}`;
    ctx.fillText('N', 0, -R.r * 1.14); ctx.font = `${R.r * 0.13}px ${UNCIAL}`; ctx.fillStyle = 'rgba(39,36,27,0.7)';
    ctx.fillText('S', 0, R.r * 1.12); ctx.fillText('W', -R.r * 1.13, 0); ctx.fillText('E', R.r * 1.12, 0);
    ctx.restore();
  }
  function drawTitle(ctx) {
    const T = S.title, w = T.w, h = w * 0.37, x = T.x - w / 2, y = T.y - h / 2;
    ctx.save(); ctx.lineJoin = 'miter';
    // a plain engraved plate: tan panel, double rule, notched corners
    const plate = (inset) => { const n = w * 0.035, a = x + inset, b = y + inset, c = x + w - inset, d = y + h - inset; ctx.beginPath(); ctx.moveTo(a + n, b); ctx.lineTo(c - n, b); ctx.lineTo(c - n, b + n); ctx.lineTo(c, b + n); ctx.lineTo(c, d - n); ctx.lineTo(c - n, d - n); ctx.lineTo(c - n, d); ctx.lineTo(a + n, d); ctx.lineTo(a + n, d - n); ctx.lineTo(a, d - n); ctx.lineTo(a, b + n); ctx.lineTo(a + n, b + n); ctx.closePath(); };
    plate(0); ctx.fillStyle = 'rgba(195,189,151,0.94)'; ctx.fill(); ctx.strokeStyle = 'rgba(39,36,27,0.9)'; ctx.lineWidth = 3; ctx.stroke();
    plate(w * 0.018); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(39,36,27,0.92)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `italic ${w * 0.05}px ${FELL}`; ctx.fillText('The West of', T.x, y + h * 0.21);
    ctx.font = `${w * 0.108}px ${UNCIAL}`; ctx.fillText('Middle-earth', T.x, y + h * 0.5);
    ctx.font = `italic ${w * 0.046}px ${FELL}`; ctx.fillText('at the end of the Third Age', T.x, y + h * 0.8);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(39,36,27,0.55)'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(T.x + s * w * 0.12, y + h * 0.325); ctx.lineTo(T.x + s * w * 0.36, y + h * 0.325); ctx.stroke(); }
    ctx.restore();
  }
  function drawScale(ctx) {
    const C = S.scale, n = 4, seg = C.w / n, x = C.x - C.w / 2, y = C.y, h = Math.max(7, C.w * 0.022);
    ctx.save(); ctx.strokeStyle = 'rgba(39,36,27,0.85)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? TAN : 'rgba(39,36,27,0.85)'; ctx.fillRect(x + i * seg, y, seg, h); ctx.strokeRect(x + i * seg, y, seg, h); }
    ctx.fillStyle = 'rgba(39,36,27,0.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = `${Math.max(11, C.w * 0.038)}px ${UNCIAL}`;
    for (let i = 0; i <= n; i += 2) ctx.fillText(String(i * 50), x + i * seg, y - h * 0.7);
    ctx.textBaseline = 'top'; ctx.font = `italic ${Math.max(12, C.w * 0.044)}px ${FELL}`; ctx.fillText('Leagues', C.x, y + h * 1.6);
    ctx.restore();
  }

  /* over the map: the border that closes the print */
  function drawFrame(ctx) {
    const p = S.print; ctx.save(); ctx.lineJoin = 'miter';
    ctx.fillStyle = PAPER; ctx.beginPath(); ctx.rect(p.x0 - BAND, p.y0 - BAND, p.x1 - p.x0 + BAND * 2, p.y1 - p.y0 + BAND * 2); ctx.rect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0); ctx.fill('evenodd');
    ctx.fillStyle = 'rgba(39,36,27,0.88)'; ctx.fill(keysDark);
    ctx.fillStyle = PAPER; for (const [cx, cy] of [[p.x0 - BAND, p.y0 - BAND], [p.x1, p.y0 - BAND], [p.x0 - BAND, p.y1], [p.x1, p.y1]]) ctx.fillRect(cx, cy, BAND, BAND);
    ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.stroke(rules[0]); ctx.lineWidth = 2; ctx.stroke(rules[1]); ctx.lineWidth = 0.9; ctx.stroke(rules[2]);
    ctx.fillStyle = INK; for (const [cx, cy] of [[p.x0 - BAND / 2, p.y0 - BAND / 2], [p.x1 + BAND / 2, p.y0 - BAND / 2], [p.x0 - BAND / 2, p.y1 + BAND / 2], [p.x1 + BAND / 2, p.y1 + BAND / 2]]) { ctx.beginPath(); ctx.moveTo(cx, cy - 4.4); ctx.lineTo(cx + 4.4, cy); ctx.lineTo(cx, cy + 4.4); ctx.lineTo(cx - 4.4, cy); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }

  if (S.on) { loadWood(); layout(0); }
  Object.assign(S, { layout, drawBase, drawFrame, SEA, PAPER });
  G.SHEET = S;
})(window);
