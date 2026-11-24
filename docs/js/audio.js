/* Synthesised sound effects (WebAudio) — no external files */
(function (G) {
  let ctx = null, master = null, on = true, ambient = null;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    return ctx;
  }
  function noiseBuf(dur) {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
  }
  function env(g, t, a, peak, dec) { peak = Math.max(peak, 0.0005); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function click(t, f, q, vol, dur) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf(dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = ctx.createGain(); env(g, t, 0.002, vol, dur);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }
  function tone(t, f, type, vol, a, dec, f2) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
    const g = ctx.createGain(); env(g, t, a, vol, dec); o.connect(g); g.connect(master); o.start(t); o.stop(t + a + dec + 0.05);
    return o;
  }
  const S = {
    dice(n = 3) { if (!on || !ensure()) return; const t = ctx.currentTime; for (let i = 0; i < 7 + n * 2; i++) click(t + i * 0.045 + Math.random() * 0.03, 1800 + Math.random() * 2600, 6, 0.35 * (1 - i / 16), 0.04); },
    clash() { if (!on || !ensure()) return; const t = ctx.currentTime; click(t, 3200, 2, 0.5, 0.25); tone(t, 1320, 'triangle', 0.12, 0.002, 0.5, 1250); tone(t, 1870, 'sine', 0.08, 0.002, 0.7); },
    thud() { if (!on || !ensure()) return; const t = ctx.currentTime; tone(t, 140, 'sine', 0.5, 0.004, 0.18, 60); click(t, 400, 1, 0.15, 0.06); },
    coin() { if (!on || !ensure()) return; const t = ctx.currentTime; tone(t, 988, 'triangle', 0.14, 0.003, 0.18); tone(t + 0.07, 1318, 'triangle', 0.14, 0.003, 0.3); },
    horn() {
      if (!on || !ensure()) return; const t = ctx.currentTime;
      [[196, 0], [294, 0.02]].forEach(([f, d]) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.94, t + d); o.frequency.linearRampToValueAtTime(f, t + d + 0.15);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1400, t + 0.3); lp.frequency.linearRampToValueAtTime(600, t + 1.1);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.12); g.gain.setValueAtTime(0.16, t + d + 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.25);
        o.connect(lp); lp.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 1.3);
      });
    },
    conquer() { if (!on || !ensure()) return; const t = ctx.currentTime; [262, 330, 392, 523].forEach((f, i) => tone(t + i * 0.07, f, 'triangle', 0.13, 0.01, 0.6)); click(t, 2500, 1.5, 0.3, 0.2); },
    lose() { if (!on || !ensure()) return; const t = ctx.currentTime; tone(t, 220, 'sawtooth', 0.06, 0.01, 0.4, 150); },
    card() { if (!on || !ensure()) return; const t = ctx.currentTime; click(t, 5000, 0.8, 0.25, 0.12); click(t + 0.08, 4000, 0.8, 0.18, 0.1); },
    victory() { if (!on || !ensure()) return; const t = ctx.currentTime; [[262, 0], [330, 0.18], [392, 0.36], [523, 0.54], [392, 0.8], [523, 0.98]].forEach(([f, d]) => { tone(t + d, f, 'triangle', 0.16, 0.02, 0.7); tone(t + d, f / 2, 'sine', 0.1, 0.02, 0.8); }); },
    march() { if (!on || !ensure()) return; const t = ctx.currentTime; for (let i = 0; i < 4; i++) click(t + i * 0.09, 300 + i * 40, 2, 0.25, 0.07); },
    ambient(enable) {
      if (!ensure()) return;
      if (!enable || !on) { if (ambient) { ambient.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6); const a = ambient; setTimeout(() => { try { a.src.stop(); a.o1.stop(); a.o2.stop(); } catch (e) {} }, 2500); ambient = null; } return; }
      if (ambient) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf(4); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 3);
      const o1 = ctx.createOscillator(); o1.frequency.value = 55; o1.type = 'sine'; const g1 = ctx.createGain(); g1.gain.value = 0.25;
      const o2 = ctx.createOscillator(); o2.frequency.value = 82.4; o2.type = 'sine'; const g2 = ctx.createGain(); g2.gain.value = 0.12;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      src.connect(lp); lp.connect(g); o1.connect(g1); g1.connect(g); o2.connect(g2); g2.connect(g); g.connect(master);
      src.start(); o1.start(); o2.start();
      ambient = { src, o1, o2, g };
    },
    set enabled(v) { on = v; if (!v) S.ambient(false); }, get enabled() { return on; },
    unlock() { ensure(); },
  };
  // never let audio break the game
  for (const k of Object.keys(S)) { const d = Object.getOwnPropertyDescriptor(S, k); if (typeof d.value === 'function') { const f = d.value; S[k] = function () { try { return f.apply(S, arguments); } catch (e) { console.warn('sfx', e); } }; } }
  G.SFX = S;
})(window);
