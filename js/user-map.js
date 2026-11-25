/* Adapt the hand-drawn map to the existing rules and board APIs. */
(function (G) {
  const M = G.USER_MAP, D = G.DATA;
  D.W = M.width; D.H = M.height;
  D.MAP_ID = M.id; D.MAP_IMAGE = M.image; D.PRINTED_LABELS = true;
  D.REGIONS = M.regions;
  D.TERR = M.territories.map(t => ({ ...t, adj: t.adj.slice(), cx: t.lx, cy: t.ly, fs: 16, ang: 0 }));
  // lands that face each other across a river with no bridge, or a mountain range: not neighbours, and the game can say why
  D.BARRIERS = {}; for (const [a, b, kind] of M.barriers || []) { D.BARRIERS[a + '-' + b] = kind; D.BARRIERS[b + '-' + a] = kind; }
  D.QUICK_TARGET = Math.ceil(D.TERR.length * 26 / 42);
  D.SEA_LINKS = M.seaLinks;
  D.RIVERS = []; D.SEA_LABELS = [];
  // Keep the existing ambient effects, registered to the new drawing.
  D.VOLCANO = [1682, 2328]; D.DARK_TOWER = [1860, 2300];
  D.SHIP_ROUTES = [
    [[[410,48],[325,47],[205,82],[100,173],[39,267],[27,367],[62,422],[150,437],[199,407]],9,.8],
    [[[199,407],[104,451],[69,530],[73,610],[129,691],[211,765],[300,800],[340,795]],9,.8],
    [[[340,795],[319,930],[295,1063],[222,1140],[198,1200],[150,1250],[100,1285],[88,1325],[113,1360],[170,1376],[274,1364],[363,1392],[463,1379]],8,.8],
    [[[463,1379],[440,1440],[425,1510],[425,1557]],8,.8],
  ].map(([points,speed,size]) => [points.map(([x,y]) => [x*2,y*2]),speed,size]);

  async function generate(progress) {
    progress(.12, 'Tracing the illustrated territories…');
    const paths = D.TERR.map(t => {
      const path = new Path2D();
      for (const poly of t.polygons) {
        path.moveTo(...poly[0]); for (const point of poly.slice(1)) path.lineTo(...point); path.closePath();
      }
      return { path, loops: t.polygons };
    });
    const land = new Path2D(); for (const p of paths) land.addPath(p.path);
    // This raster contains only vector ID fills, never pixels from the artwork.
    // It stays origin-clean when play.html is opened directly from disk.
    const CELL = 2, GW = Math.ceil(D.W / CELL), GH = Math.ceil(D.H / CELL);
    const canvas = document.createElement('canvas'); canvas.width = GW; canvas.height = GH;
    const c = canvas.getContext('2d', { willReadFrequently: true }); c.scale(1/CELL,1/CELL);
    paths.forEach((p,i) => { c.fillStyle = `rgb(${i+1},0,0)`; c.fill(p.path,'evenodd'); });
    const rgba = c.getImageData(0,0,GW,GH).data, lab = new Int16Array(GW*GH).fill(-1);
    D.TERR.forEach(t => { t.area = 0; });
    for (let i=0;i<lab.length;i++) {
      const id = rgba[i*4]-1;
      if (rgba[i*4+3]>200 && id>=0 && id<D.TERR.length) { lab[i]=id; D.TERR[id].area++; }
    }
    const sample = (x,y) => x<0 || y<0 || x>=D.W || y>=D.H ? -1 : lab[Math.floor(y/CELL)*GW+Math.floor(x/CELL)];
    progress(.6, 'Preparing the 64-territory map…');
    return { custom: true, CELL, GW, GH, lab, rivers: [],
      borders: { terrPaths: paths, land: {path:land}, terrBorder:new Path2D(), regionBorder:new Path2D(), coastLine:new Path2D(), lines:[] },
      sampler: { lab:sample, seaD:(x,y)=>sample(x,y)<0?12:0 },
    };
  }
  G.USER_MAP_RUNTIME = { generate };
})(window);
