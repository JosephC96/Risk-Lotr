import re, time, os, shutil
os.chdir(os.path.dirname(os.path.abspath(__file__)))
h = open('index.html', encoding='utf-8').read()
v = str(int(time.time()))
h2 = re.sub(r'(src|href)="((?:js|css)/[a-z0-9-]+\.(?:js|css))"', lambda m: f'{m.group(1)}="{m.group(2)}?v={v}"', h)
page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + h2 + '\n</html>'
open('play.html', 'w', encoding='utf-8', newline='\n').write(page)
print('built', v)

# GitHub Pages bundle: a self-contained copy in docs/ (index.html with a doctype + js, css, assets)
docs = 'docs'
if os.path.isdir(docs): shutil.rmtree(docs)
os.makedirs(docs)
open(os.path.join(docs, 'index.html'), 'w', encoding='utf-8', newline='\n').write(page)
for d in ('js', 'css'):
    shutil.copytree(d, os.path.join(docs, d))
os.makedirs(os.path.join(docs, 'assets'))
for f in os.listdir('assets'):
    if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.svg')):
        shutil.copy2(os.path.join('assets', f), os.path.join(docs, 'assets', f))
open(os.path.join(docs, '.nojekyll'), 'w').close()
print('docs bundle ready')
