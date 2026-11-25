/* Sound effects, the recorded score and a synthesised fallback (WebAudio).
   Buses: effects and synthesised music each have their own gain and share a generated hall reverb.
   Music, in order of preference:
     1. a file the player picks in the Menu, played on a loop (kept in this browser only, never uploaded);
     2. the original score: the pieces listed in window.MUSIC, played one after another in a shuffled
        order that changes every time round;
     3. the synthesised score, when neither is there or a recording cannot be played. */
(function (G) {
  let ctx = null, master = null, sfxBus = null, musBus = null, rev = null, on = true, ambient = null;
  const vol = { sfx: 0.8, music: 0.55 };
  const mus = { on: false, timer: null, next: 0, bar: 0, tension: 0, tensionT: 0, nodes: new Set() };
  const rec = { url: '', name: '', kind: null, id: '', list: null, order: [], at: 0, fails: 0, el: null, gain: null, on: false, saver: null, stopT: null };
  const GRAPH = location.protocol !== 'file:';   // a page opened from disk may not route a file through WebAudio
  const TRACK_GAIN = 0.75, POS_KEY = 'mearth.trackpos', LAST_KEY = 'mearth.lastpiece';

  /* ---------- recorded music ---------- */
  const store = {
    open() { return new Promise((res, rej) => { const r = indexedDB.open('mearth-audio', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async run(mode, fn) { const db = await store.open(); try { return await new Promise((res, rej) => { const tx = db.transaction('kv', mode), rq = fn(tx.objectStore('kv')); tx.oncomplete = () => res(rq.result); tx.onerror = tx.onabort = () => rej(tx.error); }); } finally { db.close(); } },
    get: k => store.run('readonly', s => s.get(k)), set: (k, v) => store.run('readwrite', s => s.put(v, k)), del: k => store.run('readwrite', s => s.delete(k)),
  };
  // a fresh order for the pieces; it never opens with the piece that was heard last
  function shuffle(last) {
    const n = rec.list.length, o = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    if (n > 1 && o[0] === last) [o[0], o[1]] = [o[1], o[0]];
    rec.order = o; rec.at = 0;
  }
  function swap(set) {
    const playing = rec.on || mus.on; if (playing) S.music(false);
    if (rec.el) { try { rec.el.pause(); rec.el.removeAttribute('src'); rec.el.load(); } catch (e) {} }
    if (rec.url && rec.kind === 'file') { try { URL.revokeObjectURL(rec.url); } catch (e) {} }
    rec.url = ''; rec.name = ''; rec.kind = null; rec.id = ''; rec.list = null; rec.fails = 0; set();
    if (playing && S.wantMusic) S.music(true);
  }
  function useFile(url, name, id) { swap(() => { rec.url = url; rec.name = name; rec.kind = 'file'; rec.id = id; }); }
  function useScore() {
    swap(() => {
      const M = window.MUSIC; if (!M || !M.tracks || !M.tracks.length) return;
      rec.list = M.tracks.map(t => (M.base || '') + t); rec.kind = 'score'; rec.name = 'Original score'; rec.id = 'score';
      let last = -1; try { last = +localStorage.getItem(LAST_KEY); } catch (e) {} shuffle(isFinite(last) ? last : -1); rec.url = rec.list[rec.order[0]];
    });
  }
  function trackVolume(fade) {
    const v = vol.music * TRACK_GAIN;
    if (rec.gain) rec.gain.gain.setTargetAtTime(rec.on ? v : 0.0001, ctx.currentTime, fade || 0.05); else if (rec.el) rec.el.volume = rec.on ? Math.min(1, v) : 0;
  }
  function savePos() { try { if (rec.kind === 'file' && rec.el && rec.on && rec.el.currentTime > 0) localStorage.setItem(POS_KEY, JSON.stringify({ id: rec.id, t: Math.floor(rec.el.currentTime) })); } catch (e) {} }
  function start(a) { const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); }
  // the next piece of the score; after the last one the order is shuffled again
  function advance() {
    if (rec.kind !== 'score' || !rec.el) return;
    const was = rec.order[rec.at]; if (++rec.at >= rec.order.length) shuffle(was);
    rec.url = rec.list[rec.order[rec.at]]; rec.el.src = rec.url; if (rec.on && !document.hidden) start(rec.el);
  }
  // no recording can be played: the synthesised score takes over
  function giveUp() { const was = rec.on; rec.url = ''; rec.kind = null; rec.list = null; rec.on = false; clearInterval(rec.saver); if (was && S.wantMusic) S.music(true); }
  function playTrack() {
    let a = rec.el;
    if (!a) {
      a = rec.el = new Audio(); a.preload = 'auto';
      a.addEventListener('ended', advance);
      a.addEventListener('playing', () => { rec.fails = 0; if (rec.kind === 'score') { try { localStorage.setItem(LAST_KEY, rec.order[rec.at]); } catch (e) {} } });
      // a piece that will not load is skipped; a file of the player's own that will not load is dropped
      a.addEventListener('error', () => { if (!a.getAttribute('src')) return; if (rec.kind === 'score' && ++rec.fails < 3) advance(); else giveUp(); });
      if (GRAPH) { try { const n = ctx.createMediaElementSource(a); rec.gain = ctx.createGain(); rec.gain.gain.value = 0.0001; n.connect(rec.gain); rec.gain.connect(ctx.destination); } catch (e) { rec.gain = null; } }
    }
    clearTimeout(rec.stopT); a.loop = rec.kind === 'file';
    if (a.getAttribute('src') !== rec.url) {
      a.src = rec.url;
      // a long file of the player's own carries on from where it was left
      if (rec.kind === 'file') { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (p && p.id === rec.id && p.t > 5) a.addEventListener('loadedmetadata', () => { if (isFinite(a.duration) && p.t < a.duration - 20) a.currentTime = p.t; }, { once: true }); } catch (e) {} }
    }
    rec.on = true; trackVolume(1.2); start(a);
    clearInterval(rec.saver); rec.saver = setInterval(savePos, 5000);
  }
  function stopTrack() {
    if (!rec.on) return; savePos(); rec.on = false; clearInterval(rec.saver); trackVolume(0.25);
    const a = rec.el; clearTimeout(rec.stopT); rec.stopT = setTimeout(() => { if (!rec.on && a) a.pause(); }, 900);
  }
  function impulse(dur, decay) {
    const n = Math.ceil(ctx.sampleRate * dur), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { const k = i / n; lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * k); d[i] = lp * Math.pow(1 - k, decay) * (i < 400 ? i / 400 : 1); }
    }
    return b;
  }
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended' && !document.hidden) ctx.resume(); return ctx; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx * 0.7; sfxBus.connect(master);
    musBus = ctx.createGain(); musBus.gain.value = vol.music * 0.55; musBus.connect(master);
    rev = ctx.createConvolver(); rev.buffer = impulse(3.2, 2.4);
    const wet = ctx.createGain(); wet.gain.value = 0.85; rev.connect(wet); wet.connect(master);
    const s1 = ctx.createGain(); s1.gain.value = 0.2; sfxBus.connect(s1); s1.connect(rev);
    const s2 = ctx.createGain(); s2.gain.value = 0.55; musBus.connect(s2); s2.connect(rev);
    return ctx;
  }
  function noiseBuf(dur) {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
  }
  function env(g, t, a, peak, dec) { peak = Math.max(peak, 0.0005); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function click(t, f, q, v, dur, type, out) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf(dur + 0.02);
    const bp = ctx.createBiquadFilter(); bp.type = type || 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = ctx.createGain(); env(g, t, 0.002, v, dur);
    s.connect(bp); bp.connect(g); g.connect(out || sfxBus); s.start(t); s.stop(t + dur + 0.05);
    return bp;
  }
  function tone(t, f, type, v, a, dec, f2, out) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
    const g = ctx.createGain(); env(g, t, a, v, dec); o.connect(g); g.connect(out || sfxBus); o.start(t); o.stop(t + a + dec + 0.05);
    return o;
  }
  function sweep(t, f1, f2, q, v, dur, out) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf(dur + 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(f1, t); bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0005), t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp); bp.connect(g); g.connect(out || sfxBus); s.start(t); s.stop(t + dur + 0.05);
  }
  function drumHit(t, v, f, out) { tone(t, f || 92, 'sine', v, 0.004, 0.42, (f || 92) * 0.46, out); click(t, 180, 0.7, v * 0.5, 0.09, 'lowpass', out); }
  function brass(t, f, v, len, out) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7; lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(1500, t + Math.min(0.28, len * 0.4)); lp.frequency.linearRampToValueAtTime(620, t + len);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0005), t + 0.09); g.gain.setValueAtTime(v, t + len * 0.72); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    [0, -5, 6].forEach(c => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = c; o.frequency.setValueAtTime(f * 0.955, t); o.frequency.linearRampToValueAtTime(f, t + 0.11); o.connect(lp); o.start(t); o.stop(t + len + 0.05); });
    lp.connect(g); g.connect(out || sfxBus);
  }
  function bell(t, f, v, dec) { [[1, 1], [2.01, 0.42], [2.99, 0.2], [4.2, 0.1]].forEach(([m, k]) => tone(t, f * m, 'sine', v * k, 0.004, dec / Math.sqrt(m))); }

  /* ---------------- score ---------------- */
  // D minor, slow and wide. Each bar: a pad chord, a bass note and (sometimes) a lyre phrase.
  const N = n => 440 * Math.pow(2, (n - 69) / 12);
  const BARS = [[38, [62, 65, 69, 76]], [34, [58, 65, 69, 74]], [41, [60, 65, 69, 72]], [36, [60, 64, 67, 74]],
                [38, [62, 65, 69, 72]], [31, [58, 62, 67, 70]], [34, [58, 62, 65, 69]], [33, [57, 64, 69, 73]]];
  const SCALE = [62, 64, 65, 67, 69, 72, 74, 76, 77, 79, 81];
  const PHRASES = [[[0, 4], [1, 6], [2, 5], [4, 4], [6, 2]], [[0, 7], [1.5, 6], [3, 4], [5, 5]], [[0.5, 2], [2, 4], [3, 5], [4, 6], [6, 4]], [[0, 9], [2, 8], [3, 6], [6, 7]], [[1, 4], [3, 2], [4, 0]], []];
  const BAR = 7.2, BEAT = BAR / 8;
  function track(n, until) { mus.nodes.add(n); n.onended = () => mus.nodes.delete(n); n.stop(until); }
  function padNote(t, f, v) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4; lp.frequency.setValueAtTime(420, t); lp.frequency.linearRampToValueAtTime(980, t + BAR * 0.5); lp.frequency.linearRampToValueAtTime(460, t + BAR + 2.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 2.6); g.gain.setValueAtTime(v, t + BAR - 0.6); g.gain.linearRampToValueAtTime(0.0001, t + BAR + 3);
    [-7, 7].forEach(c => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c; o.connect(lp); o.start(t); track(o, t + BAR + 3.1); });
    lp.connect(g); g.connect(musBus);
  }
  function pluck(t, f, v) {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    const g2 = ctx.createGain(); g2.gain.value = 0.25; o.connect(g); o2.connect(g2); g2.connect(g); g.connect(musBus); o.start(t); o2.start(t); track(o, t + 2.5); track(o2, t + 2.5);
  }
  function scheduleBar(t) {
    const [root, chord] = BARS[mus.bar % BARS.length];
    chord.forEach((n, i) => padNote(t + i * 0.05, N(n - 12), 0.034 - i * 0.004));
    const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = N(root);
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.15, t + 1.4); bg.gain.setValueAtTime(0.15, t + BAR - 0.8); bg.gain.linearRampToValueAtTime(0.0001, t + BAR + 1.6);
    b.connect(bg); bg.connect(musBus); b.start(t); track(b, t + BAR + 1.7);
    if (mus.bar % 2 === 0 || Math.random() < 0.45) {
      const ph = PHRASES[(Math.random() * PHRASES.length) | 0], shift = Math.random() < 0.3 ? 2 : 0;
      ph.forEach(([beat, deg]) => pluck(t + beat * BEAT + Math.random() * 0.03, N(SCALE[Math.min(SCALE.length - 1, deg + shift)]), 0.07 + Math.random() * 0.03));
    }
    // the war drums come in when armies are on the move
    if (mus.tension > 0.08) {
      const v = 0.3 * mus.tension;
      [0, 3, 4, 6, 7].forEach((s, i) => drumHit(t + s * BEAT, v * (i === 0 ? 1 : 0.62), i === 0 ? 74 : 96, musBus));
      if (mus.tension > 0.6) [1.5, 5.5].forEach(s => click(t + s * BEAT, 2400, 1.2, v * 0.2, 0.05, 'bandpass', musBus));
    }
    mus.bar++;
  }
  function pump() {
    if (!mus.on || !ctx || ctx.state !== 'running') return;
    if (mus.next < ctx.currentTime) mus.next = ctx.currentTime + 0.15;
    while (mus.next < ctx.currentTime + 1.5) { mus.tension += (mus.tensionT - mus.tension) * 0.6; scheduleBar(mus.next); mus.next += BAR; }
  }

  const S = {
    dice(n = 3) { if (!on || !ensure()) return; const t = ctx.currentTime; for (let i = 0; i < 7 + n * 2; i++) click(t + i * 0.045 + Math.random() * 0.03, 1800 + Math.random() * 2600, 6, 0.3 * (1 - i / 16), 0.04); tone(t + 0.36, 210, 'sine', 0.16, 0.003, 0.1, 120); tone(t + 0.47, 180, 'sine', 0.1, 0.003, 0.09, 110); },
    clash() { if (!on || !ensure()) return; const t = ctx.currentTime; click(t, 3600, 1.4, 0.42, 0.22, 'highpass'); [1320, 1874, 2637, 3310].forEach((f, i) => tone(t + i * 0.004, f, 'triangle', 0.09 / (i + 1), 0.002, 0.5 + i * 0.1, f * 0.985)); tone(t, 160, 'sine', 0.22, 0.003, 0.14, 70); },
    thud() { if (!on || !ensure()) return; const t = ctx.currentTime; tone(t, 150, 'sine', 0.42, 0.004, 0.16, 62); click(t, 520, 1, 0.14, 0.05); },
    drum(n = 1) { if (!on || !ensure()) return; const t = ctx.currentTime; for (let i = 0; i < n; i++) drumHit(t + i * 0.22, 0.6 - i * 0.08, 88 - i * 4); },
    coin() { if (!on || !ensure()) return; const t = ctx.currentTime; bell(t, 1318, 0.1, 0.5); bell(t + 0.08, 1760, 0.1, 0.7); },
    horn() {
      if (!on || !ensure()) return; const t = ctx.currentTime;
      brass(t, 146.8, 0.11, 1.5); brass(t + 0.03, 220, 0.085, 1.45); brass(t + 0.02, 73.4, 0.1, 1.5);
      drumHit(t, 0.5, 70); drumHit(t + 0.42, 0.3, 86);
    },
    conquer() {
      if (!on || !ensure()) return; const t = ctx.currentTime;
      drumHit(t, 0.62, 66); sweep(t, 900, 6000, 0.8, 0.14, 0.5);
      [[293.7, 0], [370, 0.11], [440, 0.22], [587.3, 0.34]].forEach(([f, d], i) => brass(t + d, f, 0.075, i === 3 ? 0.9 : 0.3));
    },
    lose() { if (!on || !ensure()) return; const t = ctx.currentTime; brass(t, 196, 0.07, 0.5); brass(t + 0.24, 155.6, 0.07, 0.8); },
    card() { if (!on || !ensure()) return; const t = ctx.currentTime; sweep(t, 2400, 6500, 1.2, 0.2, 0.16); click(t + 0.13, 900, 1.4, 0.2, 0.05); },
    page() { if (!on || !ensure()) return; const t = ctx.currentTime; sweep(t, 1400, 4200, 0.9, 0.11, 0.2); sweep(t + 0.06, 3000, 1700, 1.1, 0.07, 0.16); },
    whoosh() { if (!on || !ensure()) return; const t = ctx.currentTime; sweep(t, 300, 2600, 0.7, 0.2, 0.55); },
    arrows(n = 3) { if (!on || !ensure()) return; const t = ctx.currentTime; for (let i = 0; i < n; i++) { const d = i * 0.05 + Math.random() * 0.04; sweep(t + d, 5200, 1500, 3, 0.1, 0.28); click(t + d + 0.33, 700, 2, 0.16, 0.05); } },
    stamp() { if (!on || !ensure()) return; const t = ctx.currentTime; drumHit(t, 0.7, 105); click(t, 1500, 0.8, 0.3, 0.06); },
    region() { if (!on || !ensure()) return; const t = ctx.currentTime; [[587.3, 0], [880, 0.14], [1174.7, 0.28], [1480, 0.42]].forEach(([f, d]) => bell(t + d, f, 0.09, 1.8)); brass(t, 146.8, 0.06, 1.3); },
    eliminated() { if (!on || !ensure()) return; const t = ctx.currentTime; tone(t, 62, 'sine', 0.5, 0.01, 2.6, 49); click(t, 260, 0.5, 0.3, 1.4, 'lowpass'); brass(t + 0.05, 110, 0.08, 1.1); brass(t + 0.6, 87.3, 0.08, 1.6); },
    victory() {
      if (!on || !ensure()) return; const t = ctx.currentTime;
      [[293.7, 0, 0.3], [293.7, 0.3, 0.16], [370, 0.46, 0.3], [440, 0.78, 0.34], [587.3, 1.14, 0.9], [493.9, 2.06, 0.3], [587.3, 2.4, 1.8]].forEach(([f, d, l]) => { brass(t + d, f, 0.085, l + 0.12); brass(t + d, f / 2, 0.06, l + 0.12); });
      [0, 1.14, 2.4].forEach(d => drumHit(t + d, 0.6, 66)); sweep(t + 2.3, 1200, 7000, 0.6, 0.16, 1.2);
      [587.3, 880, 1174.7].forEach((f, i) => bell(t + 2.45 + i * 0.09, f, 0.07, 2.4));
    },
    march() { if (!on || !ensure()) return; const t = ctx.currentTime; for (let i = 0; i < 4; i++) { click(t + i * 0.1, 260 + i * 30, 1.6, 0.22, 0.06); } drumHit(t + 0.02, 0.22, 110); },
    ui(kind) {
      if (!on || !ctx || ctx.state !== 'running') return; const t = ctx.currentTime;
      if (kind === 'hover') click(t, 3100, 5, 0.035, 0.02);
      else if (kind === 'back') { click(t, 1200, 2.5, 0.12, 0.035); tone(t, 300, 'sine', 0.07, 0.002, 0.07, 190); }
      else { click(t, 1900, 2.5, 0.14, 0.03); tone(t, 340, 'sine', 0.09, 0.002, 0.07, 240); }
    },
    ambient(enable) {
      if (!ensure()) return;
      if (!enable || !on || (rec.url && S.wantMusic)) { if (ambient) { ambient.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6); const a = ambient; setTimeout(() => { try { a.src.stop(); a.lfo.stop(); } catch (e) {} }, 2500); ambient = null; } return; }
      if (ambient) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf(4); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 3);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      src.connect(lp); lp.connect(g); g.connect(musBus); src.start();
      ambient = { src, lfo, g };
    },
    music(enable) {
      if (!ensure()) return;
      const go = enable && on && vol.music > 0.01;
      if (go && rec.url) { S.ambient(false); if (!rec.on) playTrack(); enable = false; } else stopTrack();
      if (go && !rec.url) { if (mus.on) return; mus.on = true; mus.next = 0; pump(); mus.timer = setInterval(pump, 300); }
      else { mus.on = false; clearInterval(mus.timer); const t = ctx.currentTime; mus.nodes.forEach(n => { try { n.stop(t + 0.05); } catch (e) {} }); mus.nodes.clear(); }
    },
    // the player's own soundtrack: { name, kind: 'file' | 'local' } or null when the synthesised score plays
    // what is playing: { name, kind: 'score' | 'file', piece, pieces, playing } or null for the synthesised score
    get soundtrack() { return rec.url ? { name: rec.name, kind: rec.kind, piece: rec.kind === 'score' ? rec.order[rec.at] + 1 : 0, pieces: rec.list ? rec.list.length : 0, playing: !!(rec.el && rec.on && !rec.el.paused), time: rec.el ? rec.el.currentTime : 0, length: rec.el && isFinite(rec.el.duration) ? rec.el.duration : 0 } : null; },
    hasScore() { return !!(window.MUSIC && window.MUSIC.tracks && window.MUSIC.tracks.length); },
    nextPiece() {
      if (rec.kind !== 'score' || !rec.el) return;
      if (rec.gain && rec.on) { rec.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.07); setTimeout(() => { advance(); trackVolume(0.3); }, 320); } else advance();
    },
    async setSoundtrack(file) {
      if (!file || !(/^audio\//.test(file.type) || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(file.name))) return { ok: false };
      let saved = true; try { await store.set('score', { blob: file, name: file.name }); } catch (e) { saved = false; }
      useFile(URL.createObjectURL(file), file.name, file.name + '|' + file.size); return { ok: true, saved };
    },
    async clearSoundtrack() { try { await store.del('score'); } catch (e) {} useScore(); },
    tension(v) { mus.tensionT = Math.max(0, Math.min(1, v)); },
    setVolume(o) {
      if (o.sfx != null) vol.sfx = o.sfx; if (o.music != null) vol.music = o.music;
      if (!ctx) return; const t = ctx.currentTime;
      sfxBus.gain.setTargetAtTime(vol.sfx * 0.7, t, 0.05); musBus.gain.setTargetAtTime(vol.music * 0.55, t, 0.05); trackVolume();
      if (vol.music <= 0.01) S.music(false); else if (on && S.wantMusic) S.music(true);
    },
    get volume() { return { ...vol }; },
    wantMusic: false,
    set enabled(v) { on = v; if (!v) { S.ambient(false); if (ctx) S.music(false); } }, get enabled() { return on; },
    unlock() { ensure(); },
  };
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return; try { if (document.hidden) ctx.suspend(); else ctx.resume(); } catch (e) {}
    if (rec.el && rec.on) { try { if (document.hidden) { savePos(); rec.el.pause(); } else { const p = rec.el.play(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} }
  });
  window.addEventListener('pagehide', savePos);
  // a browser may refuse to start a recording outside a tap; the next tap or key press starts it
  const kick = () => { if (rec.on && rec.el && rec.el.paused && !document.hidden) { try { const p = rec.el.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } };
  document.addEventListener('pointerdown', kick, true); document.addEventListener('keydown', kick, true);
  // a file chosen on an earlier visit, or else the original score
  (async () => {
    let kept = null; try { kept = await store.get('score'); } catch (e) {}
    if (kept && kept.blob) useFile(URL.createObjectURL(kept.blob), kept.name || 'soundtrack', (kept.name || '') + '|' + kept.blob.size); else useScore();
  })();
  // never let audio break the game
  for (const k of Object.keys(S)) { const d = Object.getOwnPropertyDescriptor(S, k); if (typeof d.value === 'function') { const f = d.value; S[k] = function () { try { return f.apply(S, arguments); } catch (e) { console.warn('sfx', e); } }; } }
  G.SFX = S;
})(window);
