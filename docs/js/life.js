/* Life: everything that moves on the user's map. Rivers run downstream, swell rolls onto
   the coasts, fleets and fishing boats keep to the water, birds cross the sky, and small
   folk, riders and caravans go about the open ground of each land. All of it is read from
   the drawing itself (js/user-map-life.js), so nothing ever walks over a mountain, a
   forest or a name. Drawn in world space, in the map's own flat ink. */
(function (G) {
  const D = G.DATA, W = D.W, H = D.H, TERR = D.TERR, L = G.USER_MAP_LIFE;
  if (!L) return;
  const INK = '#27241b', TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const smooth = (a, b, v) => { v = clamp((v - a) / (b - a), 0, 1); return v * v * (3 - 2 * v); };
  const ID = {}; TERR.forEach((t, i) => { ID[t.name] = i; });
  const LF = { ready: false };
  let rnd = G.NZ.mulberry32(4107), smp = null, A = 0;

  /* ---------- the water grid ---------- */
  const GR = L.grid, grid = new Uint8Array(GR.w * GR.h);
  { let i = 0; for (const tok of GR.rle.split(',')) { const n = parseInt(tok.slice(1), 36); grid.fill(+tok[0], i, i + n); i += n; } }
  // 0 open land, 1 sea, 2 lake, 3 river, 4 drawn-on land; west of the drawing the sea carries on
  const cls = (x, y) => y < 0 || y >= H || x >= W ? 0 : x < 0 ? (x > -A ? 1 : 0) : grid[((y / GR.cell) | 0) * GR.w + ((x / GR.cell) | 0)];
  const afloat = (x, y, r) => { const k = cls(x, y); if (k !== 1 && k !== 2) return false; if (!r) return true; for (let i = 0; i < 6; i++) { const q = cls(x + Math.cos(i * 1.047) * r, y + Math.sin(i * 1.047) * r); if (q !== 1 && q !== 2) return false; } return true; };

  /* ---------- tracks ---------- */
  function spline(pts, closed, step) {
    step = step || 8; const n = pts.length, p = [], get = i => closed ? pts[((i % n) + n) % n] : pts[clamp(i, 0, n - 1)];
    for (let i = 0, segs = closed ? n : n - 1; i < segs; i++) {
      const a = get(i - 1), b = get(i), c = get(i + 1), d = get(i + 2), m = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / step));
      for (let j = 0; j < m; j++) { const t = j / m, t2 = t * t, t3 = t2 * t; p.push([0.5 * (2 * b[0] + (c[0] - a[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (3 * b[0] - a[0] - 3 * c[0] + d[0]) * t3), 0.5 * (2 * b[1] + (c[1] - a[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (3 * b[1] - a[1] - 3 * c[1] + d[1]) * t3)]); }
    }
    p.push(closed ? p[0].slice() : pts[n - 1].slice());
    const cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    return { p, cum, len: cum[cum.length - 1], closed };
  }
  function at(tr, d) {
    d = tr.closed ? ((d % tr.len) + tr.len) % tr.len : clamp(d, 0, tr.len);
    let lo = 0, hi = tr.cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr.cum[m] <= d) lo = m; else hi = m; }
    const a = tr.p[lo], b = tr.p[hi], l = tr.cum[hi] - tr.cum[lo] || 1, k = (d - tr.cum[lo]) / l;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, (b[0] - a[0]) / l, (b[1] - a[1]) / l];
  }
  const ring = (cx, cy, rx, ry, n, rot) => Array.from({ length: n }, (_, i) => { const a = i / n * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry, c = Math.cos(rot || 0), s = Math.sin(rot || 0); return [cx + x * c - y * s, cy + x * s + y * c]; });
  // a sea route is only kept where it really is water; waypoints on land are dropped
  function seaTrack(pts, closed, room) { const ok = pts.filter(p => afloat(p[0], p[1], room == null ? 9 : room)); return ok.length >= (closed ? 3 : 2) ? spline(ok, closed) : null; }
  function smoothPath(pts, close) {
    const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) p.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    p.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); if (close) p.closePath(); return p;
  }

  /* ---------- state ---------- */
  let riverA, riverB, rings = [], glints = [], lanes = [], vessels = [], fleets = [], beasts = { serpent: null, whale: null, next: 9 },
    flocks = [], gulls = [], eagles = [], crebain = null, fell = null, clouds = [], puffs = [], cloudPat = null,
    groups = [], plumes = [], snow = [], embers = [], sand = [], leaves = [], wisps = [], eyes = [], flip = new Map();

  const PLACES = {
    hobbiton: [646, 866], bree: [764, 733], edoras: [1076, 2130], isengard: [1039, 1722], doom: [1737, 2249], eye: [1864, 2246],
    morgul: [1562, 2532], gateL: [1492, 2158], gateR: [1571, 2135], moria: [1172, 1076], lorien: [1282, 1370], rivendell: [1252, 846],
    argonath: [1465, 1640], guldur: [1600, 1158], camp: [1764, 1074], smaug: [1666, 444], umbar: [1105, 3006], carn: [1104, 228],
  };
  // the little huts the artist drew along the White Mountains, from Minas Tirith to Edoras
  const BEACONS = [[1185, 2241], [1168, 2225], [1145, 2202], [1128, 2217], [1107, 2208], [1076, 2191], [1056, 2174], [1020, 2154]];

  function init(world, sampler) {
    smp = sampler; rnd = G.NZ.mulberry32(4107);
    // rivers, in two weights
    riverA = new Path2D(); riverB = new Path2D();
    for (const r of L.rivers) (r.w >= 7.5 ? riverA : riverB).addPath(smoothPath(r.pts));
    rings = L.rings.map(lines => { const p = new Path2D(); for (const l of lines) p.addPath(smoothPath(l)); return p; });
    puffs = [3, 11, 19, 27].map(s => G.ATLAS.cloudPuffCanvas(s));
    buildLand(); LF.ready = true; setApron(0);
  }

  /* everything that lives on the water, rebuilt when the western sea changes width */
  function setApron(a) {
    a = Math.max(0, a || 0); if (a === A && vessels.length) return;      // nothing to rebuild
    A = a; const far = A > 380, rs = G.NZ.mulberry32(88);
    glints = [];
    for (let i = 0, tries = 0; i < 150 && tries < 6000; tries++) { const x = -A + rs() * (W + A), y = rs() * H, k = cls(x, y); if (k === 1 || k === 2 || (k === 3 && rs() < 0.5)) { glints.push({ x, y, ph: rs() * TAU, sp: 0.5 + rs() * 1.3, l: 2 + rs() * 3.5 }); i++; } }
    // the four printed sea lanes: merchantmen ply them there and back
    lanes = (D.SHIP_ROUTES || []).map(([pts]) => spline(pts.filter(p => cls(p[0], p[1]) === 1), false));
    vessels = [];
    lanes.forEach((tr, k) => { if (!tr || tr.len < 60) return; for (let j = 0; j < (k === 1 || k === 2 ? 2 : 1); j++) vessels.push({ tr, d: rs() * tr.len, v: 8 + rs() * 3, dir: j ? -1 : 1, mode: 'ply', kind: j ? 'gondor' : 'cog', size: 1, ph: rs() * 9, wait: 0 }); });
    const add = (pts, closed, o) => { const tr = seaTrack(pts, closed, o.room); if (!tr) return null; const s = Object.assign({ tr, d: rs() * tr.len, v: 9, dir: 1, mode: closed ? 'loop' : 'away', kind: 'cog', size: 1, ph: rs() * 9, wait: 0 }, o); vessels.push(s); return s; };
    // fishing boats on the lakes
    add(ring(1663, 587, 9, 34, 8), true, { kind: 'boat', v: 3.2, size: 0.62, room: 4 });
    add(ring(1946, 1296, 26, 84, 10), true, { kind: 'boat', v: 4, size: 0.72, room: 5 });
    add(ring(1950, 1330, 18, 40, 8, 0.4), true, { kind: 'boat', v: 3.4, size: 0.66, room: 5, dir: -1 });
    add(ring(1832, 2668, 44, 16, 8, -0.5), true, { kind: 'boat', v: 3, size: 0.66, room: 4, dark: true });
    add(ring(1200, 2790, 26, 60, 8), true, { kind: 'boat', v: 4.4, size: 0.7, room: 6 });
    add(ring(872, 168, 20, 12, 7), true, { kind: 'boat', v: 3, size: 0.6, room: 4 });
    // small craft on the great rivers, carried down with the current
    for (const [x, y] of [[1362, 1440], [1290, 2010], [700, 950], [470, 720], [1318, 2450], [1830, 800], [1010, 1262], [1400, 1000]]) {
      const r = L.rivers.find(r => r.pts.length > 4 && r.pts.some(p => Math.hypot(p[0] - x, p[1] - y) < 34)); if (!r) continue;
      const tr = spline(r.pts, false, 6); if (tr.len < 90) continue;
      vessels.push({ tr, d: rs() * tr.len, v: 5 + rs() * 2, dir: 1, mode: 'away', kind: 'boat', size: 0.7, ph: rs() * 9, wait: rs() * 20, river: true });
    }
    // the swan ships leave the Grey Havens for the West and do not come back
    const west = far ? [[-A * 0.38, 835], [-A * 0.72, 760], [-A + 60, 720]] : [[36, 905], [8, 900]];
    for (const k of [0, 1]) add([[392, 818], [318, 852], [228, 898], [128, 928], [52, 915]].concat(west), false, { kind: 'swan', v: 7.5, size: 1.08, wait: k * 46, d: 0, room: 5 });
    // a merchantman out on the open sea
    if (far) add([[-A * 0.2, 1340], [-A * 0.55, 1310], [-A * 0.86, 1420], [-A * 0.6, 1580], [-A * 0.25, 1540]], true, { kind: 'cog', v: 8.5, size: 1.12 });
    if (far) add([[-A * 0.15, 640], [-A * 0.5, 580], [-A * 0.85, 700], [-A * 0.6, 900], [-A * 0.25, 830]], true, { kind: 'cog', v: 7.5, size: 1.05, dir: -1 });
    // fleets: the Corsairs of Umbar raid north, the ships of Dol Amroth keep the bay
    fleets = [];
    const ax = far ? -Math.min(A * 0.5, 560) : 78;
    const fleet = (pts, o) => { const tr = seaTrack(pts, true, 12); if (tr) fleets.push(Object.assign({ tr, d: rs() * tr.len, ph: rs() * 9 }, o)); };
    fleet([[872, 3074], [650, 3108], [340, 3128], [ax, 2930], [ax - (far ? 60 : 0), 2700], [150, 2545], [400, 2885], [650, 2925], [812, 2950], [866, 3008]],
      { kind: 'corsair', v: 15, size: 1.1, form: [[0, 0], [30, 17], [30, -17], [60, 34], [60, -34]] });
    fleet([[884, 2792], [700, 2772], [470, 2752], [300, 2792], [300, 2840], [470, 2822], [700, 2828], [880, 2832]],
      { kind: 'gondor', v: 11, size: 1.04, form: [[0, 0], [28, 13], [56, 0]] });
    if (far) fleet([[-A * 0.25, 2330], [-A * 0.6, 2300], [-A * 0.86, 2480], [-A * 0.68, 2860], [-A * 0.3, 2700]], { kind: 'corsair', v: 13, size: 1.05, form: [[0, 0], [28, 15], [28, -15]] });
    beasts = { serpent: null, whale: null, next: 6, spots: (far ? [[-A * 0.36, 2480], [-A * 0.64, 2760], [-A * 0.42, 1470], [-A * 0.74, 880], [-A * 0.13, 2300]] : []).concat([[92, 1310], [140, 2340], [330, 2975], [60, 300]]) };
    // gulls over the havens
    gulls = [[300, 850], [890, 2775], [870, 3078], [1090, 2800], [860, 150], [660, 1620]].map(([x, y], i) => ({ x, y, n: 3 + (i % 2), ph: i * 1.7 }));
    if (far) gulls.push({ x: -A * 0.12, y: 1500, n: 4, ph: 2.2 });
    // clouds over the whole sheet
    const span = W + A, n = Math.round(span * H / 430000); clouds = [];
    for (let i = 0; i < n; i++) clouds.push({ x: -A - 300 + rs() * (span + 600), y: rs() * H, s: 1.5 + rs() * 1.5, v: 8 + rs() * 9, k: i % 4, a: 0.3 + rs() * 0.2 });
    flocks = []; for (let f = 0; f < 5; f++) flocks.push(newFlock(rs, true));
  }
  function newFlock(r, anywhere) {
    const ang = (r() - 0.5) * 0.8 + (r() < 0.5 ? Math.PI : 0), right = Math.cos(ang) > 0;
    return { x: anywhere ? -A + r() * (W + A) : (right ? -A - 120 : W + 120), y: 120 + r() * (H - 240), ang, v: 42 + r() * 18, n: 4 + ((r() * 5) | 0), ph: r() * 6 };
  }

  /* ---------- the land: folk, riders, herds, fires ---------- */
  function buildLand() {
    const open = (x, y, tid) => cls(x, y) === 0 && smp.lab(x, y) === tid;
    const clear = (x0, y0, x1, y1, tid) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 5); for (let i = 0; i <= n; i++) if (!open(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, tid)) return false; return true; };
    const box = TERR.map(t => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const poly of t.polygons) for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; });
    // every patch of open ground, land by land
    const ground = TERR.map(() => []);
    for (let gy = 0; gy < GR.h; gy++) for (let gx = 0; gx < GR.w; gx++) if (grid[gy * GR.w + gx] === 0) { const x = (gx + 0.5) * GR.cell, y = (gy + 0.5) * GR.cell, tid = smp.lab(x, y); if (tid >= 0) ground[tid].push([x, y]); }
    // a closed walk on open ground inside one land, away from where its troops stand
    function walk(tid, reach, least, near) {
      const T = TERR[tid]; let cells = ground[tid]; if (cells.length < 8) return null;
      if (near) cells = cells.slice().sort((a, b) => Math.hypot(a[0] - near[0], a[1] - near[1]) - Math.hypot(b[0] - near[0], b[1] - near[1])).slice(0, Math.max(12, cells.length >> 2));
      for (let attempt = 0; attempt < 260; attempt++) {
        const R = reach + (least - reach) * Math.min(1, attempt / 200), [cx, cy] = cells[(rnd() * cells.length) | 0];
        const n = R < 30 ? 5 : 6 + ((rnd() * 3) | 0), rot = rnd() * TAU, tilt = rnd() * Math.PI, sq = 0.55 + rnd() * 0.35, ct = Math.cos(tilt), st = Math.sin(tilt), pts = []; let ok = true;
        for (let i = 0; i < n && ok; i++) { const a = rot + i / n * TAU, r = R * (0.6 + rnd() * 0.4), ex = Math.cos(a) * r, ey = Math.sin(a) * r * sq, x = cx + ex * ct - ey * st, y = cy + ex * st + ey * ct; if (!open(x, y, tid) || Math.hypot(x - T.lx, y - T.ly) < 46) ok = false; else pts.push([x, y]); }
        for (let i = 0; i < n && ok; i++) ok = clear(pts[i][0], pts[i][1], pts[(i + 1) % n][0], pts[(i + 1) % n][1], tid);
        if (!ok) continue;
        const tr = spline(pts, true, 6); if (tr.p.every(p => open(p[0], p[1], tid))) return tr;
      }
      return null;
    }
    const KIND = {
      hobbit: { n: 2, reach: 44, v: 4.6, gap: 9, draw: 'walker', size: 0.8, cloaks: ['#6f7d45', '#8a6a3c', '#a08a44'], head: '#d9b98a', wide: 1.12 },
      traveller: { n: 2, reach: 60, v: 5.4, gap: 10, draw: 'walker', cloaks: ['#6e6558', '#7b5f42'], head: '#d9b98a', staff: 1 },
      ranger: { n: 1, reach: 80, v: 6.2, draw: 'walker', cloaks: ['#4f5a48'], head: '#4f5a48', staff: 1 },
      elf: { n: 3, reach: 62, v: 5.6, gap: 10, draw: 'walker', cloaks: ['#cfd2c2', '#b9c2ae'], head: '#e8dcbc' },
      dwarf: { n: 3, reach: 52, v: 4.4, gap: 9, draw: 'walker', size: 0.84, cloaks: ['#7a4a34', '#4a5a6a', '#6a6a3c'], head: '#caa57a', wide: 1.25, cart: 1 },
      orc: { n: 5, reach: 66, v: 6, gap: 8.5, draw: 'walker', cloaks: ['#34302a', '#3d3a2e'], head: '#4a4a36', torch: 2, banner: 1 },
      soldier: { n: 5, reach: 70, v: 5.6, gap: 8.5, draw: 'walker', cloaks: ['#b7b6a8', '#a9acaa'], head: '#c8c8c0', spear: 1, banner: 1 },
      dead: { n: 6, reach: 60, v: 4.4, gap: 8.5, draw: 'walker', cloaks: ['#b9d6b4'], head: '#d4e8cc', spear: 1, ghost: 1 },
      wildmen: { n: 3, reach: 60, v: 5.4, gap: 9, draw: 'walker', cloaks: ['#6a5238', '#59482f'], head: '#caa57a', torch: 3 },
      rohirrim: { n: 5, reach: 150, least: 52, v: 23, gap: 15, draw: 'rider', horses: ['#8a6a44', '#a39a86', '#5e4a34', '#c9c2ac'], cloaks: ['#5f7a43'], head: '#d8c27a', banner: 1, wedge: 7 },
      easterling: { n: 4, reach: 130, least: 48, v: 19, gap: 15, draw: 'rider', horses: ['#5e4a34', '#3f352a'], cloaks: ['#8a3c2c'], head: '#b98a4a', banner: 1, wedge: 6 },
      wain: { n: 2, reach: 100, least: 44, v: 4.6, gap: 34, draw: 'wain' },
      mumak: { n: 2, reach: 120, least: 50, v: 4.6, gap: 40, draw: 'mumak', escort: 3 },
      wolves: { n: 3, reach: 110, least: 34, v: 15, gap: 11, draw: 'quad', coat: '#55524a', size: 0.62, wolf: 1, roam: 1, wedge: 5 },
      deer: { n: 3, reach: 70, least: 26, v: 7, gap: 13, draw: 'quad', coat: '#a58f60', size: 0.7, antlers: 1, roam: 1, wedge: 6 },
      horses: { n: 4, reach: 120, least: 40, v: 14, gap: 14, draw: 'quad', coats: ['#8a6a44', '#5e4a34', '#c9c2ac', '#3f352a'], roam: 1, wedge: 7 },
      ent: { n: 1, reach: 46, v: 1.7, draw: 'ent' },
    };
    const plan = [
      ['The Shire', 'hobbit', [640, 930]], ['The Shire', 'hobbit', [600, 1010]], ['Buckland', 'hobbit'], ['Fornost', 'traveller', [800, 790]], ['Mithlond', 'elf', [440, 850]], ['Weather Hills', 'ranger'],
      ['Rhudaur', 'elf', [1210, 885]], ['North Downs', 'deer'], ['Borderlands', 'wolves'], ['South Downs', 'traveller'], ['Tower Hills', 'elf'], ['Lune Valley', 'elf'], ['Forlindon', 'elf'],
      ['Harlindon', 'deer'], ['Evendim Hills', 'deer'], ['Angmar', 'orc'], ['Eastern Angmar', 'wolves'], ['Forodwaith', 'wolves'], ['Carrock', 'deer'], ['Esgaroth', 'dwarf', [1700, 520]],
      ['Withered Heath', 'wolves'], ['North Rhûn', 'easterling'], ['South Rhûn', 'wain'], ['South Rhûn', 'easterling', [1760, 1130]], ['Rhûn Hills', 'horses'], ['Rhûn Hills', 'wildmen'], ['Brown Lands', 'horses'],
      ['Anduin Valley', 'traveller'], ['Gladden Fields', 'deer'], ['Eregion', 'ranger'], ['Moria', 'orc', [1190, 1120]], ['Lórien', 'elf', [1300, 1420]], ['Emyn Muil', 'ranger'], ['Dead Marshes', 'ranger'],
      ['Minhiriath', 'traveller'], ['Dunland', 'wildmen'], ['Enedwaith', 'horses'], ['Fangorn', 'ent'], ['The Wold', 'rohirrim'], ['West Rohan', 'rohirrim'], ['West Rohan', 'traveller', [990, 2090]], ['Gap of Rohan', 'rohirrim'], ['Gap of Rohan', 'traveller', [1110, 2085]],
      ['Gap of Rohan', 'horses'], ['Drúwaith Iaur', 'deer'], ['Anfalas', 'soldier'], ['Vale of Erech', 'dead'], ['Lamedon', 'soldier'], ['Lebennin', 'soldier'], ['Lebennin', 'traveller', [1160, 2700]], ['Belfalas', 'soldier', [930, 2640]], ['Minas Tirith', 'soldier', [1240, 2340]],
      ['Ithilien', 'ranger'], ['South Ithilien', 'ranger'], ['Udûn', 'orc', [1530, 2240]], ['Mount Doom', 'orc'], ['Gorgoroth', 'orc'], ['Barad-dûr', 'orc', [1820, 2380]], ['Nurn', 'orc'], ['Minas Morgul', 'orc', [1580, 2600]],
      ['Harondor', 'easterling'], ['Harondor', 'traveller'], ['Umbar', 'traveller', [1110, 3070]], ['Far Harad', 'mumak'], ['Harad', 'mumak'], ['Near Harad', 'easterling'], ['Khand', 'easterling'], ['Khand', 'wain'],
    ];
    groups = [];
    for (const [name, kind, near] of plan) {
      const tid = ID[name], K = KIND[kind]; if (tid == null) continue;
      const tr = walk(tid, K.reach, K.least || 13, near); if (!tr) continue;
      const m = []; for (let i = 0; i < K.n; i++) m.push({ back: K.wedge ? Math.ceil(i / 2) * K.gap : i * K.gap, side: K.wedge ? (i ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) * K.wedge : 0) : (i % 2 ? 1.2 : -1.2), v: (rnd() * 97) | 0, ph: rnd() * TAU });
      if (K.escort) for (let i = 0; i < K.escort; i++) m.push({ back: 20 + i * 11, side: (i % 2 ? 1 : -1) * 15, v: i, ph: rnd() * TAU, escort: 1 });
      if (K.cart) m.push({ back: K.n * K.gap + 6, side: 0, v: 0, ph: 0, cart: 1 });
      groups.push({ tid, kind, K, tr, d: rnd() * tr.len, m, ph: rnd() * TAU, moved: 0 });
    }
    // smoke and vapours
    plumes = [
      { at: PLACES.hobbiton, n: 5, rise: 30, drift: 12, r0: 1.6, r1: 6, a: 0.5, rate: 0.16, col: '246,242,226' },
      { at: PLACES.bree, n: 5, rise: 30, drift: 12, r0: 1.6, r1: 6, a: 0.5, rate: 0.15, col: '246,242,226' },
      { at: PLACES.edoras, n: 4, rise: 28, drift: 12, r0: 1.6, r1: 5.5, a: 0.42, rate: 0.14, col: '246,242,226' },
      { at: PLACES.umbar, n: 4, rise: 26, drift: 10, r0: 1.6, r1: 5.5, a: 0.4, rate: 0.13, col: '240,232,212' },
      { at: PLACES.camp, n: 5, rise: 34, drift: 14, r0: 1.4, r1: 6.5, a: 0.42, rate: 0.17, col: '226,220,204' },
      { at: PLACES.isengard, n: 7, rise: 56, drift: 26, r0: 2.4, r1: 12, a: 0.42, rate: 0.1, col: '56,52,46' },
      { at: PLACES.doom, n: 9, rise: 92, drift: 54, r0: 5, r1: 24, a: 0.44, rate: 0.07, col: '52,48,44' },
      { at: PLACES.guldur, n: 6, rise: 40, drift: -16, r0: 4, r1: 14, a: 0.26, rate: 0.06, col: '44,46,40' },
      { at: PLACES.rivendell, n: 5, rise: 13, drift: 5, r0: 2.4, r1: 8, a: 0.42, rate: 0.12, col: '250,250,244' },
      { at: PLACES.argonath, n: 5, rise: 14, drift: 3, r0: 3, r1: 10, a: 0.36, rate: 0.1, col: '250,250,244' },
    ];
    // weather that belongs to a place
    const scatter = (names, n, r) => { const out = [], ids = names.map(k => ID[k]).filter(k => k != null); for (let i = 0, tries = 0; i < n && tries < n * 60 && ids.length; tries++) { const tid = ids[(r() * ids.length) | 0], b = box[tid], x = b[0] + r() * (b[2] - b[0]), y = b[1] + r() * (b[3] - b[1]); if (smp.lab(x, y) === tid) { out.push({ x, y, ph: r(), sp: 0.7 + r() * 0.6, tid }); i++; } } return out; };
    const r2 = G.NZ.mulberry32(313);
    snow = scatter(['Forodwaith', 'Eastern Angmar', 'Angmar', 'Withered Heath'], 96, r2);
    embers = scatter(['Mount Doom', 'Gorgoroth', 'Udûn', 'Barad-dûr'], 46, r2);
    sand = scatter(['Harad', 'Near Harad', 'Far Harad', 'Khand', 'Harondor'], 40, r2);
    leaves = Array.from({ length: 12 }, () => ({ x: PLACES.lorien[0] + (r2() - 0.5) * 70, y: PLACES.lorien[1] + (r2() - 0.5) * 50, ph: r2(), sp: 0.7 + r2() * 0.6 }));
    wisps = scatter(['Dead Marshes'], 9, r2).filter(p => cls(p.x, p.y) === 0);
    eyes = scatter(['North Mirkwood', 'Eastern Mirkwood', 'South Mirkwood'], 7, r2);
    // great birds
    eagles = [{ x: 1330, y: 560, r: 96, sp: 0.21, ph: 0 }, { x: 1300, y: 640, r: 62, sp: -0.27, ph: 2 }, { x: 1245, y: 300, r: 70, sp: 0.24, ph: 4 }];
    crebain = { tr: spline([[930, 1470], [1010, 1380], [1050, 1180], [960, 1060], [900, 1240], [860, 1420]], true), d: 0, birds: Array.from({ length: 17 }, () => ({ a: r2() * TAU, b: r2() * TAU, r: 6 + r2() * 22, sp: 0.6 + r2() * 0.9 })) };
    fell = { tr: spline([[1575, 2500], [1660, 2380], [1740, 2290], [1850, 2270], [1900, 2420], [1820, 2540], [1690, 2500]], true), d: 0 };
  }

  /* ---------- drawing helpers ---------- */
  let ctx, z = 1, fs = 1, lod = 1, V = null, T = 0, DT = 0.016, GS = null;
  const seen = (x, y, m) => x > V.x0 - m && x < V.x1 + m && y > V.y0 - m && y < V.y1 + m;
  const facing = (key, dx, dy) => { let f = flip.get(key); if (f === undefined) f = dx < 0 ? -1 : 1; if (Math.abs(dx) > 0.34) f = dx < 0 ? -1 : 1; flip.set(key, f); return f; };
  const owner = tid => { const S = GS; if (!S) return null; const o = S.owner[tid]; return o >= 0 && S.players[o] ? S.players[o] : null; };
  function glow(x, y, r, rgb, a) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  function flame(x, y, s, a) {
    const f = 0.8 + 0.2 * Math.sin(T * 13 + x) + 0.1 * Math.sin(T * 31 + y);
    glow(x, y - 2 * s, 11 * s * f, '255,150,50', 0.42 * a); ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(s, s * f);
    ctx.beginPath(); ctx.moveTo(-1.7, 0); ctx.quadraticCurveTo(-2.2, -3, 0, -6.4); ctx.quadraticCurveTo(2.2, -3, 1.7, 0); ctx.closePath(); ctx.fillStyle = '#ffb347'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-0.8, 0); ctx.quadraticCurveTo(-1, -1.8, 0, -3.6); ctx.quadraticCurveTo(1, -1.8, 0.8, 0); ctx.closePath(); ctx.fillStyle = '#fff1b8'; ctx.fill(); ctx.restore();
  }
  function plume(p, k) {
    const [x, y] = p.at; if (!seen(x, y, 120)) return;
    for (let i = 0; i < p.n; i++) { const ph = (T * p.rate + i / p.n) % 1, a = p.a * (1 - ph) * Math.min(1, ph * 6) * (k == null ? 1 : k); ctx.fillStyle = `rgba(${p.col},${a})`; ctx.beginPath(); ctx.arc(x + ph * p.drift + Math.sin(i * 2.1 + T * 0.6) * (1 + ph * 3), y - ph * p.rise, p.r0 + ph * (p.r1 - p.r0), 0, 7); ctx.fill(); }
  }

  /* ---------- water ---------- */
  function water(c, view, t, dt, S) {
    ctx = c; V = view; T = t; DT = dt; GS = S; z = view.z; fs = clamp(0.8 / z, 1, 2.3); lod = smooth(0.2, 0.31, z);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // swell rolling onto every shore: the farthest line wakes first
    for (let i = 2; i >= 0; i--) { const a = Math.pow(Math.max(0, Math.sin(t * 0.85 + i * 1.15)), 1.6) * (0.5 - i * 0.07); if (a < 0.02) continue; ctx.strokeStyle = `rgba(238,242,230,${a})`; ctx.lineWidth = Math.max(1.3, 1.1 / z); ctx.setLineDash([36 + i * 12, 20 + i * 10]); ctx.lineDashOffset = Math.sin(t * 0.23 + i * 2) * 26 + i * 17; ctx.stroke(rings[i]); }
    // rivers run to the sea
    const k = Math.max(1, 0.5 / z);
    ctx.strokeStyle = 'rgba(232,240,234,0.5)'; ctx.setLineDash([7 * k, 15 * k]); ctx.lineDashOffset = -t * 21; ctx.lineWidth = 1.7 * k; ctx.stroke(riverA); ctx.lineWidth = 1.25 * k; ctx.stroke(riverB);
    ctx.strokeStyle = 'rgba(248,252,248,0.62)'; ctx.setLineDash([2.4 * k, 27 * k]); ctx.lineDashOffset = -t * 35 - 9; ctx.lineWidth = 1.15 * k; ctx.stroke(riverA); ctx.stroke(riverB);
    ctx.setLineDash([]);
    // light on the water
    ctx.strokeStyle = '#f6f8ee'; ctx.lineWidth = Math.max(1, 0.9 / z);
    for (const g of glints) { if (!seen(g.x, g.y, 10)) continue; const a = Math.pow(Math.max(0, Math.sin(t * g.sp + g.ph)), 7); if (a < 0.04) continue; ctx.globalAlpha = a * 0.75; const l = g.l * fs * 0.8; ctx.beginPath(); ctx.moveTo(g.x - l, g.y); ctx.lineTo(g.x + l, g.y); if (a > 0.6) { ctx.moveTo(g.x, g.y - l * 0.55); ctx.lineTo(g.x, g.y + l * 0.55); } ctx.stroke(); }
    ctx.restore();
  }

  /* ---------- ships ---------- */
  const SAIL = { cog: ['#e9e0c2', '#8f2c22', '#8d7b58'], gondor: ['#f1eee2', '#2f4a6a', '#7d7260'], corsair: ['#2b2824', '#9c2a1e', '#3a332b'], swan: ['#f4f3ea', '#c8ccd0', '#eceadd'], boat: ['#e4dcc0', '#6a5a3c', '#7a6644'], war: ['#e9e0c2', '#8f2c22', '#6e6048'] };
  function drawShip(x, y, size, fl, kind, ph, alpha, tint) {
    const s = size * fs, [sail, pen, hull] = SAIL[kind] || SAIL.cog; const c = ctx;
    c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.translate(x, y + Math.sin(T * 1.6 + ph) * 0.8 * s); c.rotate(Math.sin(T * 1.2 + ph) * 0.05); c.scale(fl * s, s);
    c.strokeStyle = INK; c.lineWidth = 1.1; c.lineJoin = 'round'; c.lineCap = 'round';
    // wake
    c.save(); c.strokeStyle = 'rgba(240,244,234,0.55)'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-16, 3); c.quadraticCurveTo(-22, 1, -28, 4.5); c.moveTo(-14, 7); c.quadraticCurveTo(-21, 6, -26, 9.5); c.moveTo(-6, 9); c.quadraticCurveTo(2, 11.5, 12, 8.5); c.stroke(); c.restore();
    if (kind === 'boat') {
      c.beginPath(); c.moveTo(-9, -1); c.quadraticCurveTo(0, 6, 10, -2); c.lineTo(-9, -1); c.fillStyle = hull; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(0, -2); c.lineTo(0, -17); c.stroke(); c.beginPath(); c.moveTo(0.5, -16.5); c.lineTo(8.5, -4); c.lineTo(0.5, -4); c.closePath(); c.fillStyle = sail; c.fill(); c.stroke();
    } else if (kind === 'swan') {
      c.beginPath(); c.moveTo(-14, -3); c.quadraticCurveTo(-2, 8, 13, -1); c.quadraticCurveTo(17, -5, 15.5, -11); c.quadraticCurveTo(15, -15, 18.6, -15.4); c.quadraticCurveTo(21.4, -14.6, 20.8, -12.6); c.lineTo(18.6, -12.8); c.quadraticCurveTo(17.6, -11, 18.4, -7); c.quadraticCurveTo(18.6, -3, 14, 1); c.quadraticCurveTo(0, 9.5, -14, -3); c.closePath(); c.fillStyle = hull; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-14, -3); c.quadraticCurveTo(-18, -7, -16, -11); c.stroke();
      c.beginPath(); c.moveTo(0, -4); c.lineTo(0, -27); c.stroke();
      c.beginPath(); c.moveTo(-9, -24); c.quadraticCurveTo(-3, -15, -9, -7); c.lineTo(9, -7); c.quadraticCurveTo(14, -15, 9, -24); c.closePath(); c.fillStyle = sail; c.fill(); c.stroke();
      c.fillStyle = pen; c.beginPath(); c.arc(0.5, -15.5, 2.1, 0, 7); c.fill(); c.fillStyle = INK; c.beginPath(); c.arc(19.3, -14, 0.55, 0, 7); c.fill();
    } else if (kind === 'corsair') {
      c.beginPath(); c.moveTo(-15, -2.5); c.quadraticCurveTo(0, 6.5, 14, -1.5); c.lineTo(20.5, -5); c.lineTo(13, -5.6); c.lineTo(-12, -5.6); c.quadraticCurveTo(-16, -8, -15.4, -11); c.quadraticCurveTo(-18.4, -7, -15, -2.5); c.closePath(); c.fillStyle = hull; c.fill(); c.stroke();
      c.save(); c.lineWidth = 0.7; c.beginPath(); for (let i = -9; i <= 9; i += 4.5) { c.moveTo(i, -1); c.lineTo(i - 2.4, 5.2 + Math.sin(T * 3.2 + ph + i) * 1.2); } c.stroke(); c.restore();
      c.beginPath(); c.moveTo(1, -5.6); c.lineTo(1, -27); c.stroke();
      c.beginPath(); c.moveTo(-10.5, -9); c.lineTo(13.5, -27.5); c.quadraticCurveTo(9, -16, 9.5, -8.4); c.closePath(); c.fillStyle = sail; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(1, -30); c.lineTo(-7, -28.4); c.lineTo(1, -26.6); c.fillStyle = pen; c.fill();
    } else {
      c.beginPath(); c.moveTo(-13, -2); c.quadraticCurveTo(0, 8, 15, -3); c.lineTo(11, -6); c.lineTo(-10, -6); c.closePath(); c.fillStyle = hull; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(1, -6); c.lineTo(1, -27); c.stroke();
      c.beginPath(); c.moveTo(-8, -24); c.quadraticCurveTo(-2, -15, -8, -8); c.lineTo(10, -8); c.quadraticCurveTo(15, -16, 10, -24); c.closePath(); c.fillStyle = tint || sail; c.fill(); c.stroke();
      if (kind === 'gondor') { c.fillStyle = pen; c.beginPath(); c.moveTo(-7.4, -23.6); c.quadraticCurveTo(-5.6, -21.4, -4.9, -19.4); c.lineTo(12.4, -19.4); c.quadraticCurveTo(12, -21.6, 10.2, -23.6); c.closePath(); c.fill(); }
      if (kind === 'war') { c.fillStyle = 'rgba(20,14,8,0.55)'; c.beginPath(); c.arc(1.5, -15.5, 2.6, 0, 7); c.fill(); }
      c.beginPath(); c.moveTo(1, -27); c.lineTo(7, -25.5); c.lineTo(1, -24); c.fillStyle = kind === 'war' ? (tint || pen) : pen; c.fill();
    }
    c.restore();
  }
  function ships(dt) {
    for (const s of vessels) {
      if (s.wait > 0) { s.wait -= dt; continue; }
      let alpha = 1;
      if (s.mode === 'ply') { s.d += s.v * s.dir * dt; if (s.d >= s.tr.len) { s.d = s.tr.len; s.dir = -1; s.wait = 5 + (s.ph % 4); } else if (s.d <= 0) { s.d = 0; s.dir = 1; s.wait = 5 + (s.ph % 4); } }
      else if (s.mode === 'away') { s.d += s.v * dt; alpha = Math.min(1, s.d / 26, (s.tr.len - s.d) / (s.river ? 30 : 190)); if (s.d >= s.tr.len) { s.d = 0; s.wait = 30 + (s.ph * 7) % 40; continue; } }
      else s.d += s.v * s.dir * dt;
      const [x, y, dx] = at(s.tr, s.d); if (!seen(x, y, 70)) continue;
      drawShip(x, y, s.size, facing(s, dx * s.dir), s.dark ? 'corsair' : s.kind, s.ph, Math.max(0, alpha));
    }
    for (const f of fleets) {
      f.d += f.v * dt; const lead = at(f.tr, f.d), fl = facing(f, lead[2]);
      // draw from the back of the formation forward so the flagship sits on top
      for (let i = f.form.length - 1; i >= 0; i--) {
        // in narrow water the wings of the formation close up behind the flagship
        const [back, side] = f.form[i], p = at(f.tr, f.d - back * f.size); let x = p[0], y = p[1];
        for (const k of [1, 0.45, 0]) { x = p[0] - p[3] * side * f.size * k; y = p[1] + p[2] * side * f.size * k; if (afloat(x, y, 5)) break; }
        if (!seen(x, y, 70)) continue; drawShip(x, y, f.size * (i ? 0.92 : 1.06), fl, f.kind, f.ph + i * 1.3, 1); }
    }
  }
  /* an attack across a sea lane is carried by ships in the attacker's colours */
  function seaLane(a, b) {
    const links = D.SEA_LINKS || []; for (let k = 0; k < links.length; k++) { const [p, q] = links[k]; if ((p === a && q === b) || (p === b && q === a)) { const tr = lanes[k]; return tr && tr.len > 60 ? { tr, rev: p !== a } : null; } }
    return null;
  }
  function invasion(c, view, t, a, b, kind, player) {
    const ln = seaLane(a, b); if (!ln) return false;
    ctx = c; V = view; T = t; z = view.z; fs = clamp(0.8 / z, 1, 2.3);
    const { tr, rev } = ln, col = kind === 'attack' ? '#c9301e' : '#e2b443', px = 1 / z;
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); tr.p.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
    c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 6; c.strokeStyle = 'rgba(255,246,226,0.95)'; c.lineWidth = 7 * px; c.setLineDash([13 * px, 8 * px]); c.lineDashOffset = (rev ? 1 : -1) * t * 38 * px; c.stroke();
    c.shadowColor = 'transparent'; c.strokeStyle = col; c.lineWidth = 4 * px; c.stroke(); c.setLineDash([]);
    const e = at(tr, rev ? 0 : tr.len), s = rev ? -1 : 1, ux = e[2] * s, uy = e[3] * s;
    c.beginPath(); c.moveTo(e[0] + ux * 13 * px, e[1] + uy * 13 * px); c.lineTo(e[0] - ux * 6 * px - uy * 10 * px, e[1] - uy * 6 * px + ux * 10 * px); c.lineTo(e[0] - ux * 6 * px + uy * 10 * px, e[1] - uy * 6 * px - ux * 10 * px); c.closePath(); c.fillStyle = col; c.strokeStyle = 'rgba(255,246,226,0.95)'; c.lineWidth = 2 * px; c.fill(); c.stroke();
    c.restore();
    for (let i = 0; i < 3; i++) { const u = (t * 0.16 + i / 3) % 1, d = (rev ? 1 - u : u) * tr.len, p = at(tr, d); drawShip(p[0], p[1], 1.12, facing(tr.p[0] + i, p[2] * s), 'war', i * 2.1, Math.min(1, u * 7, (1 - u) * 7), player ? player.color : null); }
    return true;
  }

  /* ---------- creatures of the deep ---------- */
  function deep(dt) {
    beasts.next -= dt;
    if (beasts.next <= 0 && beasts.spots.length) {
      const [x, y] = beasts.spots[(Math.random() * beasts.spots.length) | 0];
      if (afloat(x, y, 46) && afloat(x + 90, y, 20) && afloat(x - 90, y, 20)) { if (Math.random() < 0.55) beasts.serpent = { x, y, t: 0, dir: Math.random() < 0.5 ? 1 : -1 }; else beasts.whale = { x, y, t: 0, dir: Math.random() < 0.5 ? 1 : -1 }; }
      beasts.next = 16 + Math.random() * 18;
    }
    const sp = beasts.serpent;
    if (sp) {
      sp.t += dt; const life = 17; if (sp.t > life) beasts.serpent = null;
      else if (seen(sp.x, sp.y, 200)) {
        const rise = Math.min(1, sp.t / 2.2, (life - sp.t) / 2.6), s = 1.5 * fs, c = ctx;
        c.save(); c.translate(sp.x + sp.dir * sp.t * 5, sp.y); c.scale(sp.dir * s, s);
        c.beginPath(); c.rect(-90, -70, 190, 70); c.clip(); c.translate(0, (1 - rise) * 30);
        c.strokeStyle = INK; c.lineWidth = 1.15; c.lineJoin = 'round'; c.lineCap = 'round'; c.fillStyle = '#6d7a62';
        // the coils: a wave that travels down the body, only its crests break the surface
        c.beginPath(); c.moveTo(-64, 6);
        for (let x = -64; x <= 30; x += 2) c.lineTo(x, 3 - 11.5 * Math.sin(x * 0.13 - T * 2.1) * (0.55 + 0.45 * smooth(-64, -30, x)));
        c.lineTo(30, 6); c.closePath(); c.fill(); c.stroke();
        // neck and head
        const bob = Math.sin(T * 1.7) * 1.6;
        c.beginPath(); c.moveTo(28, 6); c.quadraticCurveTo(30, -16 + bob, 40, -24 + bob); c.quadraticCurveTo(46, -29 + bob, 54, -25 + bob); c.lineTo(60, -22 + bob); c.lineTo(52, -19.5 + bob); c.quadraticCurveTo(46, -17 + bob, 43, -10 + bob); c.quadraticCurveTo(41, -2, 42, 6); c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(38, -24.5 + bob); c.lineTo(33, -32 + bob); c.lineTo(42, -27 + bob); c.moveTo(34, -18 + bob); c.lineTo(28, -24 + bob); c.lineTo(35, -13 + bob); c.fillStyle = '#56624e'; c.fill(); c.stroke();
        c.fillStyle = '#f2ecd0'; c.beginPath(); c.arc(50.5, -24 + bob, 1.3, 0, 7); c.fill(); c.fillStyle = INK; c.beginPath(); c.arc(50.8, -24 + bob, 0.6, 0, 7); c.fill();
        c.restore();
        // ripples where it breaks the surface
        c.save(); c.strokeStyle = `rgba(240,244,234,${0.5 * rise})`; c.lineWidth = 1; c.translate(sp.x + sp.dir * sp.t * 5, sp.y + 1.5 * s);
        for (const ox of [-52, -22, 34]) { c.beginPath(); c.ellipse(ox * s * sp.dir, 0, 13 * s, 2.6 * s, 0, 0, Math.PI); c.stroke(); }
        c.restore();
      }
    }
    const wh = beasts.whale;
    if (wh) {
      wh.t += dt; const life = 11; if (wh.t > life) beasts.whale = null;
      else if (seen(wh.x, wh.y, 160)) {
        const s = 1.35 * fs, c = ctx, tt = wh.t, back = Math.min(1, tt / 1.2) * (1 - smooth(6.2, 7.6, tt)), tail = Math.sin(clamp((tt - 6.4) / 3.6, 0, 1) * Math.PI);
        c.save(); c.translate(wh.x + wh.dir * tt * 6, wh.y); c.scale(wh.dir * s, s); c.beginPath(); c.rect(-70, -70, 140, 70); c.clip();
        c.strokeStyle = INK; c.lineWidth = 1.1; c.lineJoin = 'round'; c.fillStyle = '#5d685a';
        if (back > 0.02) { c.beginPath(); c.ellipse(0, 9 - back * 9, 24, 8, 0, 0, 7); c.fill(); c.stroke(); }
        if (tail > 0.02) { c.save(); c.translate(-30, 26 - tail * 30); c.beginPath(); c.moveTo(-2.4, 14); c.quadraticCurveTo(-2, 2, -11, -7); c.quadraticCurveTo(-4, -6.4, 0, -2.4); c.quadraticCurveTo(4, -6.4, 11, -7); c.quadraticCurveTo(2, 2, 2.4, 14); c.closePath(); c.fill(); c.stroke(); c.restore(); }
        for (const t0 of [1.5, 3.7]) { const k = (tt - t0) / 1.5; if (k > 0 && k < 1) { c.fillStyle = `rgba(246,248,240,${0.8 * (1 - k)})`; for (let i = -3; i <= 3; i++) { c.beginPath(); c.arc(13 + i * 2.2 * k * 2.4, -4 - (18 - i * i * 1.2) * Math.sin(k * 2.2), 1.5 - k * 0.5, 0, 7); c.fill(); } } }
        c.restore();
        c.save(); c.strokeStyle = 'rgba(240,244,234,0.5)'; c.lineWidth = 1; c.beginPath(); c.ellipse(wh.x + wh.dir * tt * 6, wh.y + 1.5, 32 * s, 3.4 * s, 0, 0, Math.PI); c.stroke(); c.restore();
      }
    }
  }

  /* ---------- people and beasts of the land ---------- */
  function walker(o) {
    const c = ctx, sw = Math.sin(o.ph) * 1.8, wd = o.wide || 1;
    c.strokeStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 1.15;
    c.beginPath(); c.moveTo(-0.8, -4.2); c.lineTo(-0.8 + sw, 0); c.moveTo(0.8, -4.2); c.lineTo(0.8 - sw, 0); c.stroke();
    if (o.banner) { const w = Math.sin(T * 5 + o.ph) * 1.1; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-3.3, -3); c.lineTo(-3.3, -22); c.stroke(); c.beginPath(); c.moveTo(-3.3, -22); c.lineTo(-11.6, -21 + w); c.lineTo(-9.4, -18.6 + w); c.lineTo(-11.2, -16 + w); c.lineTo(-3.3, -15.6); c.closePath(); c.fillStyle = o.banner; c.fill(); c.lineWidth = 0.7; c.stroke(); }
    c.beginPath(); c.moveTo(-2.9 * wd, -3.6); c.quadraticCurveTo(-2.3 * wd, -9, -1.3, -10.6); c.lineTo(1.3, -10.6); c.quadraticCurveTo(2.3 * wd, -9, 2.9 * wd, -3.6); c.closePath(); c.fillStyle = o.cloak; c.fill(); c.lineWidth = 0.85; c.stroke();
    c.beginPath(); c.arc(0, -12.2, 1.95, 0, 7); c.fillStyle = o.head; c.fill(); c.stroke();
    if (o.staff) { c.lineWidth = 0.9; c.beginPath(); c.moveTo(3.9 + sw * 0.3, 0); c.lineTo(3.3, -13); c.stroke(); }
    if (o.spear) { c.lineWidth = 0.85; c.beginPath(); c.moveTo(3.5, 0); c.lineTo(3.5, -17.5); c.stroke(); c.beginPath(); c.moveTo(3.5, -20); c.lineTo(2.5, -17.2); c.lineTo(4.5, -17.2); c.closePath(); c.fillStyle = '#d8d6c8'; c.fill(); c.stroke(); }
    if (o.torch) { c.lineWidth = 0.9; c.beginPath(); c.moveTo(3.2, -6.5); c.lineTo(4.3, -13.6); c.stroke(); }
  }
  function quad(o) {
    // a four-legged beast seen from the side: horse, deer, wolf or ox
    const c = ctx, g = Math.sin(o.ph), g2 = Math.sin(o.ph + 1.9), run = o.run || 0, lift = -Math.abs(g) * 0.9 * run;
    c.strokeStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 1.25;
    const leg = (x, a) => { c.moveTo(x, -5.4 + lift); c.lineTo(x + a * (2 + run * 1.6), -Math.max(0, a) * 1.4 * run); };
    c.beginPath(); leg(4.2, g); leg(5.5, g2); leg(-4.9, -g); leg(-3.6, -g2); c.stroke();
    c.save(); c.translate(0, lift);
    c.beginPath(); if (o.wolf) { c.moveTo(-6.4, -8.6); c.quadraticCurveTo(-11.4, -7 + g, -11.8, -3.4); } else { c.moveTo(-6.4, -8.6); c.quadraticCurveTo(-10.6, -8.8 - g * run, -10.2, -3.4); } c.lineWidth = 1.35; c.stroke();
    c.beginPath(); c.ellipse(0, -7.5, 6.7, 3.1, 0, 0, 7); c.fillStyle = o.coat; c.fill(); c.lineWidth = 0.85; c.stroke();
    const up = o.wolf ? 2.4 : o.graze ? 6.5 * o.graze : 0;
    c.beginPath(); c.moveTo(4.4, -9.6); c.lineTo(8.3, -13.8 + up); c.lineTo(11.8, -12.4 + up * 1.25); c.lineTo(11.4, -10.9 + up * 1.25); c.lineTo(8.7, -11.2 + up); c.lineTo(6.3, -6.4); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(8.3, -13.8 + up); c.lineTo(7.8, -15.6 + up); c.stroke();
    if (o.antlers) { c.lineWidth = 0.8; c.beginPath(); c.moveTo(8.2, -14 + up); c.lineTo(6.8, -18.6 + up); c.moveTo(7.5, -16.2 + up); c.lineTo(5.6, -17.4 + up); c.moveTo(8.6, -14 + up); c.lineTo(9.8, -18.4 + up); c.moveTo(9.2, -16.2 + up); c.lineTo(11, -17.2 + up); c.stroke(); }
    if (o.horns) { c.lineWidth = 0.9; c.beginPath(); c.moveTo(8.6, -13.6); c.quadraticCurveTo(10.8, -16.6, 12.6, -15.2); c.stroke(); }
    c.restore();
  }
  function rider(o) {
    const c = ctx, lift = -Math.abs(Math.sin(o.ph)) * 0.9;
    quad({ coat: o.horse, ph: o.ph, run: 1 });
    c.save(); c.translate(0, lift); c.strokeStyle = INK; c.lineJoin = 'round'; c.lineCap = 'round';
    if (o.banner) { const w = Math.sin(T * 7 + o.ph) * 1.3; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-0.8, -11); c.lineTo(-0.8, -27); c.stroke(); c.beginPath(); c.moveTo(-0.8, -27); c.lineTo(-10.4, -26 + w); c.lineTo(-8, -23.4 + w); c.lineTo(-10, -20.6 + w); c.lineTo(-0.8, -20.2); c.closePath(); c.fillStyle = o.banner; c.fill(); c.lineWidth = 0.7; c.stroke(); }
    c.beginPath(); c.moveTo(-1.9, -9.2); c.lineTo(-1.1, -15.6); c.lineTo(1.7, -15.6); c.lineTo(2.5, -9.2); c.closePath(); c.fillStyle = o.cloak; c.fill(); c.lineWidth = 0.85; c.stroke();
    c.beginPath(); c.arc(0.4, -17.3, 1.8, 0, 7); c.fillStyle = o.head; c.fill(); c.stroke();
    c.restore();
  }
  function mumak(o) {
    const c = ctx, a = Math.sin(o.ph), b = Math.sin(o.ph + Math.PI / 2), col = '#8f866d';
    c.strokeStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round';
    const leg = (x, k) => { c.lineWidth = 4.6; c.strokeStyle = INK; c.beginPath(); c.moveTo(x, -10); c.lineTo(x + k * 2.2, 0); c.stroke(); c.lineWidth = 3; c.strokeStyle = '#7d745c'; c.beginPath(); c.moveTo(x, -10); c.lineTo(x + k * 2.2, -0.6); c.stroke(); };
    leg(-8.5, a); leg(-3.8, -b); leg(5, -a); leg(9.4, b); c.strokeStyle = INK;
    c.lineWidth = 1.2; c.beginPath(); c.moveTo(-13, -17); c.quadraticCurveTo(-16.4, -14, -15.6, -8.6); c.stroke();
    c.beginPath(); c.ellipse(0, -15.5, 13.2, 8.5, 0, 0, 7); c.fillStyle = col; c.fill(); c.lineWidth = 1; c.stroke();
    // the war tower
    c.fillStyle = '#7a2f22'; c.beginPath(); c.rect(-6.5, -30.5, 13, 7.5); c.fill(); c.stroke(); c.beginPath(); c.moveTo(-8, -30.5); c.lineTo(0, -36); c.lineTo(8, -30.5); c.closePath(); c.fillStyle = '#c9b06a'; c.fill(); c.stroke();
    if (o.banner) { const w = Math.sin(T * 4 + o.ph) * 0.9; c.lineWidth = 0.9; c.beginPath(); c.moveTo(0, -36); c.lineTo(0, -44); c.stroke(); c.beginPath(); c.moveTo(0, -44); c.lineTo(-7.6, -43 + w); c.lineTo(0, -39.8); c.closePath(); c.fillStyle = o.banner; c.fill(); c.lineWidth = 0.7; c.stroke(); }
    c.lineWidth = 1; c.beginPath(); c.ellipse(13.4, -17, 6.1, 6.6, 0, 0, 7); c.fillStyle = col; c.fill(); c.stroke();
    c.beginPath(); c.ellipse(10.2, -17.6, 3.5, 5, -0.2, 0, 7); c.fillStyle = '#7d745c'; c.fill(); c.stroke();
    const sw = Math.sin(T * 1.3 + o.ph) * 1.8;
    c.lineWidth = 3.9; c.strokeStyle = INK; c.beginPath(); c.moveTo(17.6, -16); c.bezierCurveTo(21.6, -13, 21, -7, 19 + sw, -2.6); c.stroke(); c.lineWidth = 2.3; c.strokeStyle = col; c.stroke();
    c.lineWidth = 2.7; c.strokeStyle = INK; c.beginPath(); c.moveTo(16.2, -13); c.quadraticCurveTo(21, -9.4, 24.4, -13.4); c.stroke(); c.lineWidth = 1.5; c.strokeStyle = '#f1ead2'; c.stroke();
    c.fillStyle = INK; c.beginPath(); c.arc(15.6, -18.6, 0.75, 0, 7); c.fill(); c.strokeStyle = INK;
  }
  function wain(o) {
    const c = ctx; c.save(); c.translate(15, 0); c.scale(0.86, 0.86); quad({ coat: '#8a7a5c', ph: o.ph, run: 0.25, horns: 1 }); c.restore();
    c.strokeStyle = INK; c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(9, -5.6); c.lineTo(13, -6.4); c.stroke();
    c.beginPath(); c.moveTo(-10, -9.4); c.quadraticCurveTo(0, -23, 10, -9.4); c.closePath(); c.fillStyle = '#ddd4b2'; c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-3.4, -9.4); c.quadraticCurveTo(-2, -16.6, 0, -16.2); c.moveTo(3.4, -9.4); c.quadraticCurveTo(2, -16.6, 0, -16.2); c.lineWidth = 0.55; c.stroke();
    c.lineWidth = 0.9; c.beginPath(); c.rect(-10, -9.4, 20, 5.2); c.fillStyle = '#7a5a36'; c.fill(); c.stroke();
    for (const wx of [-5.8, 5.8]) { c.beginPath(); c.arc(wx, -2.8, 2.8, 0, 7); c.fillStyle = '#3a2a18'; c.fill(); c.stroke(); c.save(); c.translate(wx, -2.8); c.rotate(o.ph * 0.6); c.strokeStyle = '#c9b88a'; c.lineWidth = 0.55; c.beginPath(); c.moveTo(-2.4, 0); c.lineTo(2.4, 0); c.moveTo(0, -2.4); c.lineTo(0, 2.4); c.stroke(); c.restore(); }
  }
  function cart(o) {
    const c = ctx; c.save(); c.translate(10, 0); c.scale(0.66, 0.66); quad({ coat: '#8a6a44', ph: o.ph, run: 0.25 }); c.restore();
    c.strokeStyle = INK; c.lineJoin = 'round'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(4.6, -4.6); c.lineTo(7.6, -5); c.stroke();
    c.beginPath(); c.rect(-6.4, -8.4, 11, 4.6); c.fillStyle = '#7a5a36'; c.fill(); c.stroke(); c.beginPath(); c.ellipse(-1, -8.6, 4.4, 2.2, 0, Math.PI, 0); c.fillStyle = '#c9b06a'; c.fill(); c.stroke();
    c.beginPath(); c.arc(-1, -2.6, 2.6, 0, 7); c.fillStyle = '#3a2a18'; c.fill(); c.stroke();
  }
  function ent(o) {
    const c = ctx, sw = Math.sin(o.ph) * 2.2, sway = Math.sin(T * 0.8) * 0.06;
    c.strokeStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = 2.4; c.beginPath(); c.moveTo(-1.5, -6); c.lineTo(-1.5 + sw, 0); c.moveTo(1.5, -6); c.lineTo(1.5 - sw, 0); c.stroke(); c.lineWidth = 1.2; c.strokeStyle = '#6b5a3a'; c.stroke(); c.strokeStyle = INK;
    c.save(); c.rotate(sway);
    c.beginPath(); c.moveTo(-2.6, -5.4); c.lineTo(-1.8, -18); c.lineTo(1.8, -18); c.lineTo(2.6, -5.4); c.closePath(); c.fillStyle = '#6b5a3a'; c.fill(); c.lineWidth = 0.9; c.stroke();
    c.lineWidth = 1.1; c.beginPath(); c.moveTo(-2, -13); c.lineTo(-6.6, -9.4 + sw * 0.4); c.moveTo(2, -13.6); c.lineTo(6.8, -10.4 - sw * 0.4); c.stroke();
    c.fillStyle = '#8b8a5c'; c.lineWidth = 0.9; for (const [x, y, r] of [[-3.6, -20.4, 4.4], [3.6, -21, 4.6], [0, -24.6, 5]]) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke(); }
    c.restore();
  }
  function land(dt, S) {
    if (lod < 0.02) return;
    const c = ctx; c.save(); c.globalAlpha = lod;
    for (const g of groups) {
      const K = g.K; let gate = 1;
      if (K.roam) gate = smooth(-0.25, 0.3, Math.sin(T * 0.21 + g.ph));      // herds stop to graze, then move on
      const step = K.v * gate * dt; g.d += step; g.moved += step;
      const head = at(g.tr, g.d); if (!seen(head[0], head[1], 190)) continue;
      const fl = facing(g, head[2]), pl = owner(g.tid), size = (K.size || 1) * fs;
      for (let i = g.m.length - 1; i >= 0; i--) {
        const m = g.m[i], p = at(g.tr, g.d - m.back), x = p[0] - p[3] * m.side, y = p[1] + p[2] * m.side;
        if (cls(x, y) !== 0 && cls(x, y) !== 4) continue;
        c.save(); c.translate(x, y);
        if (!K.ghost) { c.fillStyle = 'rgba(26,18,8,0.2)'; c.beginPath(); c.ellipse(0, 0.6, (K.draw === 'mumak' && !m.escort ? 15 : K.draw === 'walker' || m.escort ? 3.4 : 8) * size, 1.5 * size, 0, 0, 7); c.fill(); }
        else c.globalAlpha = lod * (0.42 + 0.14 * Math.sin(T * 1.3 + i));
        c.scale(fl * size, size);
        const ph = g.moved * (K.draw === 'rider' ? 0.5 : K.draw === 'quad' ? (K.wolf ? 0.6 : 0.42) : K.draw === 'mumak' ? 0.22 : 0.85) + m.ph;
        if (m.cart) cart({ ph });
        else if (m.escort) walker({ ph: ph * 3.6, cloak: i % 2 ? '#8a3c2c' : '#a0642c', head: '#8a6a44', spear: 1 });
        else if (K.draw === 'walker') walker({ ph, cloak: K.cloaks[m.v % K.cloaks.length], head: K.head, wide: K.wide, staff: K.staff && i === 0, spear: K.spear, torch: K.torch && i % K.torch === 0, banner: K.banner && i === 0 && pl ? pl.color : null });
        else if (K.draw === 'rider') rider({ ph, horse: K.horses[m.v % K.horses.length], cloak: K.cloaks[0], head: K.head, banner: K.banner && i === 0 && pl ? pl.color : null });
        else if (K.draw === 'quad') quad({ ph, coat: K.coats ? K.coats[m.v % K.coats.length] : K.coat, run: gate * (K.wolf ? 1 : 0.8), antlers: K.antlers && i !== 1, wolf: K.wolf, graze: K.roam && !K.wolf ? (1 - gate) * (0.5 + 0.5 * Math.sin(m.ph * 3)) : 0 });
        else if (K.draw === 'mumak') mumak({ ph, banner: pl ? pl.color : '#8a3c2c' });
        else if (K.draw === 'wain') wain({ ph });
        else if (K.draw === 'ent') ent({ ph: ph * 0.9 });
        c.restore();
        if (K.torch && !m.cart && i % K.torch === 0) flame(x + fl * 4.3 * size, y - 13.4 * size, 0.5 * size, lod);
        if (K.draw === 'rider' && gate > 0.5) { c.fillStyle = 'rgba(120,100,70,0.22)'; for (let j = 1; j <= 2; j++) { const q = at(g.tr, g.d - m.back - 9 * j); c.beginPath(); c.arc(q[0] - q[3] * m.side, q[1] + q[2] * m.side - 1.5, (1.6 + j * 1.3) * size, 0, 7); c.fill(); } }
      }
    }
    c.restore();
  }

  /* ---------- fires, smoke and strange lights ---------- */
  function lights(t) {
    const c = ctx, P = PLACES; c.save();
    // Orodruin
    const fl = 0.7 + 0.2 * Math.sin(t * 7.3) + 0.12 * Math.sin(t * 17.1);
    if (seen(P.doom[0], P.doom[1], 160)) {
      glow(P.doom[0], P.doom[1] + 3, 52, '255,104,32', 0.62 * fl); glow(P.doom[0], P.doom[1], 16, '255,214,120', 0.85 * fl);
      for (let i = 0; i < 9; i++) { const ph = (t * 0.33 + i / 9) % 1, a = Math.sin(i * 12.9) * 0.9; c.fillStyle = `rgba(255,${150 + ((i * 37) % 80)},60,${(1 - ph) * 0.9})`; c.beginPath(); c.arc(P.doom[0] + a * 26 * ph, P.doom[1] - 44 * Math.sin(ph * 2.6) * (0.6 + (i % 3) * 0.2), 1.3, 0, 7); c.fill(); }
    }
    plumes.forEach(p => plume(p));
    // the Eye
    const ep = 0.5 + 0.5 * Math.pow(Math.sin(t * 2.3), 2);
    if (seen(P.eye[0], P.eye[1], 60)) { glow(P.eye[0], P.eye[1], 20, '255,96,30', 0.5 + 0.3 * ep); c.fillStyle = `rgba(255,214,120,${0.75 * ep + 0.2})`; c.beginPath(); c.ellipse(P.eye[0], P.eye[1], 3.6, 1.7, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(30,10,4,0.9)'; c.beginPath(); c.ellipse(P.eye[0] + Math.sin(t * 0.5) * 1.3, P.eye[1], 0.6, 1.5, 0, 0, 7); c.fill(); }
    // Minas Morgul's corpse-light, the doors of Durin, the torches on the Black Gate
    glow(P.morgul[0], P.morgul[1], 30, '150,255,190', 0.2 + 0.16 * Math.sin(t * 0.9)); glow(P.morgul[0], P.morgul[1] - 14, 9, '190,255,214', 0.34 + 0.2 * Math.sin(t * 0.9));
    glow(P.moria[0], P.moria[1], 17, '170,214,255', 0.24 + 0.2 * Math.sin(t * 0.7));
    flame(P.gateL[0], P.gateL[1], 0.8, 1); flame(P.gateR[0], P.gateR[1], 0.8, 1); flame(P.camp[0], P.camp[1], 0.85, 1);
    glow(P.carn[0], P.carn[1], 12, '170,214,255', 0.2 + 0.16 * Math.sin(t * 1.1 + 2));
    // Smaug stirs
    const sm = (t % 19) / 2.6; if (sm < 1 && seen(P.smaug[0], P.smaug[1], 80)) for (let i = 0; i < 7; i++) { const ph = (sm * 1.6 + i / 7) % 1, a = Math.sin(sm * Math.PI) * (1 - ph); c.fillStyle = `rgba(255,${120 + i * 14},40,${0.75 * a})`; c.beginPath(); c.arc(P.smaug[0] + ph * 24, P.smaug[1] + ph * 9 + Math.sin(i * 3 + t * 9) * ph * 2.5, 1.4 + ph * 4.6, 0, 7); c.fill(); }
    // the beacons of Gondor: lit one after another from the White City, burning for a while
    const cyc = t % 84;
    BEACONS.forEach(([x, y], i) => { const on = smooth(0, 0.7, cyc - 4 - i * 1.5) * (1 - smooth(34, 38, cyc - i * 0.4)); if (on > 0.02 && seen(x, y, 40)) { flame(x, y - 1.5, 0.74 * on + 0.1, on); c.fillStyle = `rgba(60,54,46,${0.2 * on})`; for (let j = 0; j < 3; j++) { const ph = (t * 0.2 + j / 3) % 1; c.beginPath(); c.arc(x + ph * 7, y - 6 - ph * 15, 1.4 + ph * 3.4, 0, 7); c.fill(); } } });
    // golden leaves over Lorien
    for (const l of leaves) { const ph = (t * 0.07 * l.sp + l.ph) % 1; c.fillStyle = `rgba(250,214,96,${0.85 * Math.sin(ph * Math.PI)})`; c.beginPath(); c.ellipse(l.x + Math.sin(ph * 9 + l.ph * 20) * 5, l.y - 14 + ph * 30, 1.5, 0.8, ph * 7, 0, 7); c.fill(); }
    if (lod > 0.02) {
      c.globalAlpha = lod;
      // the candles of the dead in the marshes, and eyes under Mirkwood
      for (const w of wisps) { const a = Math.pow(Math.max(0, Math.sin(t * 0.33 * w.sp + w.ph * TAU)), 3); if (a > 0.03) { glow(w.x + Math.sin(t * 0.4 + w.ph * 9) * 4, w.y, 9, '210,255,214', 0.5 * a); c.fillStyle = `rgba(240,255,236,${0.8 * a})`; c.beginPath(); c.arc(w.x + Math.sin(t * 0.4 + w.ph * 9) * 4, w.y, 1.1, 0, 7); c.fill(); } }
      for (const e of eyes) { const ph = (t * 0.06 * e.sp + e.ph) % 1; if (ph < 0.2 && Math.sin(ph * 90) > -0.82) { c.fillStyle = `rgba(255,226,90,${Math.sin(ph / 0.2 * Math.PI)})`; c.beginPath(); c.arc(e.x - 1.7, e.y, 0.95, 0, 7); c.arc(e.x + 1.7, e.y, 0.95, 0, 7); c.fill(); } }
      // snow in the north, embers over Gorgoroth, sand over Harad
      c.fillStyle = 'rgba(252,252,248,0.85)';
      for (const s of snow) { const ph = (t * 0.11 * s.sp + s.ph) % 1, x = s.x + ph * 34 - 17 + Math.sin(ph * 12 + s.ph * 30) * 3, y = s.y + ph * 64 - 32; if (!seen(x, y, 6)) continue; c.globalAlpha = lod * Math.sin(ph * Math.PI) * 0.8; c.beginPath(); c.arc(x, y, 1.05 * fs, 0, 7); c.fill(); }
      for (const s of embers) { const ph = (t * 0.13 * s.sp + s.ph) % 1, x = s.x + Math.sin(ph * 8 + s.ph * 30) * 5 + ph * 12, y = s.y - ph * 54 + 20; if (!seen(x, y, 6)) continue; c.globalAlpha = lod * Math.sin(ph * Math.PI) * 0.9; c.fillStyle = s.ph > 0.5 ? '#ffb24a' : '#ff7a2e'; c.beginPath(); c.arc(x, y, 0.95 * fs, 0, 7); c.fill(); }
      c.strokeStyle = 'rgba(250,242,214,0.9)'; c.lineWidth = 0.9 * fs; c.lineCap = 'round';
      for (const s of sand) { const ph = (t * 0.12 * s.sp + s.ph) % 1, x = s.x + ph * 150 - 75, y = s.y + Math.sin(ph * 6 + s.ph * 20) * 4; if (!seen(x, y, 20)) continue; c.globalAlpha = lod * Math.sin(ph * Math.PI) * 0.42; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 8, y - 2.4, x + 17, y); c.stroke(); }
    }
    c.restore();
  }

  /* ---------- the sky ---------- */
  function bird(x, y, span, flap, w, col) { const c = ctx; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x - span, y - 1 + flap); c.quadraticCurveTo(x - span * 0.4, y - span * 0.64, x, y); c.quadraticCurveTo(x + span * 0.4, y - span * 0.64, x + span, y - 1 + flap); c.stroke(); }
  function sky(c, view, t, dt) {
    ctx = c; V = view; T = t; z = view.z; fs = clamp(0.8 / z, 1, 2.3);
    const P = G.SHEET && G.SHEET.print ? G.SHEET.print : { x0: 0, y0: 0, x1: W, y1: H };
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    // gulls wheel over the harbours
    for (const g of gulls) { if (!seen(g.x, g.y, 90)) continue; for (let i = 0; i < g.n; i++) { const a = t * (0.42 + i * 0.07) * (i % 2 ? -1 : 1) + g.ph + i * 2.1, x = g.x + Math.cos(a) * (26 + i * 9), y = g.y + Math.sin(a) * (14 + i * 6), f = Math.sin(t * 6 + i * 2) * 1.6 * fs; bird(x, y, 4.6 * fs, f, 2.3 * fs, 'rgba(39,36,27,0.55)'); bird(x, y, 4.6 * fs, f, 1.15 * fs, '#f6f4ea'); } }
    // skeins crossing the whole map
    for (let f = 0; f < flocks.length; f++) {
      const fk = flocks[f]; fk.x += Math.cos(fk.ang) * fk.v * dt; fk.y += Math.sin(fk.ang) * fk.v * dt;
      if (fk.x < -A - 180 || fk.x > W + 180 || fk.y < -90 || fk.y > H + 90) { flocks[f] = newFlock(Math.random, false); continue; }
      if (!seen(fk.x, fk.y, 140)) continue; const ca = Math.cos(fk.ang), sa = Math.sin(fk.ang);
      for (let b = 0; b < fk.n; b++) { const row = Math.ceil(b / 2), side = b % 2 ? 1 : -1; bird(fk.x - (ca * row * 13 + sa * side * row * 9) * fs, fk.y - (sa * row * 13 - ca * side * row * 9) * fs, 5 * fs, Math.sin(t * 9 + fk.ph + b) * 2.6 * fs, 1.15 * fs, 'rgba(30,26,20,0.85)'); }
    }
    // the crebain out of Dunland
    crebain.d += 30 * dt; { const p = at(crebain.tr, crebain.d); if (seen(p[0], p[1], 90)) for (const b of crebain.birds) { const x = p[0] + Math.cos(t * b.sp + b.a) * b.r * 1.5 * fs, y = p[1] + Math.sin(t * b.sp * 1.3 + b.b) * b.r * 0.8 * fs; bird(x, y, 2.9 * fs, Math.sin(t * 13 + b.a) * 1.4 * fs, 1.15 * fs, 'rgba(20,18,14,0.9)'); } }
    // the Eagles of the Misty Mountains, turning on the wind
    for (const e of eagles) { if (!seen(e.x, e.y, e.r + 60)) continue; const a = t * e.sp + e.ph, x = e.x + Math.cos(a) * e.r, y = e.y + Math.sin(a) * e.r * 0.62, bank = Math.sin(a) * 0.5, s = 1.1 * fs;
      c.save(); c.translate(x + 15 * s, y + 21 * s); c.rotate(a + Math.PI / 2 * Math.sign(e.sp)); c.scale(s, s); wings(0.16, 'rgba(26,18,8,0.2)', null, bank); c.restore();
      c.save(); c.translate(x, y); c.rotate(a + Math.PI / 2 * Math.sign(e.sp)); c.scale(s, s); wings(1, '#6b5536', INK, bank); c.restore(); }
    // a Nazgul on a fell beast, quartering Mordor
    fell.d += 34 * dt; { const p = at(fell.tr, fell.d), s = 1.5 * fs, a = Math.atan2(p[3], p[2]), fl = Math.sin(t * 3.2); if (seen(p[0], p[1], 90)) {
      c.save(); c.translate(p[0] + 18 * s, p[1] + 26 * s); c.rotate(a); c.scale(s, s); beast(fl, 'rgba(20,12,6,0.22)', null); c.restore();
      c.save(); c.translate(p[0], p[1]); c.rotate(a); c.scale(s, s); beast(fl, '#2a2622', '#0e0c0a'); c.restore(); } }
    // cloud shadows drifting over the sheet, then the clouds
    if (!cloudPat) cloudPat = c.createPattern(G.ATLAS.cloudShadowCanvas(256), 'repeat');
    const k = 1150 / 256, ox = (t * 14) % (256 * k), oy = (t * 3) % (256 * k), pw = P.x1 - P.x0, ph = P.y1 - P.y0;
    c.save(); c.beginPath(); c.rect(P.x0, P.y0, pw, ph); c.clip(); c.globalCompositeOperation = 'multiply'; c.globalAlpha = 0.62; c.translate(ox, oy); c.scale(k, k); c.fillStyle = cloudPat; c.fillRect((P.x0 - ox) / k - 1, (P.y0 - oy) / k - 1, pw / k + 2, ph / k + 2); c.restore();
    const zk = clamp(1.3 - (z / (view.home || z) - 1) * 0.8, 0.22, 1);
    c.save(); c.beginPath(); c.rect(P.x0, P.y0, pw, ph); c.clip();
    for (const cl of clouds) {
      cl.x += cl.v * dt; cl.y += cl.v * 0.16 * dt; if (cl.x > W + 420) { cl.x = -A - 520; cl.y = Math.random() * H; }
      const w = 320 * cl.s, h = 200 * cl.s; if (!seen(cl.x, cl.y, w)) continue;
      c.globalAlpha = cl.a * zk; c.drawImage(puffs[cl.k], cl.x - w / 2, cl.y - h / 2, w, h);
    }
    c.restore(); c.restore();
  }
  // a broad-winged bird seen from above, nose along +x
  function wings(alpha, fill, stroke, bank) {
    const c = ctx, k = 1 - Math.abs(bank) * 0.2; c.globalAlpha = alpha;
    c.beginPath(); c.moveTo(9.4, 0); c.quadraticCurveTo(6.6, -1.7, 4.6, -1.8);
    c.bezierCurveTo(5.6, -7 * k, 4.6, -15 * k, 2.6, -21 * k); c.lineTo(0.6, -22.5 * k); c.lineTo(0.2, -19.6 * k); c.lineTo(-1.8, -21.6 * k); c.lineTo(-1.8, -18.6 * k); c.lineTo(-4, -20 * k); c.lineTo(-3.6, -16.6 * k);
    c.bezierCurveTo(-5.2, -11 * k, -5, -5 * k, -6.4, -2.2); c.lineTo(-13.2, -4.4); c.lineTo(-14.2, -1.4); c.lineTo(-13.4, 0); c.lineTo(-14.2, 1.4); c.lineTo(-13.2, 4.4); c.lineTo(-6.4, 2.2);
    c.bezierCurveTo(-5, 5 * k, -5.2, 11 * k, -3.6, 16.6 * k); c.lineTo(-4, 20 * k); c.lineTo(-1.8, 18.6 * k); c.lineTo(-1.8, 21.6 * k); c.lineTo(0.2, 19.6 * k); c.lineTo(0.6, 22.5 * k); c.lineTo(2.6, 21 * k);
    c.bezierCurveTo(4.6, 15 * k, 5.6, 7 * k, 4.6, 1.8); c.quadraticCurveTo(6.6, 1.7, 9.4, 0); c.closePath();
    c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 0.9; c.lineJoin = 'round'; c.stroke(); c.fillStyle = '#efe6c6'; c.beginPath(); c.ellipse(6.4, 0, 2.5, 1.7, 0, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#d9a23c'; c.beginPath(); c.moveTo(8.6, -0.7); c.lineTo(10.8, 0); c.lineTo(8.6, 0.7); c.closePath(); c.fill(); }
  }
  // the fell beast: bat wings that beat, long neck and tail
  function beast(fl, fill, stroke) {
    const c = ctx, w = 15 + fl * 3.5, sweep = 3 - fl * 2.5;
    c.beginPath(); c.moveTo(13, 0); c.quadraticCurveTo(7, -1.6, 3, -2);
    c.lineTo(5 - sweep, -w); c.lineTo(0.5 - sweep, -w * 0.72); c.lineTo(-2 - sweep, -w * 0.9); c.lineTo(-4 - sweep * 0.6, -w * 0.5); c.lineTo(-7, -w * 0.58); c.lineTo(-6, -2);
    c.quadraticCurveTo(-12, -1, -19, 0); c.quadraticCurveTo(-12, 1, -6, 2);
    c.lineTo(-7, w * 0.58); c.lineTo(-4 - sweep * 0.6, w * 0.5); c.lineTo(-2 - sweep, w * 0.9); c.lineTo(0.5 - sweep, w * 0.72); c.lineTo(5 - sweep, w); c.lineTo(3, 2); c.quadraticCurveTo(7, 1.6, 13, 0); c.closePath();
    c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 0.8; c.stroke(); }
  }

  function ground(c, view, t, dt, S) {
    ctx = c; V = view; T = t; DT = dt; GS = S; z = view.z; fs = clamp(0.8 / z, 1, 2.3); lod = smooth(0.2, 0.31, z);
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    ships(dt); deep(dt); lights(t); land(dt, S);
    c.restore();
  }
  // development aid: where does any route leave the water, which lands got no walkers
  function audit() {
    const bad = []; const chk = (name, tr) => { let n = 0; for (const p of tr.p) if (!afloat(p[0], p[1])) n++; if (n) bad.push(`${name}: ${n}/${tr.p.length} off water`); };
    vessels.forEach((s, i) => { if (!s.river) chk(`vessel ${i} ${s.kind}`, s.tr); }); fleets.forEach((f, i) => chk(`fleet ${i} ${f.kind}`, f.tr)); lanes.forEach((l, i) => l && chk(`lane ${i}`, l));
    return { vessels: vessels.length, fleets: fleets.length, groups: groups.length, kinds: groups.map(g => TERR[g.tid].name + ':' + g.kind), bad, glints: glints.length, clouds: clouds.length };
  }

  Object.assign(LF, { init, setApron, water, ground, sky, invasion, seaLane, audit, cls, afloat, at, PLACES, state: () => ({ vessels, fleets, groups, beasts, eagles, fell, crebain, lanes }) });
  G.LIFE = LF;
})(window);
