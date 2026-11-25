"""Trace the territories of the user's map from the drawing itself.

The borders that are printed on the map are the borders of the game: the dotted
lines, the rivers and their thin upper courses, the coast, and the crest of the
mountain ranges where nothing else is drawn. Names, regions and the point where
each land's troops stand come from js/user-map-data.js and are kept; only the
outlines (and the neighbours that follow from them) are rewritten.

Works on the artwork at twice the game's scale. The artwork is never modified.
"""
from pathlib import Path
import json
import sys
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.segmentation import watershed

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trace_user_map_life as life          # noqa: E402  (water masks are shared)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/borders'
OUT.mkdir(parents=True, exist_ok=True)
K = 2
W1, H1 = life.W, life.H
W, H = W1 * K, H1 * K
DATA = ROOT / 'js/user-map-data.js'
# lands drawn in more than one piece: [name, x, y] of a point in the extra piece (game scale)
EXTRA_SEEDS = [('Mithlond', 408, 928), ('Belfalas', 1090, 2832)]
# where the stored troop point sits on a border, a point well inside the land (game scale)
SEED = {'Lamedon': (1012, 2400)}
# lands whose only meeting is a spur of the Misty Mountains east of Rivendell
NOT_NEIGHBOURS = [('Carrock', 'Eregion')]


def load_data():
    s = DATA.read_text(encoding='utf-8')
    head = s[:s.index('{')]
    return head, json.loads(s[s.index('{'):s.rindex('}') + 1])


