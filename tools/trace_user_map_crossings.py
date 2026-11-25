"""Which lands can attack which, and which region each belongs to: read from the drawing.

    python tools/trace_user_map_crossings.py            # report + QA picture, changes nothing
    python tools/trace_user_map_crossings.py --write    # rewrite neighbours, regions and sea lanes in js/user-map-data.js

Run it after trace_user_map_borders.py --write (it uses that tool's outlines in output/borders).

The rule, as the rulebook of the game states it: lands are adjacent if they share a border, or a
sea-line joins them. Mountains and rivers are impassable, so lands separated by mountains are not
adjacent, nor are lands separated by a river unless a bridge crosses it.
  * dotted borders are found by the tool (they always lie inside one region);
  * borders drawn as a solid line with neither water nor peaks on them are borders like any other
    (they mark where two regions meet); they are listed in SOLID;
  * bridges and gates are listed by hand, read off the drawing;
  * every other contact between two lands is a river or a mountain range, and is closed.
REGION_OF corrects the region of the lands the first trace guessed wrong (the drawing tints each
region differently, and the dotted borders never cross from one region to another).
"""
import json, sys
from pathlib import Path
import numpy as np, cv2
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import trace_user_map_borders as tb          # noqa: E402
import trace_user_map_life as life           # noqa: E402

OUT = ROOT / 'output' / 'borders'

# (x, y) on the 2000-wide map, and the two lands the crossing joins
BRIDGES = [
    (489, 614, 'Lune Valley', 'Tower Hills'), (678, 940, 'The Shire', 'Buckland'), (1064, 829, 'Weather Hills', 'Rhudaur'),
    (1120, 922, 'Eregion', 'Rhudaur'), (828, 1295, 'Dunland', 'Minhiriath'), (979, 1287, 'Dunland', 'Eregion'),
    (762, 1416, 'Minhiriath', 'Enedwaith'), (1434, 770, 'Carrock', 'Anduin Valley'), (1551, 756, 'North Mirkwood', 'Eastern Mirkwood'),
    (1614, 704, 'North Mirkwood', 'Esgaroth'), (1846, 1040, 'South Rhûn', 'Brown Lands'), (1409, 1099, 'Anduin Valley', 'Gladden Fields'),
    (927, 1861, 'Enedwaith', 'Gap of Rohan'), (1272, 1906, 'The Wold', 'Gap of Rohan'), (1451, 1759, 'The Wold', 'Emyn Muil'),
    (1316, 2388, 'Minas Tirith', 'Ithilien'), (1421, 2923, 'Harondor', 'Harad'), (1217, 3110, 'Umbar', 'Far Harad'),
]
GATES = [
    (1520, 2185, 'Dead Marshes', 'Udûn'),     # the Morannon, the Black Gate, set in the mountain wall
]
# borders drawn as a solid line on open ground: where two regions meet without a river or a range
SOLID = [
    ('Forodwaith', 'North Rhûn'), ('Forodwaith', 'Withered Heath'), ('Eastern Angmar', 'Carrock'), ('Borderlands', 'Lune Valley'),
    ('Borderlands', 'Evendim Hills'), ('South Downs', 'Minhiriath'), ('Rhudaur', 'Carrock'), ('Eregion', 'Moria'), ('Lórien', 'Fangorn'),
    ('Fangorn', 'The Wold'), ('Emyn Muil', 'South Mirkwood'), ('Brown Lands', 'Eastern Mirkwood'), ('Brown Lands', 'South Mirkwood'),
    ('West Rohan', 'Drúwaith Iaur'), ('Gap of Rohan', 'Minas Tirith'), ('Dead Marshes', 'Ithilien'), ('Ithilien', 'Minas Morgul'),
    ('South Ithilien', 'Harondor'),
]
# sea lanes printed on the drawing that the first trace missed
SEA_LANES = [('Minhiriath', 'Umbar')]
# the region of each land the first trace put in the wrong one
REGION_OF = {'Carrock': 'Mirkwood', 'Esgaroth': 'Rhûn', 'Rhûn Hills': 'Rhovanion', 'The Wold': 'Rhovanion', 'Eregion': 'Rohan'}
LEAST = 60        # length of dotted border, in pixels of the 2x trace, for two lands to be neighbours


