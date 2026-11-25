import re, time, os, shutil, json
os.chdir(os.path.dirname(os.path.abspath(__file__)))
h = open('index.html', encoding='utf-8').read()
v = str(int(time.time()))
h2 = re.sub(r'(src|href)="((?:js|css)/[a-z0-9-]+\.(?:js|css))"', lambda m: f'{m.group(1)}="{m.group(2)}?v={v}"', h)

# The score: its pieces live once, in docs/assets/music (see tools/split_score.py). Each page is told
# where they are from its own folder; the game shuffles them.
docs = 'docs'; music = os.path.join(docs, 'assets', 'music')
tracks = sorted(f for f in os.listdir(music) if f.lower().endswith('.mp3')) if os.path.isdir(music) else []


def page(base):
    body = h2.replace('<script', f'<script>window.MUSIC = {json.dumps({"base": base, "tracks": tracks})};</script>\n<script', 1) if tracks else h2
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + body + '\n</html>'


open('play.html', 'w', encoding='utf-8', newline='\n').write(page('docs/assets/music/'))
print('built', v, '-', len(tracks), 'pieces of music')

# GitHub Pages bundle: a self-contained copy in docs/ (index.html with a doctype + js, css, assets).
# Everything in it is rebuilt except the music, which is kept where it is.
os.makedirs(os.path.join(docs, 'assets'), exist_ok=True)
for name in os.listdir(docs):
    path = os.path.join(docs, name)
    if name == 'assets': continue
    shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
for name in os.listdir(os.path.join(docs, 'assets')):
    path = os.path.join(docs, 'assets', name)
    if name == 'music': continue
    shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
open(os.path.join(docs, 'index.html'), 'w', encoding='utf-8', newline='\n').write(page('assets/music/'))
for d in ('js', 'css'):
    shutil.copytree(d, os.path.join(docs, d))
for f in os.listdir('assets'):
    if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.svg')):
        shutil.copy2(os.path.join('assets', f), os.path.join(docs, 'assets', f))
open(os.path.join(docs, '.nojekyll'), 'w').close()
print('docs bundle ready')
