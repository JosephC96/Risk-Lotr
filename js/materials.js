/* Local artwork and deterministic material passes. No network dependency. */
(function (G) {
  let citadel, atlas, scenes, shields;
  // Alpha bounds of the six shipped sprites. Precomputed so file:// previews
  // never need a canvas pixel read, which browsers can block for local images.
  const shieldCells = [[77, 5, 395, 487], [567, 6, 394, 486], [1062, 6, 396, 485],
    [78, 521, 393, 484], [568, 521, 392, 485], [1063, 521, 394, 484]];
  async function load() {
    const read = async file => {
      const img = new Image(); img.src = 'assets/' + file;
      try { await img.decode(); return img; } catch (_) { return null; }
    };
    [citadel, atlas, scenes, shields] = await Promise.all([
      read('citadel-engraving.png'), read('eldmar-illustrated-atlas.png'), read('territory-illustrations.png'),
      read('heraldic-shields.png'),
    ]);
  }
  function illustration(canvas, position = .5) {
    if (!citadel) return false;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 240, h = canvas.clientHeight || 132;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = Math.max(w / citadel.width, h / citadel.height);
    const iw = citadel.width * scale, ih = citadel.height * scale;
    c.drawImage(citadel, (w - iw) * position, (h - ih) * .45, iw, ih);
    const shade = c.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, '#40290d18'); shade.addColorStop(.5, '#40290d00'); shade.addColorStop(1, '#40290d55');
    c.fillStyle = shade; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f1d59a88'; c.lineWidth = 1; c.strokeRect(3, 3, w - 6, h - 6);
    return true;
  }
  function patina(ctx, width, height) {
    // Broad watercolor blooms + fine paper grain, baked once into the atlas.
    const cw = 1000, ch = Math.round(cw * height / width);
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const c = canvas.getContext('2d'), pixels = c.createImageData(cw, ch);
    const noise = G.NZ.makeSimplex(153), fine = G.NZ.makeSimplex(71);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const cloud = noise(x / 94, y / 94) * .5 + noise(x / 31, y / 31) * .26 + fine(x / 7, y / 7) * .16;
      const grain = (G.NZ.hash2(x, y) - .5) * 16;
      const edge = Math.pow(1 - Math.min(1, Math.min(x, y, cw - x, ch - y) / 50), 2);
      const value = 240 + cloud * 23 + grain - edge * 39;
      const i = (y * cw + x) * 4;
      pixels.data[i] = Math.min(255, value + 9); pixels.data[i + 1] = Math.min(255, value + 3); pixels.data[i + 2] = value - 8; pixels.data[i + 3] = 255;
    }
    c.putImageData(pixels, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .76;
    ctx.drawImage(canvas, 0, 0, width, height); ctx.restore();
    // Lightly worn folds: offset shadow and highlight, never opaque lines.
    ctx.save();
    for (const x of [width * .333, width * .667]) {
      const fold = ctx.createLinearGradient(x - 12, 0, x + 12, 0);
      fold.addColorStop(0, '#6d441400'); fold.addColorStop(.42, '#6d44140d');
      fold.addColorStop(.5, '#fff1c322'); fold.addColorStop(.58, '#6d441409'); fold.addColorStop(1, '#6d441400');
      ctx.fillStyle = fold; ctx.fillRect(x - 12, 0, 24, height);
    }
    ctx.restore();
  }
  const sceneFor = {
    snow: 0, snowtower: 0,
    meadow: 1, watch: 1,
    mountain: 2, mine: 2, valley: 2,
    forest: 3, darkforest: 3, goldforest: 3,
    port: 4, island: 4, river: 4, lake: 4, coast: 4,
    plains: 5, fortress: 5, steppe: 5,
    whitecity: 6,
    blackgate: 7, ash: 7, volcano: 7,
    desert: 8, desertport: 8,
  };
  function territory(canvas, t) {
    if (!scenes) return t.biome === 'whitecity' && illustration(canvas, .9);
    const cell = sceneFor[t.biome] ?? 1;
    const sw = scenes.width / 3, sh = scenes.height / 3;
    const w = canvas.clientWidth || 250, h = canvas.clientHeight || 150;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Crop inside each cell to exclude any seam and preserve the illustration's ratio.
    const scale = Math.max(w / (sw - 4), h / (sh - 4));
    const cw = w / scale, ch = h / scale;
    const sx = (cell % 3) * sw + (sw - cw) / 2, sy = Math.floor(cell / 3) * sh + (sh - ch) / 2;
    c.drawImage(scenes, sx, sy, cw, ch, 0, 0, w, h);
    c.strokeStyle = '#edcf9266'; c.strokeRect(3, 3, w - 6, h - 6);
    return true;
  }
  function illustratedAtlas(ctx, world, width, height) {
    if (!atlas) return false;
    ctx.drawImage(atlas, 0, 0, width, height);
    // Gameplay geometry remains authoritative; printed borders share the hit-test paths.
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = '#513b2588'; ctx.lineWidth = 1.1;
    ctx.setLineDash([1, 6]); ctx.stroke(world.borders.terrBorder);
    ctx.setLineDash([6, 4, 1, 4]); ctx.strokeStyle = '#513b25aa'; ctx.stroke(world.borders.regionBorder);
    ctx.setLineDash([]); ctx.strokeStyle = '#45362377'; ctx.lineWidth = 1.3; ctx.stroke(world.borders.coastLine);
    const D = G.DATA;
    const seaClip = new Path2D(); seaClip.rect(0, 0, width, height); seaClip.addPath(world.borders.land.path);
    ctx.clip(seaClip, 'evenodd');
    ctx.setLineDash([5, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#51462d99';
    for (const [a, b] of D.SEA_LINKS) {
      const A = D.TERR[a], B = D.TERR[b];
      ctx.beginPath(); ctx.moveTo(A.lx, A.ly);
      ctx.quadraticCurveTo((A.lx + B.lx) / 2 + (A.ly - B.ly) * .12, (A.ly + B.ly) / 2 + (B.lx - A.lx) * .12, B.lx, B.ly); ctx.stroke();
    }
    ctx.restore();
    ctx.save(); ctx.fillStyle = '#3f4539'; ctx.textAlign = 'center';
    for (const label of D.SEA_LABELS) {
      ctx.save(); ctx.translate(label.x, label.y); ctx.rotate(label.r);
      ctx.font = `italic ${label.s * .85}px "IM Fell English", Georgia, serif`;
      ctx.fillText(label.t, 0, 0); ctx.restore();
    }
    ctx.restore();
    return true;
  }
  const emblemIndex = { tower: 0, horseshoe: 1, leaf: 2, hammer: 3, eye: 4, ring: 5 };
  function shieldSVG(p, cls) {
    if (!shields) return null;
    const cell = shieldCells[emblemIndex[p.emblem] ?? 0];
    return `<svg class="${cls}" viewBox="${cell.join(' ')}" aria-hidden="true"><image href="assets/heraldic-shields.png" width="${shields.width}" height="${shields.height}"/></svg>`;
  }
  function drawShield(ctx, x, y, width, p, glow) {
    if (!shields) return false;
    const cell = shieldCells[emblemIndex[p.emblem] ?? 0], height = width * 1.18;
    ctx.save(); ctx.shadowColor = glow || '#0009'; ctx.shadowBlur = glow ? 10 : 3; ctx.shadowOffsetY = glow ? 0 : 2;
    ctx.drawImage(shields, ...cell, x - width / 2, y - height / 2, width, height); ctx.restore();
    return true;
  }
  G.MATERIALS = { load, illustration, territory, patina, illustratedAtlas, shieldSVG, drawShield };
})(window);