def main():
    head, data = tb.load_data(); terr = data['territories']; N = len(terr); ID = {t['name']: t['id'] for t in terr}
    labels = np.load(OUT / 'labels.npy').astype(np.int32); H, W = labels.shape; K = W / data['width']
    L = np.load(OUT / 'layers.npz'); d = tb.disc
    dotted = cv2.dilate(L['dashes'].astype(np.uint8), d(7)) > 0
    key = lambda a, b: (min(ID[a], ID[b]), max(ID[a], ID[b]))
    solid = {key(a, b) for a, b in SOLID}

    # ---- borders: how much of each one is a dotted line
    tot, clear = {}, {}
    code_map = np.full((H, W), -1, np.int32)
    for a, b, sl in ((labels[:, :-1], labels[:, 1:], (slice(None), slice(0, W - 1))), (labels[:-1, :], labels[1:, :], (slice(0, H - 1), slice(None)))):
        ok = (a > 0) & (b > 0) & (a != b); m = dotted[sl]
        code = (np.minimum(a, b) - 1) * 100 + np.maximum(a, b) - 1
        for c, k in zip(*np.unique(code[ok], return_counts=True)): tot[int(c)] = tot.get(int(c), 0) + int(k)
        for c, k in zip(*np.unique(code[ok & m], return_counts=True)): clear[int(c)] = clear.get(int(c), 0) + int(k)
        code_map[sl][ok] = code[ok]
    pair = lambda c: (c // 100, c % 100)
    land = {pair(c) for c, k in clear.items() if k >= LEAST} | solid
    bridges = {key(a, b) for _, _, a, b in BRIDGES}; gates = {key(a, b) for _, _, a, b in GATES}
    for a_, b_ in SEA_LANES:
        if sorted((ID[a_], ID[b_])) not in [sorted(l) for l in data['seaLinks']]: data['seaLinks'].append([ID[a_], ID[b_]])
    sea = {tuple(sorted(l)) for l in data.get('seaLinks', [])}
    new = land | bridges | gates | sea
    rid = {r['name']: r['id'] for r in data['regions']}
    for name, region in REGION_OF.items(): terr[ID[name]]['region'] = rid[region]
    print('lands per region', {r['name']: sum(t['region'] == r['id'] for t in terr) for r in data['regions']})
    old = {(t['id'], j) for t in terr for j in t['adj'] if t['id'] < j}
    nm = lambda k: f"{terr[k[0]]['name']} - {terr[k[1]]['name']}"

    print('neighbours before', len(old), 'now', len(new), '| dotted', len(land - solid), 'solid', len(solid), '| by land', len(land), 'bridges', len(bridges - land), 'gates', len(gates - land), 'sea lanes', len(sea))
    print('bridge or gate between lands that already touch on open ground:', sorted(nm(k) for k in (bridges | gates) & land))
    print('NEW:', sorted(nm(k) for k in new - old))
    shut = []
    for k in sorted(old - new):
        c = k[0] * 100 + k[1]; t = tot.get(c, 0)
        shut.append((nm(k), 'river without a bridge' if t < 40 else f'mountains (dotted {clear.get(c, 0)} of {t})'))
    print('NO LONGER NEIGHBOURS', len(shut))
    for a, why in shut: print(f'  {a:40s} {why}')
    adj = {i: set() for i in range(N)}
    for a, b in new: adj[a].add(b); adj[b].add(a)
    seen = {0}; todo = [0]
    while todo:
        for j in adj[todo.pop()]:
            if j not in seen: seen.add(j); todo.append(j)
    print('board connected:', len(seen) == N, [terr[i]['name'] for i in range(N) if i not in seen])
    print('lands with one way in:', sorted(terr[i]['name'] for i in range(N) if len(adj[i]) == 1))
    reg = {}
    for t in terr: reg.setdefault(t['region'], []).append(t['id'])
    for r, ids in sorted(reg.items()):
        ent = sorted({nm((min(a, b), max(a, b))) for a in ids for b in adj[a] if b not in ids})
        print(f"  {data['regions'][r]['name']:11s} +{data['regions'][r]['bonus']}  ways in {len(ent)}: " + '; '.join(ent))
    assert len(seen) == N, 'the board must stay in one piece'

    # ---- QA picture: open borders green, mountain borders red, crossings ringed
    src = np.asarray(life.source.convert('RGB')); s = 2400 / src.shape[1]
    qa = cv2.resize(src, (2400, int(src.shape[0] * s)), interpolation=cv2.INTER_AREA).copy(); f = qa.shape[1] / W
    open_codes = np.array(sorted(k[0] * 100 + k[1] for k in land)); has = code_map >= 0
    edge_open = has & np.isin(code_map, open_codes); edge_shut = has & ~edge_open
    for mask, col in ((edge_shut, (230, 30, 30)), (edge_open, (20, 170, 60))):
        m = cv2.resize(cv2.dilate(mask.astype(np.uint8), d(3)), (qa.shape[1], qa.shape[0]), interpolation=cv2.INTER_AREA) > 0
        qa[m] = col
    g = qa.shape[1] / data['width']
    for x, y, a, b in BRIDGES: cv2.circle(qa, (int(x * g), int(y * g)), 22, (255, 215, 0), 5)
    for x, y, a, b in GATES: cv2.circle(qa, (int(x * g), int(y * g)), 26, (0, 230, 255), 5)
    Image.fromarray(qa).save(OUT / 'crossings.jpg', quality=86)
    (OUT / 'crossings.json').write_text(json.dumps(dict(shut=shut, new=sorted(nm(k) for k in new - old)), indent=1, ensure_ascii=False), encoding='utf-8')

    # lands that look like neighbours and are not: the game says why when a player tries
    wall = {pair(c) for c, k in tot.items() if k >= 40} - new - {key('Emyn Muil', 'Anduin Valley')}     # those two meet at a river mouth, not in the hills
    faced = json.loads((OUT / 'neighbours.json').read_text(encoding='utf-8'))['facing']
    water_between = {key(*n.split(' - ')) for n, v in faced.items() if v >= 40} - new - wall
    print('barriers: mountains', len(wall), 'rivers', len(water_between))

    if '--write' in sys.argv:
        for t in terr: t['adj'] = sorted(adj[t['id']])
        data['barriers'] = [[a, b, 'mountains'] for a, b in sorted(wall)] + [[a, b, 'river'] for a, b in sorted(water_between)]
        data['crossings'] = [dict(kind='bridge', x=x, y=y, a=ID[a], b=ID[b]) for x, y, a, b in BRIDGES] + [dict(kind='gate', x=x, y=y, a=ID[a], b=ID[b]) for x, y, a, b in GATES]
        tb.DATA.write_text(head + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';' + chr(10), encoding='utf-8')
        print('written', tb.DATA)


if __name__ == '__main__':
    main()