def disc(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def find_dashes(ink):
    """The short strokes of the dotted borders, joined up into unbroken lines."""
    n, lab, st, cen = cv2.connectedComponentsWithStats(ink, 8)
    dashes = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if not (12 <= a <= 170) or max(w, h) > 34:
            continue
        ys, xs = np.nonzero(lab[y:y + h, x:x + w] == i)
        pts = np.stack([xs + x, ys + y], axis=1).astype(np.float64)
        c = pts.mean(axis=0)
        cov = np.cov((pts - c).T)
        vals, vecs = np.linalg.eigh(cov)
        if vals[1] <= 0:
            continue
        length, width = 4 * np.sqrt(vals[1]), 4 * np.sqrt(max(vals[0], 1e-6))
        if not (6.5 <= length <= 34) or width > 13 or length / width < 1.25:
            continue
        u = vecs[:, 1]
        dashes.append(dict(id=i, c=c, u=u, half=length / 2, a=int(a)))
    if not dashes:
        return np.zeros_like(ink), []
    C = np.array([d['c'] for d in dashes])
    links = set()
    for i, d in enumerate(dashes):
        dist = np.hypot(*(C - d['c']).T)
        near = [j for j in np.nonzero(dist < 52)[0] if j != i]
        for sign in (1, -1):
            end = d['c'] + sign * d['u'] * d['half']
            best, cost = None, 1e9
            for j in near:
                o = dashes[j]
                ends = [o['c'] + o['u'] * o['half'], o['c'] - o['u'] * o['half']]
                gap = min(np.hypot(*(e - end)) for e in ends)
                v = o['c'] - d['c']
                along = np.dot(v, sign * d['u']) / (np.hypot(*v) + 1e-6)     # ahead of this end, not beside it
                turn = abs(np.dot(o['u'], d['u']))
                if gap > 26 or along < 0.5 or turn < 0.35:
                    continue
                score = gap + (1 - along) * 30 + (1 - turn) * 12
                if score < cost:
                    best, cost = j, score
            if best is not None:
                links.add((min(i, best), max(i, best)))
    # keep chains of three or more: a lone pair of specks is not a border
    parent = list(range(len(dashes)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a, b in links:
        parent[root(a)] = root(b)
    size = {}
    for i in range(len(dashes)):
        size[root(i)] = size.get(root(i), 0) + 1
    mask = np.zeros_like(ink)
    kept = [i for i in range(len(dashes)) if size[root(i)] >= 3]
    for i in kept:
        mask[lab == dashes[i]['id']] = 1
    degree = {i: 0 for i in kept}
    for a, b in links:
        if size[root(a)] >= 3:
            cv2.line(mask, tuple(np.round(dashes[a]['c']).astype(int)), tuple(np.round(dashes[b]['c']).astype(int)), 1, 3)
            degree[a] += 1; degree[b] += 1
    return mask, [(dashes[i], degree[i]) for i in kept]


def main():
    head, data = load_data()
    terr = data['territories']
    names = {t['name']: t['id'] for t in terr}
    rgb = np.asarray(life.source.resize((W, H), Image.Resampling.LANCZOS)).astype(np.int32)
    dark = (rgb.sum(axis=2) < 330).astype(np.uint8)

    # ---- water, and the inked banks that outline it
    layers = life.water_layers()
    up = lambda m: (cv2.resize(m.astype(np.uint8) * 255, (W, H), interpolation=cv2.INTER_LINEAR) > 127).astype(np.uint8)
    water, river = up(layers['water']), up(layers['river'])
    reach = water.copy()
    for _ in range(26):                       # the bank ink is whatever dark line touches the water
        reach = cv2.dilate(reach, np.ones((3, 3), np.uint8)) & (dark | water)
    bank = reach & (1 - water)
    bank = cv2.morphologyEx(bank | water, cv2.MORPH_CLOSE, disc(2)) & (1 - water)
    land = ((water | bank) == 0).astype(np.uint8)
    ink = dark & land

    # ---- printed lines: the dotted borders, and any other lone stroke (the thin upper rivers)
    dashes, chain = find_dashes(ink)
    # Of the rest of the ink only the large shapes matter: a long thin stroke is a line (the upper
    # course of a river), anything else that big is a mountain. Trees and lettering are ignored.
    n, lab, st, _ = cv2.connectedComponentsWithStats((ink & (1 - dashes)).astype(np.uint8), 8)
    kind = np.zeros(n, np.uint8)
    long_shape = np.zeros(n, np.uint8)
    for i in range(1, n):
        side, area = max(st[i, 2], st[i, 3]), st[i, 4]
        long_shape[i] = side >= 130                      # longer than any letter of a name
        if side >= 64 or area >= 1800:
            kind[i] = 1 if (area / side < 10 and side >= 110) else 2
        elif side >= 40:
            # a small mountain is open strokes; a tree is a closed outline round its foliage
            x, y, w, h = st[i, :4]
            piece = (lab[y:y + h, x:x + w] == i).astype(np.uint8)
            holes = ndimage.binary_fill_holes(piece).sum() - piece.sum()
            if holes < 0.6 * area:
                kind[i] = 2
    large = (kind[lab] > 0).astype(np.uint8)
    # a stroke running on its own, even where its far end joins a mountain, is a line
    sparse = cv2.blur(large.astype(np.float32), (121, 121)) < 0.11
    lone = ((kind[lab] == 1) | ((kind[lab] == 2) & sparse & (long_shape[lab] > 0))).astype(np.uint8)
    lone = cv2.morphologyEx(lone, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) | (kind[lab] == 1).astype(np.uint8)
    mountain = (large & (1 - lone)).astype(np.uint8)
    # a dotted line that stops just short of a river, the coast or another line is carried on to it
    stops = (water | bank | lone | dashes)
    for d, degree in chain:
        if degree >= 2:
            continue
        for sign in (1, -1):
            p0 = d['c'] + sign * d['u'] * (d['half'] + 3)
            for step in range(4, 46, 2):
                p = p0 + sign * d['u'] * step
                x, y = int(round(p[0])), int(round(p[1]))
                if not (0 <= x < W and 0 <= y < H):
                    break
                if stops[y, x] and np.hypot(*(p - d['c'])) > d['half'] + 5:
                    cv2.line(dashes, tuple(np.round(d['c']).astype(int)), (x, y), 1, 3)
                    break
    lines = ((dashes | lone) & land).astype(np.uint8)
    mass = (mountain & (1 - lines)).astype(np.float32)

    # ---- a landscape whose ridges are the borders
    d_line = ndimage.distance_transform_edt(lines == 0)
    e_line = np.exp(-d_line / 10.0)
    e_mass = 0.34 * (1 - np.exp(-cv2.GaussianBlur(mass, (0, 0), 17) / 0.11))      # never flat, so a range has one crest
    elev = np.maximum(e_line, e_mass).astype(np.float64)
    elev[land == 0] = 2.0

    # ---- every land floods outward from the lowest ground near its seed
    markers = np.zeros((H, W), np.int32)
    seeds = [(t['id'], SEED.get(t['name'], (t['sx'], t['sy']))) for t in terr] + [(names[n], (x, y)) for n, x, y in EXTRA_SEEDS]
    bottoms = {}
    for tid, (sx, sy) in seeds:
        x, y = int(sx * K), int(sy * K)
        for _ in range(4000):                        # walk downhill, away from every line
            y0, y1, x0, x1 = max(0, y - 3), min(H, y + 4), max(0, x - 3), min(W, x + 4)
            win = elev[y0:y1, x0:x1]
            j = np.unravel_index(win.argmin(), win.shape)
            ny, nx = y0 + j[0], x0 + j[1]
            if elev[ny, nx] >= elev[y, x] - 1e-12:
                break
            y, x = ny, nx
        for other, (ox, oy) in bottoms.items():
            if other != tid and np.hypot(ox - x, oy - y) < 14:
                print('SAME BASIN', terr[other]['name'], '/', terr[tid]['name'])
        bottoms.setdefault(tid, (x, y))
        cv2.circle(markers, (x, y), 6, tid + 1, -1)
    markers[land == 0] = 0
    labels = watershed(elev, markers, mask=land > 0)

    # islets and slivers no flood reached go to the nearest land, if it is close
    n, lab, st, _ = cv2.connectedComponentsWithStats(((labels == 0) & (land > 0)).astype(np.uint8), 8)
    if n > 1:
        dist, (iy, ix) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
        for i in range(1, n):
            ys, xs = np.nonzero(lab == i)
            k = dist[ys, xs].argmin()
            if st[i, 4] < 6000 and dist[ys[k], xs[k]] < 40:
                labels[ys, xs] = labels[iy[ys[k], xs[k]], ix[ys[k], xs[k]]]
            else:
                print('unowned land', int(st[i, 4]), 'px near', int(xs.mean() / K), int(ys.mean() / K))

    # ---- outlines: soften the pixel steps the same way on both sides of every border
    polygons = [[] for _ in terr]
    smooth = np.zeros((H, W), np.int32)
    for t in terr:
        m = (labels == t['id'] + 1).astype(np.uint8)
        if not m.any():
            print('NO AREA', t['name']); continue
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = max(0, ys.min() - 8), min(H, ys.max() + 9), max(0, xs.min() - 8), min(W, xs.max() + 9)
        crop = cv2.GaussianBlur(m[y0:y1, x0:x1].astype(np.float32), (0, 0), 1.7) > 0.5
        smooth[y0:y1, x0:x1][crop] = t['id'] + 1
        contours, _ = cv2.findContours(crop.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for c in contours:
            if cv2.contourArea(c) < 120:
                continue
            poly = cv2.approxPolyDP(c, 1.1, True).reshape(-1, 2)
            if len(poly) >= 3:
                polygons[t['id']].append([[round((x + x0) / K, 1), round((y + y0) / K, 1)] for x, y in poly.tolist()])
    labels = smooth

    # ---- neighbours: lands that touch, and lands that face each other across a river
    touch, facing, open_touch = {}, {}, {}
    high = e_mass > 0.12                                     # in the mountains
    for a, b, hi in ((labels[:, :-1], labels[:, 1:], high[:, :-1]), (labels[:-1, :], labels[1:, :], high[:-1, :])):
        ok = (a > 0) & (b > 0) & (a != b)
        pairs = np.stack([np.minimum(a[ok], b[ok]), np.maximum(a[ok], b[ok])], axis=1)
        for (p, q), c in zip(*np.unique(pairs, axis=0, return_counts=True)):
            touch[(int(p) - 1, int(q) - 1)] = touch.get((int(p) - 1, int(q) - 1), 0) + int(c)
        ok &= ~hi
        pairs = np.stack([np.minimum(a[ok], b[ok]), np.maximum(a[ok], b[ok])], axis=1)
        if len(pairs):
            for (p, q), c in zip(*np.unique(pairs, axis=0, return_counts=True)):
                open_touch[(int(p) - 1, int(q) - 1)] = open_touch.get((int(p) - 1, int(q) - 1), 0) + int(c)
    dist, (iy, ix) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
    nearest = np.where(dist <= 34, labels[iy, ix], 0)
    nearest[(river == 0) & (bank == 0) & (labels == 0) & (cv2.dilate(river, disc(9)) == 0)] = 0     # only rivers are crossed, never the sea
    for a, b in ((nearest[:, :-1], nearest[:, 1:]), (nearest[:-1, :], nearest[1:, :])):
        ok = (a > 0) & (b > 0) & (a != b)
        pairs = np.stack([np.minimum(a[ok], b[ok]), np.maximum(a[ok], b[ok])], axis=1)
        if len(pairs):
            for (p, q), c in zip(*np.unique(pairs, axis=0, return_counts=True)):
                facing[(int(p) - 1, int(q) - 1)] = facing.get((int(p) - 1, int(q) - 1), 0) + int(c)
    sea = {tuple(sorted(l)) for l in data.get('seaLinks', [])}
    old = {(t['id'], j) for t in terr for j in t['adj'] if t['id'] < j}
    # Neighbours are lands that share a printed border on open ground, or face each other across a
    # river. Where the only contact is along the crest of a mountain range the drawing does not say,
    # so there the map keeps the neighbours it already had.
    def near(k, reach=90):
        a_, b_ = (labels == k[0] + 1), (labels == k[1] + 1)
        if not a_.any() or not b_.any():
            return False
        ys, xs = np.nonzero(a_)
        y0, y1, x0, x1 = max(0, ys.min() - reach), min(H, ys.max() + reach), max(0, xs.min() - reach), min(W, xs.max() + reach)
        if not b_[y0:y1, x0:x1].any():
            return False
        return bool((ndimage.distance_transform_edt(~a_[y0:y1, x0:x1])[b_[y0:y1, x0:x1]] <= reach).any())
    new = set()
    for k in set(touch) | set(facing) | old:
        plain, river_bank = open_touch.get(k, 0), facing.get(k, 0) - touch.get(k, 0)
        if plain >= 40 or river_bank >= 40:
            new.add(k)
        elif k in old and (touch.get(k, 0) >= 1 or facing.get(k, 0) >= 12 or near(k)):
            new.add(k)
    new -= {tuple(sorted((names[a_], names[b_]))) for a_, b_ in NOT_NEIGHBOURS}
    nm = lambda k: f"{terr[k[0]]['name']} - {terr[k[1]]['name']}"
    report = dict(only_before=sorted(nm(k) for k in old - new - sea), only_now=sorted(nm(k) for k in new - old),
                  touch={nm(k): [v, open_touch.get(k, 0)] for k, v in touch.items()}, facing={nm(k): v for k, v in facing.items()})
    (OUT / 'neighbours.json').write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding='utf-8')
    print('neighbours before', len(old), 'now', len(new | sea))
    print('ONLY BEFORE', report['only_before'])
    print('ONLY NOW', report['only_now'])

    # ---- QA overlays
    np.save(OUT / 'labels.npy', labels.astype(np.int16))
    np.savez_compressed(OUT / 'layers.npz', dark=dark, bank=bank, water=water, lone=lone, mountain=mountain, dashes=dashes, kind=kind[lab].astype(np.uint8))
    vis = np.asarray(life.source.resize((W, H))).copy()
    rng = np.random.default_rng(11)
    colors = rng.integers(40, 235, (len(terr) + 1, 3))
    tint = colors[labels]
    on = labels > 0
    vis[on] = (vis[on] * 0.62 + tint[on] * 0.38).astype(np.uint8)
    edge = (cv2.morphologyEx(labels.astype(np.uint16), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0)
    vis[edge] = (255, 0, 200)
    vis[(dashes > 0) & ~edge] = (0, 90, 255)
    vis[(lone > 0) & ~edge] = (255, 140, 0)
    for t in terr:
        cv2.circle(vis, (int(t['lx'] * K), int(t['ly'] * K)), 7, (0, 255, 255), -1)
    Image.fromarray(vis).save(OUT / 'trace.jpg', quality=82)
    json.dump(dict(polygons=polygons, adjacency=sorted(list(k) for k in new)), open(OUT / 'result.json', 'w'))
    for t in terr:
        inside = labels[int(t['ly'] * K), int(t['lx'] * K)] == t['id'] + 1
        if not inside:
            print('TOKEN OUTSIDE', t['name'])
    moved = []
    for t in terr:
        m = (labels == t['id'] + 1).astype(np.uint8)
        inner = ndimage.distance_transform_edt(m)
        x, y = int(t['lx'] * K), int(t['ly'] * K)
        if inner[y, x] < 24:                      # closer than 12 map units to its own border
            room = np.minimum(inner, 40 + ndimage.distance_transform_edt(1 - (ink & m)) * 0.6)     # prefer clear ground
            y2, x2 = np.unravel_index((room * m).argmax(), m.shape)
            t['lx'], t['ly'] = round(x2 / K), round(y2 / K)
            moved.append(t['name'])
        t['polygons'] = polygons[t['id']]
    adjacency = [set() for _ in terr]
    for a_, b_ in new | sea:
        adjacency[a_].add(b_); adjacency[b_].add(a_)
    for t in terr:
        t['adj'] = sorted(adjacency[t['id']])
    if '--write' in sys.argv:
        DATA.write_text(head + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';' + chr(10), encoding='utf-8')
        print('WROTE', DATA.name, DATA.stat().st_size, 'bytes')
    print('troop points moved', moved)
    # the board must stay one piece
    seen, todo = {0}, [0]
    while todo:
        for j in adjacency[todo.pop()]:
            if j not in seen:
                seen.add(j); todo.append(j)
    print('connected', len(seen) == len(terr), 'fewest neighbours', min(len(a_) for a_ in adjacency))
    print('polygon points', sum(len(p) for t in terr for p in t['polygons']), 'connections', len(new | sea))


if __name__ == '__main__':
    main()
