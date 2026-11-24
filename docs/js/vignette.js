/* Procedural ink-and-watercolour vignettes for each territory */
(function (G) {
  const NZ = G.NZ;
  const INK = 'rgba(48,32,18,0.9)';
  const cache = new Map();

  function paint(canvas, t) {
    if (G.MATERIALS.territory(canvas, t)) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 280, h = canvas.clientHeight || 140;
    const key = t.id + ':' + w + 'x' + h + '@' + dpr;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (cache.has(key)) { ctx.drawImage(cache.get(key), 0, 0); return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = NZ.mulberry32(1000 + t.id * 97);
    const n = NZ.makeSimplex(t.id * 13 + 5);
    scene(ctx, w, h, t.biome, rnd, n);
    // paper + vignette
    const tex = G.MAPGEN.paperTexture(128);
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = ctx.createPattern(tex, 'repeat'); ctx.fillRect(0, 0, w, h); ctx.restore();
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(70,40,15,0.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    const off = document.createElement('canvas'); off.width = canvas.width; off.height = canvas.height; off.getContext('2d').drawImage(canvas, 0, 0);
    cache.set(key, off);
  }

  function sky(ctx, w, h, top, bot) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, top); g.addColorStop(1, bot); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
  function ridge(ctx, w, h, n, base, amp, freq, fill, ink, sharp, seed = 0) {
    ctx.beginPath(); ctx.moveTo(-5, h + 5);
    const pts = [];
    for (let x = -5; x <= w + 5; x += 3) {
      let v = 0, a = 1, f = freq;
      for (let o = 0; o < 4; o++) { const s = n(x * f + seed, seed * 3.1 + o * 7); v += a * (sharp ? 1 - Math.abs(s) : s * 0.5 + 0.5); a *= 0.5; f *= 2.1; }
      const y = base - v * amp * 0.55; pts.push([x, y]); ctx.lineTo(x, y);
    }
    ctx.lineTo(w + 5, h + 5); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (ink) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke(); }
    return pts;
  }
  function peaks(ctx, pts, snow, shade) {
    // shading strokes under ridge crests
    ctx.strokeStyle = shade; ctx.lineWidth = 0.7;
    for (let i = 2; i < pts.length - 2; i += 2) {
      const [x, y] = pts[i]; const slope = pts[i + 1][1] - pts[i - 1][1];
      if (slope > 0.4) { ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x + 5, y + 10 + slope * 2); ctx.stroke(); }
    }
    if (snow) {
      ctx.fillStyle = 'rgba(252,251,246,0.92)';
      for (let i = 1; i < pts.length - 1; i++) {
        const [x, y] = pts[i]; if (pts[i - 1][1] > y && pts[i + 1][1] > y) { ctx.beginPath(); ctx.moveTo(x - 7, y + 7); ctx.lineTo(x, y); ctx.lineTo(x + 7, y + 7); ctx.lineTo(x + 2, y + 5); ctx.lineTo(x - 2, y + 8); ctx.closePath(); ctx.fill(); }
      }
    }
  }
  function conifer(ctx, x, y, s, c1, c2) {
    ctx.beginPath(); ctx.moveTo(x, y - s * 2.2); ctx.lineTo(x + s * 0.6, y); ctx.lineTo(x - s * 0.6, y); ctx.closePath(); ctx.fillStyle = c1; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y - s * 2.2); ctx.lineTo(x + s * 0.6, y); ctx.lineTo(x + s * 0.05, y); ctx.closePath(); ctx.fillStyle = c2; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x - s * 0.6, y); ctx.lineTo(x, y - s * 2.2); ctx.lineTo(x + s * 0.6, y); ctx.stroke();
  }
  function broad(ctx, x, y, s, c1, c2) {
    ctx.strokeStyle = INK; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s); ctx.stroke();
    ctx.beginPath(); ctx.arc(x - s * 0.4, y - s * 1.2, s * 0.65, 0, 7); ctx.arc(x + s * 0.4, y - s * 1.25, s * 0.65, 0, 7); ctx.arc(x, y - s * 1.7, s * 0.7, 0, 7); ctx.fillStyle = c1; ctx.fill();
    ctx.beginPath(); ctx.arc(x + s * 0.45, y - s * 1.25, s * 0.5, -0.5, 2.2); ctx.fillStyle = c2; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - s * 1.7, s * 0.7, 3.3, 6.2); ctx.stroke();
  }
  function water(ctx, w, y0, h, c1, c2) {
    const g = ctx.createLinearGradient(0, y0, 0, h); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, y0, w, h - y0);
    ctx.strokeStyle = 'rgba(40,70,80,0.45)'; ctx.lineWidth = 0.8;
    for (let y = y0 + 6; y < h; y += 7) for (let x = (y * 7) % 23; x < w; x += 26) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4, y - 2.5, x + 8, y); ctx.stroke(); }
    ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
  }
  function castle(ctx, x, y, s, wall, tall) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.strokeStyle = INK; ctx.lineWidth = 0.9 / s * 1.2; ctx.fillStyle = wall;
    const r = (a, b, c, d) => { ctx.beginPath(); ctx.rect(a, b, c, d); ctx.fill(); ctx.stroke(); };
    const cren = (a, b, c) => { for (let k = 0; k < c; k += 3) r(a + k, b - 2, 1.6, 2); };
    r(-20, -12, 40, 12); cren(-20, -12, 40);
    r(-24, -20, 8, 20); cren(-24, -20, 8); r(16, -20, 8, 20); cren(16, -20, 8);
    r(-6, -26 - (tall || 0), 12, 26 + (tall || 0)); cren(-6, -26 - (tall || 0), 12);
    ctx.beginPath(); ctx.moveTo(-7, -26 - (tall || 0)); ctx.lineTo(0, -36 - (tall || 0)); ctx.lineTo(7, -26 - (tall || 0)); ctx.closePath(); ctx.fillStyle = '#8a4a32'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b1d14'; ctx.beginPath(); ctx.rect(-2.5, -7, 5, 7); ctx.fill();
    ctx.restore();
  }
  function houses(ctx, x, y, k, s) {
    for (let i = 0; i < k; i++) {
      const hx = x + i * 11 * s, hy = y + (i % 2) * 2;
      ctx.fillStyle = '#efe5cc'; ctx.strokeStyle = INK; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.rect(hx, hy - 6 * s, 9 * s, 6 * s); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx - 1, hy - 6 * s); ctx.lineTo(hx + 4.5 * s, hy - 11 * s); ctx.lineTo(hx + 9 * s + 1, hy - 6 * s); ctx.closePath(); ctx.fillStyle = '#93502f'; ctx.fill(); ctx.stroke();
    }
  }
  function ship(ctx, x, y, s, sail) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.strokeStyle = INK; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(0, 7, 15, 0); ctx.lineTo(11, -3); ctx.lineTo(-11, -3); ctx.closePath(); ctx.fillStyle = '#6e4a2c'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, -26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-9, -24); ctx.quadraticCurveTo(-3, -15, -9, -6); ctx.lineTo(9, -6); ctx.quadraticCurveTo(14, -15, 9, -24); ctx.closePath(); ctx.fillStyle = sail || '#efe4c8'; ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function sun(ctx, x, y, r, c) { const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3); g.addColorStop(0, c); g.addColorStop(0.3, c.replace(/[\d.]+\)$/, '0.35)')); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3, 0, 7); ctx.fill(); }
  function grass(ctx, w, h, y0, rnd, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 0.7;
    for (let i = 0; i < 70; i++) { const x = rnd() * w, y = y0 + rnd() * (h - y0); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 1.5, y - 4); ctx.moveTo(x + 2, y); ctx.lineTo(x + 3, y - 3.5); ctx.stroke(); }
  }
  function birds(ctx, rnd, w, k) { ctx.strokeStyle = INK; ctx.lineWidth = 0.8; for (let i = 0; i < k; i++) { const x = w * 0.25 + rnd() * w * 0.5, y = 14 + rnd() * 22; ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.quadraticCurveTo(x - 2, y - 3, x, y); ctx.quadraticCurveTo(x + 2, y - 3, x + 4, y); ctx.stroke(); } }

  function scene(ctx, w, h, b, rnd, n) {
    const warm = ['#f1dfb8', '#e9d3a4'], cold = ['#dfe5e4', '#eef0ea'], dusk = ['#d9a57a', '#efd2a6'], doom = ['#5a2418', '#b2512e'];
    const fq = 0.012;
    switch (b) {
      case 'snow': case 'snowtower': {
        sky(ctx, w, h, ...cold);
        peaks(ctx, ridge(ctx, w, h, n, h * 0.55, h * 0.6, fq, '#c7ced0', INK, true, 1), true, 'rgba(60,70,80,0.4)');
        peaks(ctx, ridge(ctx, w, h, n, h * 0.78, h * 0.35, fq * 1.4, '#e8ebe6', INK, true, 4), true, 'rgba(60,70,80,0.4)');
        for (let i = 0; i < 14; i++) conifer(ctx, rnd() * w, h * 0.82 + rnd() * h * 0.18, 4 + rnd() * 3, '#56684f', '#3a4935');
        if (b === 'snowtower') { ctx.save(); castle(ctx, w * 0.68, h * 0.7, 0.9, '#e9e6dc', 10); ctx.restore(); }
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 0; i < 60; i++) { ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 0.9, 0, 7); ctx.fill(); }
        break;
      }
      case 'port': case 'desertport': case 'coast': case 'island': {
        const des = b === 'desertport';
        sky(ctx, w, h, des ? '#f0cf9a' : '#e7e2cf', des ? '#f6e2b8' : '#f2ead4');
        if (des) sun(ctx, w * 0.78, h * 0.25, 9, 'rgba(255,220,150,0.95)');
        ridge(ctx, w, h, n, h * 0.5, h * 0.3, fq, des ? '#d8b483' : '#b8b9a2', INK, false, 2);
        water(ctx, w, h * 0.6, h, '#a9c1bd', '#7f9fa4');
        if (b === 'island') { ctx.fillStyle = 'rgba(240,240,235,0.55)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(rnd() * w, h * 0.45 + rnd() * 20, 50, 7, 0, 0, 7); ctx.fill(); } }
        // headland
        ctx.beginPath(); ctx.moveTo(-5, h * 0.45); ctx.quadraticCurveTo(w * 0.3, h * 0.42, w * 0.42, h * 0.72); ctx.lineTo(w * 0.42, h + 5); ctx.lineTo(-5, h + 5); ctx.closePath();
        ctx.fillStyle = des ? '#e0bd86' : '#b9bb86'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
        if (b === 'port' || des) { houses(ctx, w * 0.06, h * 0.68, 4, 1.1); ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(w * 0.36, h * 0.8); ctx.lineTo(w * 0.55, h * 0.8); ctx.stroke(); }
        else for (let i = 0; i < 9; i++) conifer(ctx, rnd() * w * 0.35, h * 0.6 + rnd() * h * 0.35, 3.5 + rnd() * 2, '#5f744e', '#40513a');
        ship(ctx, w * 0.7, h * 0.82, 1.1, des ? '#3a2b22' : null);
        if (b !== 'island') ship(ctx, w * 0.88, h * 0.7, 0.6, des ? '#3a2b22' : null);
        birds(ctx, rnd, w, 3);
        break;
      }
      case 'meadow': case 'plains': case 'watch': case 'steppe': case 'valley': case 'river': case 'lake': {
        sky(ctx, w, h, ...warm);
        if (b === 'steppe' || b === 'plains') sun(ctx, w * 0.2, h * 0.25, 8, 'rgba(255,236,180,0.9)');
        ridge(ctx, w, h, n, h * 0.45, h * 0.35, fq, '#b9b39a', 'rgba(48,32,18,0.5)', true, 3);
        ridge(ctx, w, h, n, h * 0.68, h * 0.3, fq * 0.7, b === 'steppe' ? '#c9b98a' : '#aebc7b', INK, false, 6);
        if (b === 'river' || b === 'valley' || b === 'lake') {
          ctx.beginPath();
          if (b === 'lake') { ctx.ellipse(w * 0.55, h * 0.82, w * 0.35, h * 0.1, 0, 0, 7); }
          else { ctx.moveTo(w * 0.45, h * 0.62); ctx.bezierCurveTo(w * 0.55, h * 0.72, w * 0.3, h * 0.82, w * 0.5, h + 5); ctx.lineTo(w * 0.68, h + 5); ctx.bezierCurveTo(w * 0.45, h * 0.82, w * 0.62, h * 0.72, w * 0.48, h * 0.62); ctx.closePath(); }
          ctx.fillStyle = '#93b2b2'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.stroke();
        }
        ridge(ctx, w, h, n, h * 0.86, h * 0.14, fq * 1.5, b === 'steppe' ? '#d5c595' : '#bfc685', INK, false, 9);
        if (b === 'watch') {
          ctx.save(); ctx.translate(w * 0.6, h * 0.55);
          ctx.fillStyle = '#d9d0b9'; ctx.strokeStyle = INK; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-14, 10); ctx.lineTo(-12, -22); ctx.lineTo(-6, -26); ctx.lineTo(-2, -18); ctx.lineTo(4, -30); ctx.lineTo(9, -14); ctx.lineTo(14, 10); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
        }
        if (b === 'valley') { houses(ctx, w * 0.62, h * 0.7, 3, 1); for (let i = 0; i < 8; i++) broad(ctx, w * 0.1 + rnd() * w * 0.3, h * 0.78 + rnd() * h * 0.15, 4, '#7d924f', '#56693a'); }
        if (b === 'lake') houses(ctx, w * 0.35, h * 0.74, 4, 1);
        if (b === 'meadow') { for (let i = 0; i < 7; i++) broad(ctx, rnd() * w, h * 0.8 + rnd() * h * 0.15, 4 + rnd() * 2, '#7d924f', '#56693a'); houses(ctx, w * 0.55, h * 0.84, 2, 1); }
        grass(ctx, w, h, h * 0.75, rnd, 'rgba(70,60,30,0.5)');
        birds(ctx, rnd, w, 2);
        break;
      }
      case 'forest': case 'darkforest': case 'goldforest': {
        const dark = b === 'darkforest', gold = b === 'goldforest';
        sky(ctx, w, h, dark ? '#b9b89a' : gold ? '#f3dca0' : '#e9dfbd', dark ? '#d8d2b0' : '#f4e6c1');
        ridge(ctx, w, h, n, h * 0.42, h * 0.25, fq, dark ? '#8a9172' : '#b1b48b', 'rgba(48,32,18,0.4)', false, 2);
        const rows = 4;
        for (let r = 0; r < rows; r++) {
          const y = h * (0.5 + r * 0.16);
          for (let x = -10 + (r % 2) * 8; x < w + 10; x += 9 + rnd() * 6) {
            const s = 4.5 + r * 1.6 + rnd() * 1.5;
            if (dark) conifer(ctx, x, y + rnd() * 5, s, r % 2 ? '#344a2c' : '#2b3e25', '#1d2b18');
            else if (gold) broad(ctx, x, y + rnd() * 5, s * 0.9, r % 2 ? '#d2a940' : '#c49a33', '#9b7426');
            else broad(ctx, x, y + rnd() * 5, s * 0.9, r % 2 ? '#7d924f' : '#6c8343', '#4c5f33');
          }
        }
        if (gold) { ctx.fillStyle = 'rgba(255,240,170,0.85)'; for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 0.9 + rnd(), 0, 7); ctx.fill(); } }
        if (dark) { ctx.fillStyle = 'rgba(20,25,15,0.25)'; ctx.fillRect(0, 0, w, h); }
        break;
      }
      case 'mountain': case 'mine': {
        sky(ctx, w, h, '#e3ddc9', '#efe6cf');
        peaks(ctx, ridge(ctx, w, h, n, h * 0.6, h * 0.85, fq * 1.2, '#b0a690', INK, true, 1), true, 'rgba(60,45,30,0.5)');
        peaks(ctx, ridge(ctx, w, h, n, h * 0.92, h * 0.55, fq * 1.5, '#c9bc9c', INK, true, 5), false, 'rgba(60,45,30,0.5)');
        if (b === 'mine') {
          ctx.save(); ctx.translate(w * 0.5, h * 0.88);
          ctx.fillStyle = '#cfc2a4'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(-26, 4); ctx.lineTo(-26, -18); ctx.arc(0, -18, 26, Math.PI, 0); ctx.lineTo(26, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#20160f'; ctx.beginPath(); ctx.moveTo(-16, 4); ctx.lineTo(-16, -16); ctx.arc(0, -16, 16, Math.PI, 0); ctx.lineTo(16, 4); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,190,90,0.6)'; ctx.beginPath(); ctx.arc(0, -6, 5, 0, 7); ctx.fill();
          ctx.restore();
        }
        birds(ctx, rnd, w, 2);
        break;
      }
      case 'fortress': {
        sky(ctx, w, h, '#e2d8c0', '#efe3c8');
        peaks(ctx, ridge(ctx, w, h, n, h * 0.55, h * 0.7, fq * 1.1, '#aca28d', INK, true, 2), true, 'rgba(60,45,30,0.5)');
        ctx.beginPath(); ctx.moveTo(w * 0.3, h + 5); ctx.lineTo(w * 0.36, h * 0.72); ctx.lineTo(w * 0.7, h * 0.7); ctx.lineTo(w * 0.78, h + 5); ctx.closePath(); ctx.fillStyle = '#bdb092'; ctx.fill(); ctx.strokeStyle = INK; ctx.stroke();
        castle(ctx, w * 0.53, h * 0.72, 1.15, '#e3dbc6', 4);
        ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.92); ctx.lineTo(w * 0.36, h * 0.9); ctx.strokeStyle = INK; ctx.stroke();
        break;
      }
      case 'whitecity': {
        sky(ctx, w, h, '#e6dcc4', '#f3e8cf');
        sun(ctx, w * 0.8, h * 0.3, 10, 'rgba(255,240,200,0.9)');
        peaks(ctx, ridge(ctx, w, h, n, h * 0.5, h * 0.5, fq, '#b9b7aa', 'rgba(48,32,18,0.6)', true, 2), true, 'rgba(60,45,30,0.4)');
        ridge(ctx, w, h, n, h * 0.9, h * 0.15, fq, '#aab480', INK, false, 7);
        ctx.save(); ctx.translate(w * 0.5, h * 0.88); ctx.strokeStyle = INK; ctx.lineWidth = 1;
        const tiers = [[70, 12], [56, 12], [42, 12], [28, 12], [16, 12]];
        let y = 0;
        tiers.forEach(([tw, th]) => { y -= th; ctx.fillStyle = '#f6f1e3'; ctx.beginPath(); ctx.rect(-tw / 2, y, tw, th); ctx.fill(); ctx.stroke(); for (let k = -tw / 2; k < tw / 2; k += 4) { ctx.beginPath(); ctx.rect(k, y - 2, 2, 2); ctx.fill(); ctx.stroke(); } });
        ctx.fillStyle = '#fbf8ee'; ctx.beginPath(); ctx.rect(-3, y - 24, 6, 24); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-4, y - 24); ctx.lineTo(0, y - 33); ctx.lineTo(4, y - 24); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y - 33); ctx.lineTo(0, y - 42); ctx.stroke(); ctx.fillStyle = '#2f5f9e'; ctx.beginPath(); ctx.moveTo(0, y - 42); ctx.lineTo(9, y - 39); ctx.lineTo(0, y - 36); ctx.fill();
        ctx.restore();
        birds(ctx, rnd, w, 3);
        break;
      }
      case 'blackgate': case 'ash': case 'volcano': {
        sky(ctx, w, h, ...doom);
        peaks(ctx, ridge(ctx, w, h, n, h * 0.55, h * 0.6, fq * 1.3, '#4b2a20', 'rgba(10,5,3,0.9)', true, 3), false, 'rgba(0,0,0,0.5)');
        if (b === 'volcano') {
          ctx.save(); ctx.translate(w * 0.55, h * 0.85);
          const g = ctx.createRadialGradient(0, -60, 2, 0, -60, 60); g.addColorStop(0, 'rgba(255,140,40,0.8)'); g.addColorStop(1, 'rgba(255,80,20,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -60, 60, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-70, 10); ctx.quadraticCurveTo(-25, -30, -12, -62); ctx.lineTo(12, -62); ctx.quadraticCurveTo(25, -30, 70, 10); ctx.closePath(); ctx.fillStyle = '#2f1a14'; ctx.fill(); ctx.strokeStyle = '#120804'; ctx.stroke();
          ctx.strokeStyle = '#ff6a1a'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-4, -62); ctx.quadraticCurveTo(-12, -35, -22, -10); ctx.moveTo(5, -62); ctx.quadraticCurveTo(10, -30, 6, -5); ctx.stroke();
          ctx.fillStyle = 'rgba(40,30,30,0.55)'; for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.arc(k * 6 - 6, -72 - k * 10, 7 + k * 3, 0, 7); ctx.fill(); }
          ctx.restore();
        }
        if (b === 'blackgate') {
          ctx.save(); ctx.translate(w * 0.5, h * 0.9); ctx.fillStyle = '#1a110d'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.rect(-60, -40, 26, 40); ctx.rect(34, -40, 26, 40); ctx.fill(); ctx.stroke();
          for (let k = -60; k < 60; k += 6) { ctx.beginPath(); ctx.rect(k, -44, 3, 4); ctx.fill(); }
          ctx.fillStyle = '#0c0705'; ctx.beginPath(); ctx.rect(-34, -32, 68, 32); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#3a2a20'; for (let k = -30; k < 34; k += 8) { ctx.beginPath(); ctx.moveTo(k, -32); ctx.lineTo(k, 0); ctx.stroke(); }
          ctx.restore();
        }
        ridge(ctx, w, h, n, h * 0.95, h * 0.12, fq * 2, '#3a221a', '#0d0604', false, 8);
        ctx.fillStyle = 'rgba(255,120,40,0.7)'; for (let i = 0; i < 25; i++) { ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h * 0.7, 0.8, 0, 7); ctx.fill(); }
        break;
      }
      case 'desert': {
        sky(ctx, w, h, '#efc58a', '#f6e0b3');
        sun(ctx, w * 0.72, h * 0.28, 11, 'rgba(255,226,150,0.95)');
        ridge(ctx, w, h, n, h * 0.6, h * 0.25, fq * 0.6, '#dcae73', 'rgba(90,55,20,0.6)', false, 2);
        ridge(ctx, w, h, n, h * 0.8, h * 0.25, fq * 0.8, '#e6bf86', 'rgba(90,55,20,0.7)', false, 5);
        ridge(ctx, w, h, n, h * 0.98, h * 0.2, fq, '#ecca94', 'rgba(90,55,20,0.7)', false, 9);
        // palms / oasis
        ctx.save(); ctx.translate(w * 0.28, h * 0.8); ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(4, -16, 2, -30); ctx.stroke(); ctx.fillStyle = '#5e7a3b';
        for (const r of [-2.6, -1.9, -1.2, -0.4, 0.3]) { ctx.beginPath(); ctx.ellipse(2 + Math.cos(r) * 8, -30 + Math.sin(r) * 3 + 3, 8, 2.4, r, 0, 7); ctx.fill(); }
        ctx.restore();
        ctx.strokeStyle = 'rgba(40,25,10,0.8)'; ctx.lineWidth = 1; // caravan
        for (let k = 0; k < 4; k++) { const x = w * 0.55 + k * 12, y = h * 0.62; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 3, y - 6, x + 6, y - 2); ctx.quadraticCurveTo(x + 8, y - 6, x + 10, y - 1); ctx.moveTo(x + 2, y); ctx.lineTo(x + 2, y + 4); ctx.moveTo(x + 8, y); ctx.lineTo(x + 8, y + 4); ctx.stroke(); }
        break;
      }
      default: { sky(ctx, w, h, ...warm); ridge(ctx, w, h, n, h * 0.7, h * 0.4, fq, '#b8b38f', INK, false, 1); }
    }
    ctx.strokeStyle = 'rgba(40,25,12,0.8)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  G.VIGNETTE = { paint };
})(window);
