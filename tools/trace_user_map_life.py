"""Read the water of the user's map (sea, rivers, lakes) straight from the drawing
and compile what the living-map animations need: river centrelines ordered
downstream, wave lines that follow the coast, the lakes, and a coarse water grid.

Writes js/user-map-life.js. The artwork itself is never modified.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.graph import MCP_Geometric
from skimage.morphology import skeletonize

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/life'
OUT.mkdir(parents=True, exist_ok=True)
W = 2000
source = Image.open(ROOT / 'assets/middle-earth-user-map.jpg')
H = round(W * source.height / source.width)
CELL = 6

# Grey shading inside drawn buildings and statues reads as water by colour alone.
NOT_WATER = [(1570, 2549), (1062, 2150), (945, 2082), (1200, 831), (1865, 2337), (1864, 2260),
             (1085, 281), (1493, 1631), (1437, 1629), (420, 782)]
RHUN = (1947, 1290)   # the inland sea the eastern rivers drain into
PARTING = (1620, 774)  # where the eastern rivers part from the Anduin's


def ellipse(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def water_mask():
    rgb = np.asarray(source.resize((W, H), Image.Resampling.LANCZOS)).astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    raw = (((r - b) < 22) & ((r + g + b) > 205)).astype(np.uint8)
    raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, ellipse(2))
    raw = cv2.morphologyEx(raw, cv2.MORPH_OPEN, ellipse(1))
    n, lab, st, cen = cv2.connectedComponentsWithStats(raw, 8)
    keep = []
    for i in range(1, n):
        if st[i, 4] <= 400:
            continue
        if any(np.hypot(cen[i][0] - x, cen[i][1] - y) < 26 for x, y in NOT_WATER):
            continue
        keep.append(i)
    keep.sort(key=lambda i: -st[i, 4])
    main = keep[0]
    joined = (lab == main).astype(np.uint8)
    pending = keep[1:]
    # Printed bridges interrupt the rivers: sew the pieces back together.
    progress = True
    while progress and pending:
        progress = False
        dist, (iy, ix) = ndimage.distance_transform_edt(joined == 0, return_indices=True)
        for i in list(pending):
            ys, xs = np.nonzero(lab == i)
            k = dist[ys, xs].argmin()
            if dist[ys[k], xs[k]] > 46:
                continue
            ty, tx = iy[ys[k], xs[k]], ix[ys[k], xs[k]]
            joined[lab == i] = 1
            cv2.line(joined, (int(xs[k]), int(ys[k])), (int(tx), int(ty)), 1, 8)
            pending.remove(i)
            progress = True
    lakes_only = np.zeros_like(joined)
    for i in pending:           # water that never reaches the network: closed lakes
        if st[i, 4] > 3000:
            lakes_only[lab == i] = 1
    return joined, lakes_only


def trace_skeleton(sk):
    """Split a 1-pixel skeleton into branches between junctions and ends."""
    pts = set(zip(*np.nonzero(sk)))
    def nbrs(p):
        y, x = p
        return [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (y + dy, x + dx) in pts]
    deg = {p: len(nbrs(p)) for p in pts}
    nodes = {p for p in pts if deg[p] != 2}
    seen = set()
    branches = []
    for p in nodes:
        for q in nbrs(p):
            if (p, q) in seen:
                continue
            path = [p, q]
            prev, cur = p, q
            while cur not in nodes:
                nxt = [n for n in nbrs(cur) if n != prev and n not in path[-3:]]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                path.append(cur)
            seen.add((p, q)); seen.add((path[-1], path[-2]))
            branches.append(path)
    return branches, deg


def fill_holes(mask, limit):
    """Fill enclosed gaps of a 0/1 mask that are smaller than `limit` pixels."""
    n, lab, st, _ = cv2.connectedComponentsWithStats((1 - mask).astype(np.uint8), 4)
    out = mask.copy()
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < limit and x > 0 and y > 0 and x + w < mask.shape[1] and y + h < mask.shape[0]:
            out[lab == i] = 1
    return out


def merge_chains(branches, geo):
    """Join branches end to end wherever exactly two of them meet, so a river is one long line."""
    branches = [list(b) for b in branches]
    def key(p):
        return (p[0] // 6, p[1] // 6)
    changed = True
    while changed:
        changed = False
        ends = {}
        for i, b in enumerate(branches):
            if b is None:
                continue
            for end in (0, -1):
                y, x = b[end]
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ends.setdefault((y // 6 + dy, x // 6 + dx), set()).add((i, end))
        for i, b in enumerate(branches):
            if b is None:
                continue
            for end in (0, -1):
                here = b[end]
                near = {(j, e) for (j, e) in ends.get(key(here), ()) if branches[j] is not None
                        and abs(branches[j][e][0] - here[0]) <= 5 and abs(branches[j][e][1] - here[1]) <= 5}
                others = {(j, e) for (j, e) in near if j != i}
                if len(near) == 2 and len(others) == 1:
                    j, e = next(iter(others))
                    a = b if end == -1 else b[::-1]
                    c = branches[j] if e == 0 else branches[j][::-1]
                    branches[i] = a + c
                    branches[j] = None
                    changed = True
                    break
            if changed:
                break
    out = []
    for b in branches:
        if b is None:
            continue
        g = np.array([geo[p] if np.isfinite(geo[p]) else 0 for p in b])
        k = int(g.argmax())
        if 10 < k < len(b) - 10 and g[k] - max(g[0], g[-1]) > 20:
            out.append(b[k::-1]); out.append(b[k:])       # water parts here and runs both ways
        else:
            out.append(b if g[0] >= g[-1] else b[::-1])
    return out


def polyline_length(p):
    p = np.asarray(p, float)
    return float(np.hypot(*(p[1:] - p[:-1]).T).sum()) if len(p) > 1 else 0.0


def water_layers():
    """Sea, lakes and rivers of the drawing as separate masks (shared with the border tracer)."""
    joined, lakes_only = water_mask()
    joined = fill_holes(joined, 300)
    water = ((joined | lakes_only) > 0).astype(np.uint8)
    land_dist = ndimage.distance_transform_edt(water)        # distance to the nearest shore
    # open water = anywhere a 15 px disc fits; everything narrower is river
    core = (land_dist > 15).astype(np.uint8)
    open_water = (cv2.dilate(core, ellipse(18)) & water)
    n, lab, st, cen = cv2.connectedComponentsWithStats(open_water, 8)
    sea_id = lab[H // 2, 4]
    sea = (lab == sea_id).astype(np.uint8)
    # lettering and little ships printed on the sea are not islands
    filled = fill_holes(sea, 2500)
    extra = (filled > 0) & (sea == 0)
    sea = filled
    joined[extra] = 1; water[extra] = 1
    land_dist = ndimage.distance_transform_edt(water)
    lakes = []
    lake_mask = np.zeros_like(sea)
    for i in range(1, n):
        if i == sea_id or st[i, 4] < 1500:
            continue
        lake_mask[lab == i] = 1
        x, y, w, h, a = (int(v) for v in st[i])
        lakes.append(dict(cx=round(float(cen[i][0])), cy=round(float(cen[i][1])), x=x, y=y, w=w, h=h, area=a))
    open_water = (sea | lake_mask)
    river = (joined & (1 - open_water)).astype(np.uint8)
    river = cv2.morphologyEx(river, cv2.MORPH_OPEN, ellipse(1))
    return dict(joined=joined, lakes_only=lakes_only, water=water, land_dist=land_dist, sea=sea, lake_mask=lake_mask, lakes=lakes, open_water=open_water, river=river)


def main():
    layers = water_layers()
    joined, lakes_only, water, land_dist, sea, lake_mask, lakes, open_water, river = (layers[k] for k in ('joined', 'lakes_only', 'water', 'land_dist', 'sea', 'lake_mask', 'lakes', 'open_water', 'river'))

    # ---- which way the water runs: downhill is towards the sea (or the Sea of Rhun)
    # Two basins: the Great Sea and the inland Sea of Rhun. The water parts where the
    # River Running leaves the Long Lake's outflow, so the Anduin always runs south.
    def distance_to(mask):
        ys, xs = np.nonzero(mask & joined)
        step = max(1, len(ys) // 4000)
        field, _ = MCP_Geometric(np.where(joined > 0, 1.0, -1.0), fully_connected=True).find_costs(list(zip(ys[::step], xs[::step])))
        return field
    geo = distance_to(sea)
    rn, rlab = cv2.connectedComponents(lake_mask, 8)
    rid = rlab[RHUN[1], RHUN[0]]
    if rid:
        to_rhun = distance_to((rlab == rid).astype(np.uint8))
        _, (jy, jx) = ndimage.distance_transform_edt(joined == 0, return_indices=True)
        parting = (jy[PARTING[1], PARTING[0]], jx[PARTING[1], PARTING[0]])
        if np.isfinite(geo[parting]) and np.isfinite(to_rhun[parting]):
            geo = np.minimum(geo, to_rhun + (geo[parting] - to_rhun[parting]))
        else:
            geo = np.minimum(geo, to_rhun)

    # ---- centrelines
    sk = skeletonize((river | cv2.dilate(lake_mask, ellipse(2)) & joined).astype(bool) & (river > 0))
    near_open = ndimage.distance_transform_edt(open_water == 0)
    # prune the skeleton's whiskers, then thin and trace again so each river is one line
    for _ in range(6):
        branches, deg = trace_skeleton(sk)
        kept, pruned = [], 0
        for path in branches:
            ends_free = [deg[path[0]] == 1, deg[path[-1]] == 1]
            if any(ends_free) and len(path) < 24:
                tip = path[0] if ends_free[0] else path[-1]
                if near_open[tip] > 8:
                    pruned += 1
                    continue
            kept.append(path)
        if not pruned:
            break
        again = np.zeros(sk.shape, bool)
        for path in kept:
            ys, xs = zip(*path)
            again[ys, xs] = True
        sk = skeletonize(again)
    kept = [path for path in kept if len(path) >= 3]
    rivers = []
    for path in merge_chains(kept, geo):
        if len(path) < 6:
            continue
        width = float(np.median([land_dist[p] for p in path])) * 2
        pts = np.array([[x, y] for y, x in path], np.int32).reshape(-1, 1, 2)
        simple = cv2.approxPolyDP(pts, 1.4, False).reshape(-1, 2).tolist()
        if len(simple) >= 2 and polyline_length(simple) > 26:
            rivers.append(dict(w=round(width, 1), pts=simple))
    rivers.sort(key=lambda r: -polyline_length(r['pts']))

    # ---- wave lines that hug the shore of the sea and the lakes
    rings = []
    for d in (6, 14, 24):
        level = ((land_dist >= d) & (open_water > 0)).astype(np.uint8)
        contours, _ = cv2.findContours(level, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        lines = []
        for c in contours:
            c = c.reshape(-1, 2)
            if len(c) < 30:
                continue
            edge = (c[:, 0] <= 1) | (c[:, 1] <= 1) | (c[:, 0] >= W - 2) | (c[:, 1] >= H - 2)
            if edge.all():
                continue
            if edge.any():                         # start on the paper's edge so the cuts are clean
                c = np.roll(c, -int(np.argmax(edge)), axis=0)
                edge = (c[:, 0] <= 1) | (c[:, 1] <= 1) | (c[:, 0] >= W - 2) | (c[:, 1] >= H - 2)
            run = []
            for point, off in zip(c.tolist(), edge.tolist()):
                if off:
                    if len(run) > 20:
                        lines.append(run)
                    run = []
                else:
                    run.append(point)
            if len(run) > 20:
                if not edge.any():
                    run.append(run[0])
                lines.append(run)
        out = []
        for run in lines:
            simple = cv2.approxPolyDP(np.array(run, np.int32).reshape(-1, 1, 2), 1.0, False).reshape(-1, 2).tolist()
            if polyline_length(simple) > 60:
                out.append(simple)
        rings.append(out)

    # ---- open ground: land with no drawn mountains, trees, buildings or lettering on it
    rgb = np.asarray(source.resize((W, H), Image.Resampling.LANCZOS)).astype(int)
    ink = ((rgb.sum(axis=2) < 300) & (water == 0)).astype(np.float32)
    drawn = (cv2.blur(ink, (27, 27)) > 0.045).astype(np.uint8)
    drawn = cv2.dilate(drawn, ellipse(5))

    # ---- coarse grid: 0 open land, 1 sea, 2 lake, 3 river, 4 land with something drawn on it
    klass = np.zeros((H, W), np.uint8)
    klass[drawn > 0] = 4
    klass[river > 0] = 3
    klass[lake_mask > 0] = 2
    klass[lakes_only > 0] = 2
    klass[sea > 0] = 1
    gw, gh = W // CELL + 1, H // CELL + 1
    grid = np.zeros((gh, gw), np.uint8)
    for gy in range(gh):
        for gx in range(gw):
            grid[gy, gx] = klass[min(H - 1, gy * CELL + CELL // 2), min(W - 1, gx * CELL + CELL // 2)]
    flat = grid.ravel()
    cuts = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate([[0], cuts]); ends = np.concatenate([cuts, [len(flat)]])
    rle = ','.join(f'{int(flat[s])}{np.base_repr(int(e - s), 36).lower()}' for s, e in zip(starts, ends))

    data = dict(width=W, height=H, rivers=rivers, rings=rings, lakes=lakes, grid=dict(cell=CELL, w=gw, h=gh, rle=rle))
    (ROOT / 'js/user-map-life.js').write_text(
        "/* Water read from the user's map for the living-map animations. Generated by tools/trace_user_map_life.py. */\n"
        'window.USER_MAP_LIFE = ' + json.dumps(data, separators=(',', ':')) + ';\n', encoding='utf-8')

    # ---- QA overlay
    vis = np.asarray(source.resize((W, H))).copy()
    clear = (klass == 0)
    vis[clear] = (vis[clear] * 0.6 + np.array([60, 200, 90]) * 0.4).astype(np.uint8)
    vis[sea > 0] = (vis[sea > 0] * 0.55 + np.array([40, 90, 200]) * 0.45).astype(np.uint8)
    vis[(lake_mask | lakes_only) > 0] = (vis[(lake_mask | lakes_only) > 0] * 0.4 + np.array([0, 190, 200]) * 0.6).astype(np.uint8)
    for i, ring in enumerate(rings):
        for line in ring:
            cv2.polylines(vis, [np.array(line, np.int32)], False, (255, 255, 255), 1)
    for r in rivers:
        p = np.array(r['pts'], np.int32)
        cv2.polylines(vis, [p], False, (255, 40, 40), 2)
        cv2.circle(vis, tuple(int(v) for v in p[-1]), 4, (255, 230, 0), -1)    # downstream end
    Image.fromarray(vis).save(OUT / 'life-trace.jpg', quality=85)
    size = (ROOT / 'js/user-map-life.js').stat().st_size
    print('rivers', len(rivers), 'length', round(sum(polyline_length(r['pts']) for r in rivers)),
          'ring lines', [len(r) for r in rings], 'lakes', [(l['cx'], l['cy'], l['area']) for l in lakes], 'bytes', size)


if __name__ == '__main__':
    main()
