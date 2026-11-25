"""Split the long score into its pieces, for the in-game playlist.

    python tools/split_score.py "path/to/score.mp3"

The cuts sit in the pauses between pieces (found from the loudness of the recording). Each piece is
trimmed of dead air, given a short fade at both ends and written to docs/assets/music/NN.mp3, which is
the only copy kept in the repository: build.py leaves that folder alone and lists it for the game.
"""
import os, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'assets', 'music')
try:
    import imageio_ffmpeg; FF = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FF = 'ffmpeg'

# pauses between pieces, in seconds from the start
CUTS = [98.6, 188.2, 300.5, 619.6, 888.4, 1020.6, 1207.1, 1575.6, 1777.4, 1983.1, 2130.4, 2454.4,
        2715.8, 2812.9, 3270.1, 3460.6, 3686.2, 3930.3, 4201.1, 4314.7, 4764.1]
QUIET = -42.0      # dBFS: below this the pause counts as dead air
SR = 8000


def envelope(src):
    raw = subprocess.run([FF, '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    hop = SR // 10; n = len(x) // hop
    return 20 * np.log10(np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-12)), len(x) / SR


def main():
    src = sys.argv[1]
    db, total = envelope(src)
    n = len(db)

    def pause(t):
        """the quiet stretch round a cut: (where the music stops, where it starts again)"""
        i = min(n - 1, int(round(t * 10))); a = b = i
        if db[i] >= QUIET:                      # the cut is beside the pause rather than in it
            near = [j for j in range(max(0, i - 15), min(n, i + 16)) if db[j] < QUIET]
            if not near: return t, t
            a = b = min(near, key=lambda j: abs(j - i))
        while a > 0 and db[a - 1] < QUIET: a -= 1
        while b < n - 1 and db[b + 1] < QUIET: b += 1
        return a / 10, (b + 1) / 10

    # leading and trailing silence of the whole recording
    lead = 0
    while lead < n and db[lead] < QUIET: lead += 1
    tail = n
    while tail > 0 and db[tail - 1] < QUIET: tail -= 1
    edges = [(None, lead / 10)] + [pause(t) for t in CUTS] + [(min(total, tail / 10 + 1.2), None)]

    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.lower().endswith('.mp3'): os.remove(os.path.join(OUT, f))
    for k in range(len(edges) - 1):
        start = max(0.0, edges[k][1] - 0.25)
        stop = min(total, edges[k + 1][0] + (0.9 if k < len(edges) - 2 else 0))
        dur = stop - start; fade = min(1.4, dur / 4)
        out = os.path.join(OUT, f'{k + 1:02d}.mp3')
        subprocess.run([FF, '-v', 'error', '-y', '-ss', f'{start:.3f}', '-t', f'{dur:.3f}', '-i', src, '-vn', '-map_metadata', '-1',
                        '-af', f'afade=t=in:d=0.12,afade=t=out:st={dur - fade:.3f}:d={fade:.3f}',
                        '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', out], check=True)
        print(f'{k + 1:02d}  {int(start // 60)}:{start % 60:04.1f} -> {int(stop // 60)}:{stop % 60:04.1f}  {dur / 60:.2f} min  {os.path.getsize(out) / 1e6:.1f} MB', flush=True)
    print('pieces', len(edges) - 1, 'in', OUT)


if __name__ == '__main__':
    main()
