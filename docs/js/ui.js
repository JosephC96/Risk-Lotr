/* UI controller: menus, HUD, turn flow, battles, cards, hot-seat, saves */
(function (G) {
  const D = G.DATA, GM = G.GAME, AI = G.AI, SFX = G.SFX;
  const NT = D.TERR.length;
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SAVE_KEY = D.MAP_ID ? `eldmar.save.${D.MAP_ID}` : 'eldmar.save.v2', SET_KEY = 'eldmar.settings.v1';
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };

  const U = {
    hl: { sel: -1, src: -1, targets: new Set(), kind: null, arrow: null, regionHi: -1 },
    aiToken: 0, running: false, busy: false, battle: null, dice: 3, world: null, staticCanvas: null,
    settings: Object.assign({ speed: 'normal', sound: true, life: true, vol: { music: 0.55, sfx: 0.8 } }, JSON.parse(store.get(SET_KEY) || '{}')),
    hist: [], regPrev: null,
  };
  const SPEED = { slow: 1.6, normal: 1, fast: 0.42, instant: 0 };
  const spd = ms => ms * (SPEED[U.settings.speed] ?? 1);
  const wait = ms => { const m = spd(ms); return m > 0 ? sleep(m) : sleep(0); };
  function saveSettings() { store.set(SET_KEY, JSON.stringify(U.settings)); }

  function VW() { return G.BOARD; }

  /* ---------------- SVG helpers ---------------- */
  let gid = 0;
  const SHIELD_D = 'M6 4 H94 V50 C94 84 72 104 50 117 C28 104 6 84 6 50 Z';
  function shieldSVG(p, cls = 'shield') {
    const illustrated = G.MATERIALS.shieldSVG(p, cls);
    if (illustrated) return illustrated;
    const id = 'sg' + (gid++), id2 = 'sk' + gid;
    return `<svg class="${cls}" viewBox="0 0 100 120" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.light}"/><stop offset=".45" stop-color="${p.color}"/><stop offset="1" stop-color="${p.dark}"/></linearGradient><linearGradient id="${id2}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6df98"/><stop offset=".5" stop-color="#c99a3e"/><stop offset="1" stop-color="#8a6224"/></linearGradient></defs>
      <path d="${SHIELD_D}" fill="url(#${id})" stroke="#2a1a0c" stroke-width="9"/><path d="${SHIELD_D}" fill="none" stroke="url(#${id2})" stroke-width="5"/>
      <g transform="translate(22 20) scale(.56)"><path d="${D.EMBLEMS[p.emblem]}" fill="rgba(0,0,0,.35)" fill-rule="evenodd" transform="translate(2 3)"/><path d="${D.EMBLEMS[p.emblem]}" fill="#f7eed6" fill-rule="evenodd"/></g></svg>`;
  }
  const facObj = i => { const f = i === 5 ? D.NEUTRAL : D.FACTIONS[i]; return { ...f, fname: f.name }; };
  function cardSVG(type) { return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${D.CARD_TYPES[type].path}" fill="currentColor" fill-rule="evenodd"/></svg>`; }
  const ORN = '<svg class="orn" viewBox="0 0 220 14" fill="none" stroke="currentColor" stroke-width="1"><path d="M0 7h90M130 7h90"/><path d="M96 7l14-6 14 6-14 6z" fill="currentColor" fill-opacity=".3"/><circle cx="110" cy="7" r="2" fill="currentColor"/></svg>';
  const ICON = {
    troops: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="3.2"/><path d="M5 21c0-5 3-8 7-8s7 3 7 8z"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h2v18H5z"/><path d="M8 4h11l-3 4 3 4H8z" opacity=".85"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="4" width="11" height="15" rx="1.5"/><path d="M9 20h9V7"/></svg>',
    tower: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 21V9H4V4h3v2h2V4h6v2h2V4h3v5h-2v12z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 4v16M4 12h16"/></svg>',
    swords: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l11 11M15 15l2-2M15 15l-2 2M14 18l4 4M20 4L9 15M9 15l-2-2M9 15l2 2M10 18l-4 4"/></svg>',
    move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h14l-3-3M20 16H6l3 3"/></svg>',
    region: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/></svg>',
    dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
  };

  /* ---------------- dice ---------------- */
  const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const ROT = { 1: [0, 0], 2: [0, -90], 3: [0, -180], 4: [0, 90], 5: [-90, 0], 6: [90, 0] };
  function dieHTML(kind) {
    let faces = '';
    for (let f = 1; f <= 6; f++) { let pips = ''; for (let c = 1; c <= 9; c++) pips += PIPS[f].includes(c) ? '<i></i>' : '<span></span>'; faces += `<div class="f f${f}">${pips}</div>`; }
    return `<div class="diewrap"><div class="die ${kind}" data-turns="0">${faces}</div></div>`;
  }
  function setDie(wrap, v, fast) {
    const d = wrap.querySelector('.die'); const turns = (+d.dataset.turns || 0) + 2 + Math.floor(Math.random() * 2);
    d.dataset.turns = turns; d.classList.toggle('fast', !!fast);
    const [rx, ry] = ROT[v];
    d.style.transform = `rotateX(${rx + 360 * turns + (Math.random() < .5 ? 0 : 360)}deg) rotateY(${ry + 360 * turns}deg) rotateZ(0deg)`;
    wrap.classList.remove('won', 'lost');
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    const artwork = G.MATERIALS.load();
    const bar = $('#loadbar'), msg = $('#loadmsg');
    const prog = (v, m) => { bar.style.width = Math.round(v * 100) + '%'; if (m) msg.textContent = m; };
    const TIPS = ['Hold a whole region and its bonus armies arrive every turn.', 'The defender wins ties: attack with numbers, not with hope.', 'Conquer at least one territory each turn to draw a card.', 'Card sets grow in value with every trade-in. Time them well.', 'A single army cannot attack. Leave no border thinly held.', 'Blitz fights to the end. Retreat while you still can.'];
    const tipEl = $('#loadtip'); let tipI = (Math.random() * TIPS.length) | 0; if (tipEl) tipEl.textContent = TIPS[tipI];
    const tipTimer = setInterval(() => { if (tipEl) tipEl.textContent = TIPS[++tipI % TIPS.length]; }, 2600);
    try { await Promise.race([Promise.all([document.fonts.load('italic 16px "IM Fell English"'), document.fonts.load('700 16px Cinzel'), document.fonts.load('16px "Uncial Antiqua"')]), sleep(2500)]); } catch (e) {}
    const world = await G.MAPGEN.generate(prog);
    G.ATLAS.prepare(world);
    await artwork;
    const S = D.PRINTED_LABELS || window.innerWidth < 900 ? 1.5 : 2;
    const st = await G.ATLAS.paint(world, prog, S);
    U.world = world; U.staticCanvas = st.canvas;
    prog(0.97, 'Setting the war table…');
    $('#app').hidden = false;
    G.BOARD.init($('#map'), world, st.canvas);
    G.BOARD.onClick = onMapClick; G.BOARD.onHover = onMapHover;
    applyLife();
    if (!G.MATERIALS.territory($('#decoL'), { biome: 'snow' })) G.ATLAS.sketch($('#decoL'), 'ruins');
    if (!G.MATERIALS.territory($('#decoR'), { biome: 'forest' })) G.ATLAS.sketch($('#decoR'), 'tree');
    bindUI();
    prog(1, '');
    clearInterval(tipTimer);
    $('#screen-loading').hidden = true;
    showMenu();
    netBoot();
  }

  function applyLife() { G.BOARD.life = U.settings.life && !matchMedia('(prefers-reduced-motion: reduce)').matches; G.BOARD.dirty = true; }

  /* ---------------- highlight state ---------------- */
  function applyHL() {
    const v = VW(); if (!v) return;
    v.sel = U.hl.sel; v.src = U.hl.src; v.targets = U.hl.targets; v.targetKind = U.hl.kind; v.arrow = U.hl.arrow; v.regionHi = U.hl.regionHi;
    v.dirty = true; v.hlChanged && v.hlChanged();
  }
  function setHL(o) { Object.assign(U.hl, o); applyHL(); }
  function clearSel() { setHL({ sel: -1, src: -1, targets: new Set(), kind: null, arrow: null }); refresh(); }

  /* ---------------- menu ---------------- */
  const SEAT_TYPES = [['off', 'Closed'], ['human', 'Human'], ['easy', 'AI · Recruit'], ['normal', 'AI · Captain'], ['hard', 'AI · Warlord']];
  function showMenu() {
    U.aiToken++; U.running = false;
    hideBattle(); closeModal();
    menuFx(); SFX.tension(0); stopFireworks();
    const cfg = Object.assign({ mode: 'classic', deal: 'random', fortify: 'adjacent', cardMode: 'progressive', neutral: true, seats: ['human', 'normal', 'normal', 'off', 'normal'] }, JSON.parse(store.get('eldmar.menu') || '{}'));
    const hasSave = !!store.get(SAVE_KEY);
    const hosting = NET.savedHosting(), lastRoom = NET.lastRoom();
    const modeCard = (k, ic, t, s) => `<button class="mode ${cfg.mode === k ? 'on' : ''}" data-mode="${k}">${ic}<b>${t}</b><span>${s}</span></button>`;
    const sel = (id, opts, v) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    $('#menuMount').innerHTML = `
      <div class="menu">
        <div class="l">
          <div class="title">
            <svg viewBox="0 0 64 64" fill="none" stroke="currentColor"><circle cx="32" cy="32" r="29" stroke-width="1.5"/><circle cx="32" cy="32" r="25.5" stroke-width="0.8"/><path d="M32 54V26M32 40l-9-7M32 36l9-7M32 31l-7-8M32 29l6-9M23 33c-5-2-8-6-8-10M41 29c4-1 8-4 9-8M25 23c-3-3-3-7-2-10M38 20c2-3 2-6 1-9M32 26c0-5 1-9 0-14" stroke-width="1.6" stroke-linecap="round"/><path d="M22 56c4-2 7-2 10-2s6 0 10 2" stroke-width="1.4"/></svg>
            <h1>MIDDLE-EARTH</h1><div class="s">THE WAR OF THE REALMS</div>
            <p>${NT} territories, nine regions and five peoples with a claim to the same land. Only one will rule Middle-earth.</p>
          </div>
          <div class="lbl">Game mode</div>
          <div class="modes">
            ${modeCard('classic', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>', 'Classic', 'World domination: eliminate every rival realm.')}
            ${modeCard('missions', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3h9l3 3v15H6z"/><path d="M9 10h6M9 14h6"/><circle cx="16" cy="18" r="3" fill="currentColor" fill-opacity=".3"/></svg>', 'Missions', 'Each realm is dealt a secret objective.')}
            ${modeCard('quick', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>', 'Quick', `Hold ${D.QUICK_TARGET || 26} territories, or the most after 12 rounds.`)}
          </div>
          <div class="lbl">Rule options</div>
          <div class="opts">
            <div class="opt"><label for="o-deal">Territory setup</label>${sel('o-deal', [['random', 'Dealt at random'], ['manual', 'Claimed in turns']], cfg.deal)}</div>
            <div class="opt"><label for="o-fort">Fortify move</label>${sel('o-fort', [['adjacent', 'Classic: adjacent only'], ['connected', 'Through connected territories']], cfg.fortify)}</div>
            <div class="opt"><label for="o-cards">Card trade-ins</label>${sel('o-cards', [['progressive', 'Progressive (4, 6, 8…)'], ['fixed', 'Fixed by set']], cfg.cardMode)}</div>
            <div class="opt"><label for="o-neutral">Two players</label>${sel('o-neutral', [['yes', 'With a neutral army'], ['no', 'No neutral army']], cfg.neutral ? 'yes' : 'no')}</div>
          </div>
        </div>
        <div class="r">
          <div class="lbl" style="margin-top:0">Realms at war</div>
          <div class="seats">${D.FACTIONS.map((f, i) => `<div class="seat ${cfg.seats[i] === 'off' ? 'off' : ''}" data-i="${i}">${shieldSVG(facObj(i), '')}<div class="sn">${f.name}</div>${sel('seat' + i, SEAT_TYPES, cfg.seats[i])}</div>`).join('')}</div>
          <div class="opts">
            <div class="opt"><label for="o-speed">AI speed</label>${sel('o-speed', [['slow', 'Relaxed'], ['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']], U.settings.speed)}</div>
            <div class="opt"><label for="o-life">Clouds and map animations</label>${sel('o-life', [['on', 'On'], ['off', 'Off']], U.settings.life ? 'on' : 'off')}</div>
          </div>
          <div class="go">
            <button class="btn gold" id="mStart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l11 11M15 15l2-2M15 15l-2 2M14 18l4 4M20 4L9 15M9 15l-2-2M9 15l2 2M10 18l-4 4"/></svg>Begin the war</button>
            ${hasSave ? '<button class="btn" id="mCont">Continue saved game</button>' : ''}
            <button class="btn" id="mHost">Host an online game</button>
            ${hosting ? `<button class="btn" id="mReopen">Reopen online room ${esc(hosting.code)}</button>` : ''}
            ${lastRoom && !(hosting && hosting.code === lastRoom) ? `<button class="btn" id="mRejoin">Rejoin room ${esc(lastRoom)}</button>` : ''}
            <div class="note" id="mNote">Two to five realms. Play in turns on this device, or host an online game and share its link.</div>
          </div>
        </div>
      </div>`;
    $('#screen-menu').hidden = false;
    const M = $('#menuMount');
    M.querySelectorAll('.mode').forEach(b => b.onclick = () => { M.querySelectorAll('.mode').forEach(x => x.classList.remove('on')); b.classList.add('on'); });
    D.FACTIONS.forEach((f, i) => { $('#seat' + i).onchange = e => e.target.closest('.seat').classList.toggle('off', e.target.value === 'off'); });
    $('#mStart').onclick = () => {
      SFX.unlock();
      const seats = D.FACTIONS.map((f, i) => $('#seat' + i).value);
      const active = seats.map((v, i) => ({ v, i })).filter(x => x.v !== 'off');
      if (active.length < 2) { $('#mNote').textContent = 'You need at least two realms in the game.'; $('#mNote').style.color = '#ff9b85'; return; }
      const mode = M.querySelector('.mode.on').dataset.mode;
      const c = { mode, deal: $('#o-deal').value, fortify: $('#o-fort').value, cardMode: $('#o-cards').value, neutral: $('#o-neutral').value === 'yes', seats };
      store.set('eldmar.menu', JSON.stringify(c));
      U.settings.speed = $('#o-speed').value; U.settings.life = $('#o-life').value === 'on'; saveSettings(); applyLife();
      startGame({
        mode, deal: c.deal, fortify: c.fortify, cardMode: c.cardMode, neutral: c.neutral, quickTarget: D.QUICK_TARGET || 26, quickRounds: 12,
        players: active.map(x => ({ faction: x.i, type: x.v === 'human' ? 'human' : 'ai', diff: x.v === 'human' ? null : x.v })),
      });
    };
    const cont = $('#mCont'); if (cont) cont.onclick = () => { SFX.unlock(); continueGame(); };
    $('#mHost').onclick = () => {
      SFX.unlock();
      const seats = D.FACTIONS.map((f, i) => $('#seat' + i).value); const note = $('#mNote');
      const active = seats.map((v, i) => ({ v, i })).filter(x => x.v !== 'off');
      if (active.filter(x => x.v === 'human').length < 2) { note.textContent = 'Set at least two realms to Human: one is yours, the others are open seats for your friends.'; note.style.color = '#ff9b85'; return; }
      const c = { mode: M.querySelector('.mode.on').dataset.mode, deal: $('#o-deal').value, fortify: $('#o-fort').value, cardMode: $('#o-cards').value, neutral: $('#o-neutral').value === 'yes', seats };
      store.set('eldmar.menu', JSON.stringify(c));
      U.settings.speed = $('#o-speed').value; U.settings.life = $('#o-life').value === 'on'; saveSettings(); applyLife();
      let first = true;
      hostOnline({ mode: c.mode, deal: c.deal, fortify: c.fortify, cardMode: c.cardMode, neutral: c.neutral, quickTarget: D.QUICK_TARGET || 26, quickRounds: 12 },
        active.map(x => x.v === 'human' ? { faction: x.i, kind: first ? (first = false, 'host') : 'open' } : { faction: x.i, kind: 'ai', diff: x.v }));
    };
    const reo = $('#mReopen'); if (reo) reo.onclick = () => { SFX.unlock(); reopenOnline(); };
    const rej = $('#mRejoin'); if (rej) rej.onclick = () => { SFX.unlock(); joinOnline(lastRoom); };
  }

  function startGame(cfg) {
    U.aiToken++; U.running = false; U.busy = false; U.lastBanner = null;
    U.suppressTurn = true; GM.newGame(cfg); U.suppressTurn = false;
    U.hist = []; U.regPrev = null;
    $('#screen-menu').hidden = true; enterHUD();
    clearSel(); VW().resize && VW().resize(); VW().home && VW().home();
    refresh(true);
    SFX.ambient(true); startMusic();
    openingRoll();
  }
  function continueGame() {
    const raw = store.get(SAVE_KEY); if (!raw) return;
    try { GM.restore(raw); } catch (e) { store.del(SAVE_KEY); showMenu(); return; }
    U.aiToken++; U.running = false; U.busy = false;
    U.hist = []; U.regPrev = null;
    $('#screen-menu').hidden = true; enterHUD();
    clearSel(); VW().resize && VW().resize();
    refresh(true); SFX.ambient(true); startMusic();
    toast('Game restored.');
    beginHumanOrAI(true);
  }
  function save() { if (NET.on()) return; const S = GM.S; if (!S || S.phase === 'over') { store.del(SAVE_KEY); return; } if (S.phase === 'claim' || S.phase === 'place' || S.phase === 'setup') return; store.set(SAVE_KEY, GM.serialize()); }

  /* ---------------- opening roll ---------------- */
  async function openingRoll() {
    const S = GM.S;
    const rounds = S.startRolls;
    const body = document.createElement('div');
    body.innerHTML = `<div class="rolls" id="rollList"></div><p class="hint" id="rollMsg" style="text-align:center;margin-top:12px">Each realm rolls one die. The highest roll goes first.</p>`;
    showModal({ title: 'Roll for the first turn', sub: 'As the old rules demand', body, buttons: [{ label: 'To war!', cls: 'gold', id: 'rollGo', disabled: true, onClick: () => { closeModal(); openWar(); } }] });
    const list = body.querySelector('#rollList');
    for (let r = 0; r < rounds.length; r++) {
      list.innerHTML = rounds[r].map(x => { const p = S.players[x.p]; return `<div class="rollrow" data-p="${x.p}">${shieldSVG(p, '')}<div><b style="font-family:var(--f-display)">${p.fname}</b><div class="hint">${p.isAI ? 'Computer player' : 'Human'}</div></div><div class="dice" style="perspective:400px">${dieHTML('def')}</div></div>`; }).join('');
      if (r > 0) body.querySelector('#rollMsg').textContent = 'A tie for the highest roll: the tied realms roll again.';
      await sleep(80);
      SFX.dice(rounds[r].length);
      rounds[r].forEach(x => setDie(list.querySelector(`.rollrow[data-p="${x.p}"] .diewrap`), x.v));
      await sleep(1150);
      const max = Math.max(...rounds[r].map(x => x.v));
      rounds[r].forEach(x => { const row = list.querySelector(`.rollrow[data-p="${x.p}"]`); if (x.v === max) row.classList.add('win'); else row.querySelector('.diewrap').classList.add('lost'); });
      if (r < rounds.length - 1) await sleep(1100);
    }
    const first = S.players[S.first];
    body.querySelector('#rollMsg').innerHTML = `<b style="color:var(--gold-hi);font-family:var(--f-display);font-style:normal">${first.fname}</b> ${S.phase === 'claim' ? 'claim the first territory.' : 'take the first turn.'}`;
    const go = $('#rollGo'); if (go) go.disabled = false;
    if (S.players.every(p => p.isAI || p.neutral)) { await sleep(900); closeModal(); openWar(); }
  }
  // the opening shot: letterbox, title and a slow pull-back over the map
  async function openWar() {
    const tok = U.aiToken, S = GM.S;
    if (U.settings.speed !== 'instant' && G.BOARD.life) {
      const c = $('#cine');
      c.innerHTML = `<i class="cb t"></i><i class="cb b"></i><div class="cshade"></div><div class="ct"><small>MIDDLE-EARTH</small><b>The War of the Realms</b><span>${S.players.filter(p => !p.neutral).length} realms. One crown.</span></div>`;
      c.hidden = false; void c.offsetWidth; c.classList.add('in');
      SFX.horn(); SFX.whoosh();
      const ms = VW().intro(3400);
      await sleep(ms - 700); c.classList.remove('in'); await sleep(750); c.hidden = true; c.innerHTML = '';
      if (tok !== U.aiToken) return;
    }
    beginHumanOrAI(true);
  }
  function enterHUD() { const a = $('#app'); a.classList.remove('enter'); void a.offsetWidth; a.classList.add('enter'); setTimeout(() => a.classList.remove('enter'), 1600); }
  function startMusic() { SFX.wantMusic = true; if (U.settings.sound) SFX.music(true); }

  /* ---------------- flow ---------------- */
  function humans() { return GM.S.players.filter(p => !p.isAI && !p.neutral); }
  function curP() { const S = GM.S; return S ? S.players[S.current] : null; }
  function isHumanTurn() { const p = curP(); if (!p || p.isAI || p.neutral || GM.S.phase === 'over') return false; return NET.on() ? p.cid === NET.cid : true; }

  async function beginHumanOrAI(first) {
    const S = GM.S; if (!S || S.winner) return;
    if (first && (S.phase === 'reinforce')) onTurnStart(true);
    proceed();
  }

  async function proceed() {
    const S = GM.S; if (!S || S.winner || U.running) return;
    const p = curP();
    refresh();
    if (S.phase === 'claim' || S.phase === 'place') {
      if (p.isAI && canDriveAI()) {
        U.running = true; const tok = U.aiToken;
        await wait(S.phase === 'claim' ? 240 : 70);
        if (tok !== U.aiToken) return;
        let t;
        if (S.phase === 'claim') { t = AI.chooseClaim(p.idx); GM.claim(t); VW().ring(t, p.light); SFX.thud(); }
        else { t = AI.chooseSetupPlace(p.idx); GM.setupPlace(t); if (SPEED[U.settings.speed] > 0.5) VW().ring(t, '#ffe08a'); }
        U.running = false; proceed();
      }
      return;
    }
    if (S.phase === 'over') return;
    if (p.isAI) {
      if (!canDriveAI()) return;
      U.running = true; const tok = U.aiToken;
      try { await AI.takeTurn(p.idx, aiIO(tok)); } catch (e) {
        console.error(e);
        // recover so a bug can never freeze the game
        try {
          if (S.pending) GM.moveAfterConquest(S.pending.min);
          if (S.phase === 'reinforce') { while (GM.mustTrade()) { const b = GM.bestSet(p.cards, p.idx); if (!b || !GM.trade(b)) break; } const my = S.owner.findIndex(o => o === p.idx); if (S.reinforcements > 0 && my >= 0) GM.place(my, S.reinforcements); GM.endReinforce(); }
          if (S.phase === 'attack') GM.endAttack();
          if (S.phase === 'fortify' && S.current === p.idx) GM.endTurn();
        } catch (e2) { console.error(e2); }
      }
      if (tok !== U.aiToken) return;
      U.running = false;
      hideBattle(); setHL({ arrow: null, src: -1, sel: -1, targets: new Set() });
      proceed();
    } else {
      if (isHumanTurn() && GM.mustTrade() && $('#modal').hidden) openCards(true);
    }
  }

  function aiIO(tok) {
    const fastMode = () => SPEED[U.settings.speed] < 0.5;
    return {
      aborted: () => tok !== U.aiToken,
      wait,
      async trade(pi, r) { const p = GM.S.players[pi]; toast(`${p.fname} trade cards for <b>${r.value}</b> armies.`); SFX.card(); if (r.bonusT >= 0) VW().floatText(r.bonusT, '+2', '#ffe08a'); await wait(550); },
      async place(t, n) { if (!fastMode() || SPEED[U.settings.speed] > 0) { VW().ring(t, '#ffe08a'); VW().floatText(t, '+' + n, '#ffe08a'); } SFX.thud(); await wait(300); },
      async beginAttack(a, e) {
        if (U.settings.speed !== 'instant') { setHL({ src: a, sel: -1, arrow: { a, b: e, kind: 'attack' }, targets: new Set([e]), kind: 'attack' }); showBattle(a, e, true); VW().ensureVisible([a, e], $('#battle').offsetHeight + 30); }
        await wait(500);
      },
      async battle(res) { if (U.settings.speed === 'instant') { if (res.conquered) VW().flash(res.b, curP().light); return; } await animateBattle(res, fastMode()); },
      async endAttack() { await wait(250); hideBattle(); setHL({ arrow: null, src: -1, targets: new Set(), kind: null }); },
      async move(a, b, n) { if (U.settings.speed !== 'instant') { VW().moveFx(a, b, curP().light); SFX.march(); } await wait(450); },
    };
  }

  function onTurnStart(fromRestore) {
    const S = GM.S, p = curP();
    clearSel();
    banner(p, `Round ${S.round}`);
    SFX.horn(); SFX.tension(0.25);
    recordHistory();
    save();
    if (!p.isAI && humans().length > 1 && !fromRestore && !NET.on()) {
      showModal({ title: `${p.fname}: your turn`, sub: 'Pass the device. Your cards and mission stay hidden until you press the button.', body: `<div style="display:grid;place-items:center">${shieldSVG(p, '').replace('<svg', '<svg style="width:90px;height:106px"')}</div>`, buttons: [{ label: 'Start my turn', cls: 'gold', onClick: () => { closeModal(); refresh(); if (GM.mustTrade()) openCards(true); } }], locked: true });
    }
    if (isHumanTurn()) showFront();
  }

  /* ---------------- map input ---------------- */
  function onMapClick(t, ev) {
    const S = GM.S; if (!S) return;
    if ($('#modal').hidden === false) return;
    SFX.unlock();
    if (!isHumanTurn() || U.running || U.busy) { selectInfo(t); return; }
    if (t < 0) { clearSel(); hideBattle(); return; }
    const me = S.current, own = S.owner[t] === me;
    switch (S.phase) {
      case 'claim':
        if (S.owner[t] < 0) { GM.claim(t); VW().ring(t, curP().light); SFX.thud(); setHL({ sel: t }); proceed(); } else selectInfo(t);
        break;
      case 'place':
        if (own) { GM.setupPlace(t); VW().ring(t, '#ffe08a'); VW().floatText(t, '+1', '#ffe08a'); SFX.thud(); setHL({ sel: t }); proceed(); } else selectInfo(t);
        break;
      case 'reinforce':
        if (own) {
          if (GM.mustTrade()) { openCards(true); return; }
          if (S.reinforcements > 0) { const n = ev && ev.shiftKey ? 5 : 1; const k = GM.place(t, n); if (k) { VW().ring(t, '#ffe08a'); VW().floatText(t, '+' + k, '#ffe08a'); SFX.thud(); } }
          setHL({ sel: t, src: -1, targets: new Set(), kind: null }); refresh();
        } else selectInfo(t);
        break;
      case 'attack':
        if (S.pending) return;
        if (own) {
          if (S.armies[t] >= 2) { const tg = D.TERR[t].adj.filter(b => S.owner[b] !== me); setHL({ sel: t, src: t, targets: new Set(tg), kind: 'attack', arrow: null }); hideBattle(); refresh(); if (!tg.length) toast('This territory has no enemy neighbours.'); }
          else { selectInfo(t); toast('You need at least 2 armies to attack from here.'); }
        } else if (U.hl.src >= 0 && D.TERR[U.hl.src].adj.includes(t) && S.armies[U.hl.src] >= 2) {
          openBattle(U.hl.src, t);
        } else selectInfo(t);
        break;
      case 'fortify':
        if (S.fortified) { selectInfo(t); return; }
        if (own && U.hl.src >= 0 && U.hl.targets.has(t)) { openFortify(U.hl.src, t); return; }
        if (own && S.armies[t] >= 2) { const tg = GM.fortifyTargets(t); setHL({ sel: t, src: t, targets: new Set(tg), kind: 'move', arrow: null }); refresh(); if (!tg.length) toast('You have nowhere to move to from here.'); }
        else selectInfo(t);
        break;
    }
  }
  function selectInfo(t) { if (t < 0) { setHL({ sel: -1 }); refresh(); return; } setHL({ sel: t }); refresh(); if (window.innerWidth <= 980 && t >= 0) { /* keep map visible on phones */ } }

  function onMapHover(t, ev) {
    const tip = $('#tooltip'); const S = GM.S;
    if (t < 0 || !ev || !S) { tip.hidden = true; return; }
    const T = D.TERR[t], o = S.owner[t], p = o >= 0 ? S.players[o] : null;
    let extra = '', pct = -1;
    if (S.phase === 'attack' && U.hl.src >= 0 && U.hl.targets.has(t) && U.hl.kind === 'attack') {
      pct = Math.round(AI.winP(S.armies[U.hl.src] - 1, S.armies[t]) * 100);
      extra = `<div class="tp-odds"><div class="tp-r"><span>Chance to conquer</span><b>${pct}%</b></div><div class="ob"><i style="width:${pct}%;background-position:${-(100 - pct) * 0.6}px 0"></i></div></div>`;
    }
    const key = [t, o, S.armies[t], pct].join(':');
    if (tip.dataset.k !== key) {
      tip.dataset.k = key; tip.style.setProperty('--fc', p ? p.color + '77' : 'transparent');
      tip.innerHTML = `<div class="tp-h">${p ? shieldSVG(p, '') : ''}<div><b>${esc(T.name)}</b><i>${D.REGIONS[T.region].name} · +${D.REGIONS[T.region].bonus}</i></div></div>
        <div class="tp-b"><div class="tp-r"><span>${p ? esc(p.fname) : 'Unclaimed'}</span><b>${S.armies[t]} ${S.armies[t] === 1 ? 'army' : 'armies'}</b></div>${extra}</div>`;
    }
    const r = $('#mapwrap').getBoundingClientRect();
    let x = ev.clientX - r.left + 16, y = ev.clientY - r.top + 16;
    tip.hidden = false;
    if (x + tip.offsetWidth > r.width - 8) x = ev.clientX - r.left - tip.offsetWidth - 12;
    if (y + tip.offsetHeight > r.height - 8) y = ev.clientY - r.top - tip.offsetHeight - 12;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  // bring the current player's strongest border land into view
  function showFront() {
    const S = GM.S; if (!S || !VW().ensureVisible) return;
    const front = S.owner.map((o, i) => o === S.current ? i : -1).filter(i => i >= 0 && D.TERR[i].adj.some(j => S.owner[j] !== S.current)).sort((a, b) => S.armies[b] - S.armies[a])[0];
    if (front != null) VW().ensureVisible([front]);
  }

  /* ---------------- battle ---------------- */
  function openBattle(a, b) {
    setHL({ src: a, sel: b, arrow: { a, b, kind: 'attack' }, targets: new Set(D.TERR[a].adj.filter(x => GM.S.owner[x] !== GM.S.current)), kind: 'attack' });
    U.dice = Math.min(3, GM.S.armies[a] - 1);
    showBattle(a, b, false); refresh();
    VW().ensureVisible([a, b], $('#battle').offsetHeight + 30);
  }
  function showBattle(a, b, ai) {
    const S = GM.S; U.battle = { a, b, ai };
    const A = S.players[S.owner[a]], B = S.players[S.owner[b]];
    const box = $('#battle');
    const reopen = !box.hidden;
    box.style.cssText = `--ac:${A.dark};--acl:${A.color};--dc:${B.dark};--dcl:${B.color}`;
    box.innerHTML = `
      <div class="bt-head">Battle for <b>${esc(D.TERR[b].name)}</b></div>
      <div class="bt-grid">
        <div class="bt-side att" style="--fcA:${A.color}55">${shieldSVG(A)}<div style="min-width:0"><div class="role">Attacker</div><div class="tn">${esc(D.TERR[a].name)}</div><div class="fn">${esc(A.fname)}</div></div><span class="cnt" id="bA">${S.armies[a]}</span></div>
        <div class="bt-mid"><div class="dice" id="dA"></div><div class="vs">VS</div><div class="dice" id="dD"></div></div>
        <div class="bt-side def" style="--fcA:${B.color}55">${shieldSVG(B)}<div style="min-width:0"><div class="role">Defender</div><div class="tn">${esc(D.TERR[b].name)}</div><div class="fn">${esc(B.fname)}</div></div><span class="cnt" id="bD">${S.armies[b]}</span></div>
      </div>
      <div class="bt-oddsbar"><i id="bBar" style="width:50%"></i><span id="bBarT"></span></div>
      <div class="bt-odds" id="bOdds"></div>
      ${ai ? '' : `<div class="bt-actions">
        <span class="dsel-label">Dice</span><div class="dsel" id="dsel">${[1, 2, 3].map(n => `<button data-n="${n}">${n}</button>`).join('')}</div>
        <button class="btn red" id="bAtk">${ICON.swords}Attack<kbd>Space</kbd></button>
        <button class="btn" id="bBlitz">${ICON.dice}Blitz<kbd>B</kbd></button>
        <button class="btn sm" id="bRet">Retreat<kbd>R</kbd></button>
      </div>`}`;
    if (reopen) box.style.animation = 'none';
    box.hidden = false; SFX.tension(0.85); VW().setPad(box.offsetHeight + 28);
    fillDice(Math.min(3, S.armies[a] - 1), Math.min(2, S.armies[b]));
    updateBattleUI();
    if (!ai) {
      box.querySelectorAll('#dsel button').forEach(btn => btn.onclick = () => { U.dice = +btn.dataset.n; updateBattleUI(); fillDice(U.dice, Math.min(2, GM.S.armies[b])); });
      $('#bAtk').onclick = () => humanAttack(false);
      $('#bBlitz').onclick = () => humanAttack(true);
      $('#bRet').onclick = () => { hideBattle(); setHL({ arrow: null, sel: a }); refresh(); };
    }
  }
  function fillDice(na, nd) {
    const dA = $('#dA'), dD = $('#dD'); if (!dA) return;
    if (dA.children.length !== na) dA.innerHTML = dieHTML('att').repeat(na);
    if (dD.children.length !== nd) dD.innerHTML = dieHTML('def').repeat(nd);
  }
  function updateBattleUI() {
    const S = GM.S, bt = U.battle; if (!bt) return;
    const { a, b } = bt; const maxD = Math.min(3, S.armies[a] - 1);
    if (U.dice > maxD) U.dice = Math.max(1, maxD);
    $('#bA').textContent = S.armies[a]; $('#bD').textContent = S.armies[b];
    const pr = AI.winP(S.armies[a] - 1, S.armies[b]);
    const same = S.owner[b] === S.owner[a], pc = same ? 100 : Math.round(pr * 100);
    const bar = $('#bBar'); if (bar) { bar.style.width = pc + '%'; $('#bBarT').innerHTML = same ? 'Conquered' : `<b>${pc}%</b>to conquer`; }
    $('#bOdds').innerHTML = same ? '' : `You roll up to ${Math.max(1, maxD)} · the defender rolls ${Math.min(2, S.armies[b])} ${S.armies[b] >= 2 ? 'dice' : 'die'} and wins ties`;
    document.querySelectorAll('#dsel button').forEach(btn => { const n = +btn.dataset.n; btn.disabled = n > maxD; btn.classList.toggle('on', n === U.dice); });
    const can = GM.canAttack(a, b);
    ['#bAtk', '#bBlitz'].forEach(s => { const e = $(s); if (e) e.disabled = !can || U.busy; });
  }
  function hideBattle() { const b = $('#battle'); if (b) { b.hidden = true; b.innerHTML = ''; } VW() && VW().setPad && VW().setPad(0); if (U.battle) SFX.tension(GM.S && GM.S.phase === 'attack' ? 0.5 : 0.25); U.battle = null; }
  function lossTag(side, n) { const e = document.querySelector('#battle .bt-side.' + side); if (!e || !n) return; const l = document.createElement('span'); l.className = 'loss'; l.textContent = '−' + n; e.appendChild(l); setTimeout(() => l.remove(), 1000); }

  async function animateBattle(res, fast) {
    if (!U.battle) showBattle(res.a, res.b, true);
    fillDice(res.A.length, res.D.length);
    const wa = [...document.querySelectorAll('#dA .diewrap')], wd = [...document.querySelectorAll('#dD .diewrap')];
    SFX.dice(res.A.length + res.D.length);
    [...wa, ...wd].forEach(w => { w.classList.remove('roll', 'fast'); void w.offsetWidth; w.classList.add('roll'); if (fast) w.classList.add('fast'); });
    res.A.forEach((v, i) => wa[i] && setDie(wa[i], v, fast));
    res.D.forEach((v, i) => wd[i] && setDie(wd[i], v, fast));
    // arrows cross the border while the dice are in the air
    const PA = GM.S.players[res.attacker], PD = GM.S.players[res.defender];
    VW().volley(res.a, res.b, res.A.length * 3, PA.light, fast ? 0 : 260); VW().volley(res.b, res.a, res.D.length * 2, PD ? PD.light : '#ddd', fast ? 60 : 380);
    if (!fast) setTimeout(() => SFX.arrows(3), 260);
    await sleep(fast ? 480 : 1050);
    res.pairs.forEach((win, i) => { if (wa[i]) wa[i].classList.add(win ? 'won' : 'lost'); if (wd[i]) wd[i].classList.add(win ? 'lost' : 'won'); });
    const bA = $('#bA'), bD = $('#bD');
    const S = GM.S;
    if (bA) { bA.textContent = S.armies[res.a]; if (res.al) { bA.classList.remove('hit'); void bA.offsetWidth; bA.classList.add('hit'); } }
    if (bD) { bD.textContent = res.conquered ? 0 : S.armies[res.b]; if (res.dl) { bD.classList.remove('hit'); void bD.offsetWidth; bD.classList.add('hit'); } }
    if (res.al) { VW().floatText(res.a, '−' + res.al, '#ff8a72'); VW().impact(res.a, '#ffb070'); lossTag('att', res.al); }
    if (res.dl) { VW().floatText(res.b, '−' + res.dl, '#ff8a72'); VW().impact(res.b, '#ffb070'); lossTag('def', res.dl); }
    if (res.conquered) {
      const p = S.players[res.attacker]; VW().conquest(res.b, p); SFX.conquer();
      const box = $('#battle'); if (box && !box.hidden) { const st = document.createElement('div'); st.className = 'bt-stamp'; st.textContent = 'Conquered'; box.appendChild(st); setTimeout(() => SFX.stamp(), 120); }
      if (res.eliminated) { toast(`The <b>${S.players[res.defender].fname}</b> have been wiped out.`); }
    }
    else { SFX.clash(); if (res.al && !res.dl) VW().shake(180, 3); }
    refresh();
    await sleep(fast ? (res.conquered ? 520 : 260) : (res.conquered ? 900 : 520));
  }

  async function humanAttack(blitz) {
    const bt = U.battle; if (!bt || U.busy) return;
    const { a, b } = bt; U.busy = true; updateBattleUI();
    let res;
    do {
      res = GM.attack(a, b, blitz ? 3 : U.dice);
      if (!res) break;
      await animateBattle(res, blitz);
    } while (blitz && !res.conquered && GM.canAttack(a, b) && U.battle);
    U.busy = false;
    const S = GM.S;
    if (res && res.conquered) {
      await sleep(250); hideBattle();
      if (S.winner) return;
      const pd = S.pending;
      if (pd.min === pd.max) { finishConquest(pd.max); }
      else openConquest();
    } else if (S.armies[a] < 2) {
      hideBattle(); toast('Not enough armies left to keep attacking from here.');
      setHL({ arrow: null, src: -1, targets: new Set(), kind: null, sel: a }); refresh();
    } else updateBattleUI();
  }

  function openConquest() {
    const S = GM.S, pd = S.pending; const p = curP();
    const body = document.createElement('div');
    body.innerHTML = `<p class="hint" style="text-align:center">Move in at least as many armies as the dice you rolled (${pd.min}). One must stay behind in ${esc(D.TERR[pd.from].name)}.</p>
      <div class="bigN" id="cqN">${pd.max}</div>
      <div class="slider"><button class="btn sm" id="cqMin">Min</button><input type="range" id="cqR" min="${pd.min}" max="${pd.max}" value="${pd.max}"><button class="btn sm" id="cqMax">Max</button></div>
      <div class="row" style="font-size:13px;color:var(--ivory-dim)"><span id="cqFrom"></span><span id="cqTo" style="text-align:right"></span></div>`;
    showModal({ title: 'Territory conquered!', sub: `${esc(D.TERR[pd.to].name)} falls to the ${esc(p.fname)}`, body, locked: true, buttons: [{ label: 'Occupy', cls: 'gold', onClick: () => { const n = +$('#cqR').value; closeModal(); finishConquest(n); } }] });
    const R = $('#cqR'); const upd = () => { $('#cqN').textContent = R.value; $('#cqFrom').textContent = `${S.armies[pd.from] - R.value} stay in ${D.TERR[pd.from].name}`; $('#cqTo').textContent = `${R.value} move into ${D.TERR[pd.to].name}`; };
    R.oninput = upd; $('#cqMin').onclick = () => { R.value = pd.min; upd(); }; $('#cqMax').onclick = () => { R.value = pd.max; upd(); }; upd();
  }
  function finishConquest(n) {
    const S = GM.S, pd = S.pending; if (!pd) return;
    GM.moveAfterConquest(n);
    VW().moveFx(pd.from, pd.to, curP().light); SFX.march();
    const nxt = S.armies[pd.to] >= 2 ? pd.to : (S.armies[pd.from] >= 2 ? pd.from : -1);
    if (nxt >= 0) { const tg = D.TERR[nxt].adj.filter(b => S.owner[b] !== S.current); setHL({ sel: nxt, src: nxt, targets: new Set(tg), kind: 'attack', arrow: null }); }
    else setHL({ sel: pd.to, src: -1, targets: new Set(), kind: null, arrow: null });
    refresh();
    if (S.phase === 'reinforce' && S.returnToAttack) { toast('You hold 6 or more cards: trade in until you have 4 or fewer.'); openCards(true); }
  }

  /* ---------------- fortify ---------------- */
  function openFortify(a, b) {
    const S = GM.S; const max = S.armies[a] - 1;
    setHL({ arrow: { a, b, kind: 'move' } });
    const body = document.createElement('div');
    body.innerHTML = `<p class="hint" style="text-align:center">You get one fortify move per turn. Confirming it ends your turn.</p>
      <div class="bigN" id="fN">${max}</div>
      <div class="slider"><button class="btn sm" id="fMin">1</button><input type="range" id="fR" min="1" max="${max}" value="${max}"><button class="btn sm" id="fMax">${max}</button></div>`;
    showModal({ title: 'Fortify', sub: `${esc(D.TERR[a].name)} → ${esc(D.TERR[b].name)}`, body, buttons: [
      { label: 'Cancel', onClick: () => { closeModal(); setHL({ arrow: null }); } },
      { label: 'Move and end turn', cls: 'gold', onClick: async () => { const n = +$('#fR').value; closeModal(); GM.fortify(a, b, n); VW().moveFx(a, b, curP().light); SFX.march(); setHL({ arrow: null, src: -1, targets: new Set() }); refresh(); await sleep(500); endTurnHuman(); } },
    ] });
    const R = $('#fR'); R.oninput = () => $('#fN').textContent = R.value; $('#fMin').onclick = () => { R.value = 1; R.oninput(); }; $('#fMax').onclick = () => { R.value = max; R.oninput(); };
  }

  function endTurnHuman() {
    const S = GM.S; const p = curP(); const conquered = S.conquered;
    const card = GM.endTurn();
    if (card && !p.isAI) showCardEarned(card, p);
    proceed();
  }
  function showCardEarned(card, p) {
    SFX.card();
    const t = D.CARD_TYPES[card.type];
    toast(`${esc(p.fname)} earn a card: <b>${card.t >= 0 ? esc(D.TERR[card.t].name) : 'Wild card'}</b> (${t.name}).`);
  }

  /* ---------------- next button ---------------- */
  function onNext() {
    const S = GM.S; if (!S) return;
    if (S.phase === 'over') { leaveOnline(); showMenu(); return; }
    if (!isHumanTurn() || U.running || U.busy) return;
    switch (S.phase) {
      case 'claim': { const free = S.owner.map((o, i) => o < 0 ? i : -1).filter(i => i >= 0); const t = AI.chooseClaim(S.current); if (t >= 0) { GM.claim(t); VW().ring(t, curP().light); SFX.thud(); } proceed(); break; }
      case 'place': GM.setupAutoRest(); SFX.thud(); proceed(); break;
      case 'reinforce':
        if (GM.mustTrade()) { openCards(true); return; }
        if (S.reinforcements > 0) { const plan = AI.planReinforce(S.current, S.reinforcements); plan.forEach(([t, n]) => { const k = GM.place(t, n); if (k) { VW().ring(t, '#ffe08a'); VW().floatText(t, '+' + k, '#ffe08a'); } }); SFX.thud(); refresh(); return; }
        GM.endReinforce(); clearSel(); SFX.clash(); break;
      case 'attack': hideBattle(); GM.endAttack(); clearSel(); break;
      case 'fortify': clearSel(); endTurnHuman(); break;
    }
    refresh();
  }

  /* ---------------- render ---------------- */
  let rq = false;
  function refresh(now) { if (now === true) return doRefresh(); if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; doRefresh(); }); }
  function doRefresh() {
    const S = GM.S; if (!S) return;
    renderFactions(); renderDossier(); renderFooter();
    $('#roundNum').textContent = String(S.round).padStart(2, '0');
    const viewer = viewerPlayer();
    const nc = viewer ? viewer.cards.length : 0; const b = $('#cardBadge'); b.hidden = !nc; b.textContent = nc;
    $('#objText').innerHTML = objectiveText(viewer);
    VW().invalidate && VW().invalidate();
    if (U.battle && !U.battle.ai) updateBattleUI();
    watchRegions();
  }
  // a realm that completes a region gets a fanfare, a golden sweep over the land and a line in the feed
  function watchRegions() {
    const S = GM.S; const now = D.REGIONS.map(r => GM.regionOwner(r.id));
    const prev = U.regPrev; U.regPrev = now;
    if (!prev || S.phase === 'claim' || S.phase === 'place' || S.phase === 'setup') return;
    let n = 0;
    now.forEach((o, r) => {
      if (o === prev[r] || o < 0 || n > 1) return; const p = S.players[o]; if (!p || p.neutral) return; n++;
      VW().regionFx(r, p.light); SFX.region();
      toast(`<b>${esc(D.REGIONS[r].name)}</b> is held by the ${esc(p.fname)}: <b>+${D.REGIONS[r].bonus}</b> armies every turn.`);
    });
  }
  function recordHistory() { const S = GM.S; if (!S) return; U.hist.push({ r: S.round, c: S.players.map(p => GM.countTerr(p.idx)) }); if (U.hist.length > 400) U.hist.shift(); }
  function viewerPlayer() {
    if (NET.on()) return GM.S.players.find(q => q.cid === NET.cid) || null;
    const S = GM.S; const hs = humans();
    if (!hs.length) return null;
    const p = curP();
    if (!p.isAI && !p.neutral) return p;
    return hs.length === 1 ? hs[0] : null;
  }
  function objectiveText(viewer) {
    const S = GM.S;
    if (S.cfg.mode === 'quick') return `Hold <b>${S.cfg.quickTarget}</b> territories, or more than anyone else when round ${S.cfg.quickRounds} ends.`;
    if (S.cfg.mode === 'missions') {
      if (!viewer) return '<i>The other realms keep their missions secret.</i>';
      return `<span class="hint" style="font-style:normal">Secret mission (${esc(viewer.short)}):</span><br>${esc(GM.missionText(viewer.mission, S.players))}`;
    }
    return 'Conquer all of Middle-earth: eliminate every rival realm.';
  }

  let facKey = '';
  function renderFactions() {
    const S = GM.S, box = $('#factions');
    const key = S.players.map(p => p.faction + '/' + p.idx).join(',');
    if (key !== facKey || box.children.length !== S.players.length) {
      facKey = key;
      box.innerHTML = S.players.map(p => `<div class="fac" style="--fc:${p.color};--fl:${p.light}">${shieldSVG(p)}<div style="min-width:0">
        <div class="nm"><span class="sw" style="background:${p.color}"></span>${esc(p.short === 'Neutral' ? 'Neutrals' : p.short)}</div>
        <div class="who"></div>
        <div class="nums"><span title="Armies">${ICON.troops}<em></em></span><span title="Territories">${ICON.flag}<em></em></span>${p.neutral ? '' : `<span title="Cards">${ICON.cards}<em></em></span>`}</div>
        <div class="pw" title="Share of Middle-earth"><i></i></div></div></div>`).join('');
    }
    S.players.forEach((p, i) => {
      const el = box.children[i]; if (!el) return;
      const nt = GM.countTerr(p.idx), na = GM.countArmies(p.idx), cur = S.current === p.idx && S.phase !== 'over';
      let who = p.neutral ? 'Neutral army' : p.isAI ? ({ easy: 'AI · Recruit', normal: 'AI · Captain', hard: 'AI · Warlord' }[p.diff]) : (p.pname ? esc(p.pname) + (p.cid === NET.cid && NET.on() ? ' · you' : '') : 'Human');
      if (!p.alive) who = 'Wiped out'; else if (cur && !isHumanTurn()) who += '<span class="think"><i></i><i></i><i></i></span>';
      el.classList.toggle('cur', cur); el.classList.toggle('dead', !p.alive);
      const w = el.querySelector('.who'); if (w.dataset.h !== who) { w.dataset.h = who; w.innerHTML = who; }
      const vals = p.neutral ? [na, nt] : [na, nt, p.cards.length];
      el.querySelectorAll('.nums em').forEach((em, k) => {
        const v = String(vals[k]); if (em.textContent === v) return;
        const old = em.textContent; em.textContent = v;
        if (old !== '') { const sp = em.parentElement; sp.classList.remove('up', 'down'); void sp.offsetWidth; sp.classList.add(+v > +old ? 'up' : 'down'); }
      });
      el.querySelector('.pw i').style.width = (nt / NT * 100).toFixed(1) + '%';
    });
  }

  function renderFooter() {
    const S = GM.S; const p = curP(); const btn = $('#btnNext'); const lab = btn.querySelector('span');
    const ph = S.phase;
    document.querySelectorAll('.pstep').forEach(e => {
      const order = ['reinforce', 'attack', 'fortify']; const k = order.indexOf(e.dataset.p), cur = order.indexOf(ph);
      e.classList.toggle('on', e.dataset.p === ph); e.classList.toggle('done', cur > k);
    });
    let st = '', label = 'End turn', dis = false;
    const human = isHumanTurn();
    if (ph === 'over') { st = 'The war is over.'; label = 'New game'; }
    else if (!human) { st = `The <b>${esc(p.fname)}</b> are moving their armies<span class="think"><i></i><i></i><i></i></span>`; label = 'Rival turn'; dis = true; }
    else if (ph === 'claim') { st = `<b>${esc(p.short)}</b>: claim a free territory on the map.`; label = 'Pick for me'; }
    else if (ph === 'place') { st = `<b>${esc(p.short)}</b>: place 1 army on one of your territories. <b>${S.setupPool[S.current]}</b> left.`; label = 'Place the rest'; }
    else if (ph === 'reinforce') {
      if (GM.mustTrade()) { st = `You hold <b>${p.cards.length}</b> cards: you must trade in a set.`; label = 'Trade cards'; }
      else if (S.reinforcements > 0) { st = `Place <b>${S.reinforcements}</b> ${S.reinforcements > 1 ? 'armies' : 'army'}. Click: +1 · Shift+click: +5.`; label = 'Place for me'; }
      else { st = S.returnToAttack ? 'Reinforcements placed. Back to the attack.' : 'Reinforcements placed.'; label = 'To the attack'; }
    }
    else if (ph === 'attack') { st = S.pending ? 'Choose how many armies occupy the territory.' : U.hl.src >= 0 ? `Attacking from <b>${esc(D.TERR[U.hl.src].name)}</b>: pick an enemy neighbour.` : 'Pick one of your territories with 2+ armies, then an enemy neighbour.'; label = 'End attack'; dis = !!S.pending; }
    else if (ph === 'fortify') { st = S.cfg.fortify === 'connected' ? 'Optional fortify: move armies once between connected territories.' : 'Optional fortify: move armies once to an adjacent territory.'; label = 'End turn'; }
    const stEl = $('#status'); if (stEl.dataset.h !== st) { stEl.dataset.h = st; stEl.innerHTML = st; }
    lab.textContent = label; btn.disabled = dis;
    // the gold button asks for attention when nothing else is required of the player
    const idle = human && !U.battle && ((ph === 'reinforce' && !GM.mustTrade() && S.reinforcements === 0) || ph === 'fortify' || ph === 'over');
    btn.classList.toggle('pulse', !!idle || ph === 'over');
    // armies still to place, shown over the map
    const pool = $('#pool'); const left = !human ? 0 : ph === 'reinforce' && !GM.mustTrade() ? S.reinforcements : ph === 'place' ? S.setupPool[S.current] : 0;
    if (left > 0) { const b = pool.querySelector('b'); if (b.textContent !== String(left)) { b.textContent = left; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); } pool.querySelector('span').textContent = left === 1 ? 'army to place' : 'armies to place'; pool.hidden = false; } else pool.hidden = true;
    // which of my territories can act right now
    const act = new Set();
    if (human && !U.busy && U.hl.src < 0 && !S.pending) {
      const me = S.current;
      if (ph === 'attack') { for (let t = 0; t < NT; t++) if (S.owner[t] === me && S.armies[t] >= 2 && D.TERR[t].adj.some(b => S.owner[b] !== me)) act.add(t); }
      else if (ph === 'fortify' && !S.fortified) { for (let t = 0; t < NT; t++) if (S.owner[t] === me && S.armies[t] >= 2 && GM.fortifyTargets(t).length) act.add(t); }
    }
    VW().actionable = act;
  }

  function renderDossier() {
    const S = GM.S; const box = $('#dossier'); const t = U.hl.sel >= 0 ? U.hl.sel : U.hl.src;
    const p = curP(); const human = isHumanTurn();
    const dk = t + '/' + (t < 0 ? S.phase : ''); box.classList.toggle('still', box.dataset.k === dk); box.dataset.k = dk;
    if (t < 0) {
      $('#rtitle').textContent = 'War council';
      let html = '';
      if (S.phase === 'reinforce' && S.reinfDetail && human) {
        const r = S.reinfDetail;
        html += `<div class="box"><h3>${ICON.troops}Reinforcements</h3><div class="reinf">
          <div><span>${r.terr} territories ÷ 3 (min. 3)</span><b>${r.base}</b></div>
          ${r.regions.map(x => `<div><span>${esc(x.name)}</span><b>+${x.bonus}</b></div>`).join('')}
          ${S.tradeCount && S.reinforcements + 0 > r.total ? '' : ''}
          <div class="tot"><span>To place</span><b>${S.reinforcements}</b></div></div></div>`;
      }
      html += `<div class="box"><h3>${ICON.region}Current phase</h3><p class="hint">${phaseHelp(S.phase)}</p></div>`;
      if (human && S.phase === 'reinforce') html += `<button class="btn block" id="dCards">${ICON.cards}View my cards (${p.cards.length})</button>`;
      html += regionsMini();
      box.innerHTML = html;
      const dc = $('#dCards'); if (dc) dc.onclick = () => openCards(GM.mustTrade());
      bindRegionHover(box);
      return;
    }
    $('#rtitle').textContent = 'Selected territory';
    const T = D.TERR[t], o = S.owner[t], op = o >= 0 ? S.players[o] : null;
    const reg = D.REGIONS[T.region]; const rts = GM.REGION_T[T.region];
    const ownRegion = op ? rts.filter(x => S.owner[x] === o).length : 0;
    const me = S.current, own = o === me;
    let actions = '';
    if (human) {
      const canR = S.phase === 'reinforce' && own && S.reinforcements > 0 && !GM.mustTrade();
      const canA = S.phase === 'attack' && !S.pending && ((own && S.armies[t] >= 2) || (!own && U.hl.src >= 0 && D.TERR[U.hl.src].adj.includes(t)));
      const canM = S.phase === 'fortify' && !S.fortified && own && S.armies[t] >= 2 && GM.fortifyTargets(t).length;
      actions = `<div class="btngrid">
        <div class="row"><button class="btn ${canR ? '' : ''}" id="aR" ${canR ? '' : 'disabled'} style="flex:2">${ICON.plus}Reinforce</button>
          <button class="btn sm" id="aR5" ${canR ? '' : 'disabled'}>+5</button><button class="btn sm" id="aRA" ${canR ? '' : 'disabled'}>All</button>
          ${S.phase === 'reinforce' && S.placed && S.placed[t] ? `<button class="btn sm" id="aU" title="Undo">${ICON.undo}</button>` : ''}</div>
        <button class="btn ${canA ? 'gold' : ''}" id="aA" ${canA ? '' : 'disabled'}>${ICON.swords}Attack</button>
        <button class="btn" id="aM" ${canM ? '' : 'disabled'}>${ICON.move}Move</button></div>`;
    }
    let nb = '';
    const showOdds = S.phase === 'attack' && own && S.armies[t] >= 2;
    nb = T.adj.map(a => {
      const ao = S.owner[a]; const ap = ao >= 0 ? S.players[ao] : null;
      const enemy = ao !== o;
      const pct = showOdds && enemy ? `<span class="pct">${Math.round(AI.winP(S.armies[t] - 1, S.armies[a]) * 100)}%</span>` : '';
      return `<button class="chip ${showOdds && enemy ? 'atk' : ''}" data-t="${a}"><i style="background:${ap ? ap.color : '#555'}"></i>${esc(D.TERR[a].name)} · ${S.armies[a]}${pct}</button>`;
    }).join('');
    box.innerHTML = `
      <div class="dossier-head">${op ? shieldSVG(op) : ''}<div style="min-width:0"><h2>${esc(T.name).toUpperCase()}</h2><div class="reg">${esc(reg.name)} · +${reg.bonus}<br><span title="Territories controlled in this region">Region control: ${ownRegion}/${rts.length}</span></div></div></div>
      <canvas class="vig" id="vig"></canvas>
      <div class="stats">
        <div class="stat"><span>${ICON.troops}Armies</span><b>${S.armies[t]}</b></div>
        <div class="stat"><span>${ICON.tower}Defence</span><b>${Math.min(2, Math.max(1, S.armies[t]))} ${S.armies[t] >= 2 ? 'dice' : 'die'}</b></div>
      </div>
      <div class="hint" style="font-style:normal">${op ? `<span style="color:${op.light}">■</span> ${esc(op.fname)}` : 'Unclaimed'}</div>
      ${actions}
      <details class="border-list" ${showOdds ? 'open' : ''}><summary>Borders · ${T.adj.length}${showOdds ? ' · conquest odds' : ''}</summary><div class="nbrs">${nb}</div></details>`;
    G.VIGNETTE.paint($('#vig'), T);
    box.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      const a = +c.dataset.t;
      if (showOdds && S.owner[a] !== me && isHumanTurn()) openBattle(t, a);
      else { setHL({ sel: a }); VW().focus && VW().focus(a); refresh(); }
    });
    const bind = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    bind('#aR', () => { const k = GM.place(t, 1); if (k) { VW().ring(t, '#ffe08a'); VW().floatText(t, '+1', '#ffe08a'); SFX.thud(); } refresh(); });
    bind('#aR5', () => { const k = GM.place(t, 5); if (k) { VW().ring(t, '#ffe08a'); VW().floatText(t, '+' + k, '#ffe08a'); SFX.thud(); } refresh(); });
    bind('#aRA', () => { const k = GM.place(t, S.reinforcements); if (k) { VW().ring(t, '#ffe08a'); VW().floatText(t, '+' + k, '#ffe08a'); SFX.thud(); } refresh(); });
    bind('#aU', () => { GM.unplace(t); refresh(); });
    bind('#aA', () => { if (own) onMapClick(t); else openBattle(U.hl.src, t); });
    bind('#aM', () => onMapClick(t));
  }
  function phaseHelp(ph) {
    return {
      claim: 'In turn, each realm claims a free territory by placing one army on it, until none are left unclaimed.',
      place: 'In turn, each realm places one army on a territory it owns until its starting armies run out.',
      reinforce: 'You receive one army for every three territories (minimum three), plus the bonus of every region you hold completely. You may trade cards before placing.',
      attack: 'Attack from a territory with 2 or more armies into an enemy neighbour. You roll up to 3 dice, the defender up to 2. The defender wins ties.',
      fortify: 'You may make one fortify move: armies from one of your territories to another. At least one must stay behind.',
      over: 'The war is over.', setup: '',
    }[ph] || '';
  }
  function regionsMini() {
    const S = GM.S;
    return `<div class="box"><h3>${ICON.region}Regions</h3><div class="regs">${D.REGIONS.map(r => {
      const ts = GM.REGION_T[r.id]; const counts = {}; ts.forEach(t => { const o = S.owner[t]; counts[o] = (counts[o] || 0) + 1; });
      const owner = GM.regionOwner(r.id);
      return `<div class="regrow" data-r="${r.id}" style="grid-template-columns:1fr 34px"><div><b style="font-size:13.5px">${esc(r.name)}</b><div class="regbar" style="margin-top:4px">${Object.entries(counts).map(([o, c]) => `<i style="width:${c / ts.length * 100}%;background:${o >= 0 ? S.players[o].color : '#555'}"></i>`).join('')}</div></div><span class="bn">+${r.bonus}</span></div>`;
    }).join('')}</div></div>`;
  }
  function bindRegionHover(root) {
    root.querySelectorAll('.regrow').forEach(e => { e.onmouseenter = () => setHL({ regionHi: +e.dataset.r }); e.onmouseleave = () => setHL({ regionHi: -1 }); });
  }

  /* ---------------- cards ---------------- */
  function openCards(forced) {
    const S = GM.S; const viewer = viewerPlayer();
    if (!viewer) { showModal({ title: 'Cards', sub: 'Rival realms keep their cards hidden.', body: '', buttons: [{ label: 'Close', onClick: closeModal }] }); return; }
    const canTrade = isHumanTurn() && viewer === curP() && S.phase === 'reinforce';
    const selIdx = new Set(); let dealt = false;
    const body = document.createElement('div');
    const render = () => {
      const val = S.cfg.cardMode === 'fixed' ? 'depends on the set (4/6/8/10)' : `<b style="color:var(--gold-hi)">${GM.nextTradeValue()}</b> armies`;
      body.innerHTML = `<p class="hint" style="text-align:center;margin-top:0">Next trade-in: ${val}. Three of a kind, one of each, or any two plus a wild card. If a card shows a territory you own, you get +2 armies there.</p>
        <div class="hand">${viewer.cards.length ? viewer.cards.map((c, i) => { const own = c.t >= 0 && S.owner[c.t] === viewer.idx; return `<button type="button" class="tcard ${c.type === 3 ? 'wild' : ''} ${selIdx.has(i) ? 'sel' : ''}" data-i="${i}" aria-pressed="${selIdx.has(i)}"><span class="ct">${c.t >= 0 ? esc(D.TERR[c.t].name) : 'Wild card'}</span><canvas class="card-scene" data-territory="${c.t}" aria-hidden="true"></canvas>${cardSVG(c.type)}<span><span class="ty">${D.CARD_TYPES[c.type].name}</span><span class="own">${own ? '+2 · yours' : ''}</span></span></button>`; }).join('') : '<p class="hint">No cards yet. Conquer at least one territory on your turn to earn one.</p>'}</div>`;
      body.querySelectorAll('.card-scene').forEach(canvas => {
        const t = +canvas.dataset.territory;
        G.VIGNETTE.paint(canvas, D.TERR[t < 0 ? 29 : t]);
      });
      const hand = body.querySelector('.hand'); if (hand) hand.classList.toggle('still', dealt); dealt = true;
      body.querySelectorAll('.tcard').forEach(c => c.onclick = () => { const i = +c.dataset.i; if (selIdx.has(i)) selIdx.delete(i); else if (selIdx.size < 3) selIdx.add(i); render(); upd(); });
    };
    const upd = () => {
      const b = $('#cTrade'); if (!b) return;
      const ok = canTrade && selIdx.size === 3 && GM.isSet([...selIdx].map(i => viewer.cards[i]));
      b.disabled = !ok;
      const cl = $('#cClose'); if (cl) cl.disabled = forced && GM.mustTrade();
    };
    showModal({
      wide: true, title: 'Territory cards', sub: canTrade ? (forced ? 'You must trade in a set before continuing.' : 'Select three cards to trade them in.') : 'You can only trade at the start of your turn.', body, locked: forced,
      buttons: [
        ...(canTrade ? [{ label: 'Best set', id: 'cBest', onClick: () => { const b = GM.bestSet(viewer.cards, viewer.idx); selIdx.clear(); if (b) b.forEach(i => selIdx.add(i)); render(); upd(); } },
        { label: 'Trade in', cls: 'gold', id: 'cTrade', disabled: true, onClick: () => {
          const r = GM.trade([...selIdx].sort((a, b) => a - b)); if (!r) return;
          SFX.coin(); toast(`Trade-in: <b>+${r.value}</b> armies${r.bonusT >= 0 ? ` and +2 on ${esc(D.TERR[r.bonusT].name)}` : ''}.`);
          if (r.bonusT >= 0) { VW().floatText(r.bonusT, '+2', '#ffe08a'); VW().ring(r.bonusT, '#ffe08a'); }
          selIdx.clear(); refresh();
          if (forced && !GM.mustTrade()) { closeModal(); return; }
          render(); upd();
        } }] : []),
        { label: forced ? 'Continue' : 'Close', id: 'cClose', onClick: () => { if (forced && GM.mustTrade()) return; closeModal(); } },
      ],
    });
    render(); upd();
  }

  /* ---------------- other tabs ---------------- */
  function openObjectives() {
    const S = GM.S; const viewer = viewerPlayer();
    const body = document.createElement('div');
    const rows = D.REGIONS.map(r => {
      const ts = GM.REGION_T[r.id]; const counts = {}; ts.forEach(t => { const o = S.owner[t]; counts[o] = (counts[o] || 0) + 1; });
      const ow = GM.regionOwner(r.id);
      return `<div class="regrow" data-r="${r.id}"><div><b>${esc(r.name)}</b><div class="hint" style="font-size:12.5px">${ts.length} territories · ${ow >= 0 ? 'held by the ' + esc(S.players[ow].fname) : 'contested'}</div></div><span class="bn">+${r.bonus}</span><div class="regbar">${Object.entries(counts).map(([o, c]) => `<i style="width:${c / ts.length * 100}%;background:${o >= 0 ? S.players[o].color : '#555'}"></i>`).join('')}</div></div>`;
    }).join('');
    body.innerHTML = `<div class="box" style="margin-bottom:14px"><h3>Victory condition</h3><p>${objectiveText(viewer)}</p></div><div class="regs">${rows}</div>`;
    showModal({ wide: true, title: 'Objectives and regions', sub: 'Holding a whole region grants its bonus armies every turn', body, buttons: [{ label: 'Close', onClick: closeModal }] });
    bindRegionHover(body);
  }
  function openLog() {
    const S = GM.S;
    const body = document.createElement('div');
    body.innerHTML = `<div class="loglist">${S.log.slice(-180).reverse().map(l => `<div style="border-left-color:${l.p >= 0 ? S.players[l.p].color : '#4b3418'}"><small>R${l.round}</small>${esc(l.text)}</div>`).join('')}</div>`;
    showModal({ wide: true, title: 'War chronicle', sub: 'Most recent events first', body, buttons: [{ label: 'Close', onClick: closeModal }] });
  }
  function openRules() {
    const body = document.createElement('div'); body.className = 'rules';
    body.innerHTML = `
      <h3>Setup</h3><ul>
        <li>Starting armies: 40 (2 players), 35 (3), 30 (4) and 25 (5). With two players you can add a neutral army that only defends.</li>
        <li>Each realm rolls one die and the highest goes first. Territories are dealt at random or claimed in turns, one at a time; then the remaining armies are placed one by one.</li></ul>
      <h3>1 · Reinforce</h3><ul>
        <li>You receive territories ÷ 3 (rounded down, minimum 3) plus the bonus of every region you hold completely.</li>
        <li>Card sets: three of a kind, one of each kind, or any two plus a wild card. Sets are worth 4, 6, 8, 10, 12, 15 and then +5 for each further trade-in (one counter shared by all realms).</li>
        <li>If a traded card shows a territory you own, you get 2 extra armies on it. With 5 or more cards you must trade.</li></ul>
      <h3>2 · Attack</h3><ul>
        <li>Only from territories with 2 or more armies, and only into neighbours (dashed sea routes count as borders).</li>
        <li>The attacker rolls 1, 2 or 3 dice (always one fewer than the armies there); the defender rolls 1 or 2. The highest dice are compared and the defender wins ties.</li>
        <li>When you conquer, you must move in at least as many armies as the dice you rolled on the last attack.</li>
        <li>If you eliminate a realm you take its cards. If that leaves you with 6 or more, you must trade in at once until you hold 4 or fewer.</li></ul>
      <h3>3 · Fortify</h3><ul>
        <li>One move at the end of the turn: armies from one of your territories to an adjacent one (or a connected one, depending on the option chosen), leaving at least one behind.</li>
        <li>If you conquered at least one territory this turn, you draw a card (only one per turn).</li></ul>
      <h3>Victory</h3><ul>
        <li>Classic: eliminate every rival realm. Missions: complete your secret objective. Quick: ${D.QUICK_TARGET || 26} territories, or the most when round 12 ends.</li></ul>
      <h3>Controls</h3><ul>
        <li>Drag to pan the map, scroll or pinch to zoom, double-click to zoom in.</li>
        <li>Reinforce: click +1, Shift+click +5. Escape cancels the selection.</li>
        <li>Keyboard: Space is the main action (next step, or attack during a battle), B blitz, R retreat, 1–3 choose dice, C cards, O objectives, L chronicle, F whole map, M mute.</li></ul>`;
    showModal({ wide: true, title: 'Rules of war', sub: 'The classic conquest rules, no shortcuts', body, buttons: [{ label: 'Close', onClick: closeModal }] });
  }
  function openSystemMenu() {
    const v = U.settings.vol; const body = document.createElement('div');
    body.innerHTML = `<div class="vols">
        <div class="vol"><label for="s-mus">Music</label><input type="range" id="s-mus" min="0" max="100" value="${Math.round(v.music * 100)}"><output>${Math.round(v.music * 100)}</output></div>
        <div class="vol"><label for="s-sfx">Effects</label><input type="range" id="s-sfx" min="0" max="100" value="${Math.round(v.sfx * 100)}"><output>${Math.round(v.sfx * 100)}</output></div>
      </div>
      <div class="opts">
      <div class="opt"><label for="s-speed">AI speed</label><select id="s-speed">${[['slow', 'Relaxed'], ['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']].map(([k, l]) => `<option value="${k}" ${U.settings.speed === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="opt"><label for="s-life">Clouds and map animations</label><select id="s-life"><option value="on" ${U.settings.life ? 'selected' : ''}>On</option><option value="off" ${U.settings.life ? '' : 'selected'}>Off</option></select></div></div>
      <div class="keys"><div><span>Main action</span><kbd>Space</kbd></div><div><span>Blitz · Retreat</span><span><kbd>B</kbd><kbd>R</kbd></span></div><div><span>Dice</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></span></div><div><span>Cards · Objectives</span><span><kbd>C</kbd><kbd>O</kbd></span></div><div><span>Move the map</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div><div><span>Whole map · Zoom</span><span><kbd>F</kbd><kbd>+</kbd><kbd>−</kbd></span></div><div><span>Mute</span><kbd>M</kbd></div></div>`;
    const apply = () => { U.settings.speed = $('#s-speed').value; U.settings.life = $('#s-life').value === 'on'; saveSettings(); applyLife(); };
    const buttons = [
      { label: 'Quit to main menu', onClick: () => { closeModal(); SFX.ambient(false); leaveOnline(); showMenu(); } },
      ...(document.documentElement.requestFullscreen ? [{ label: document.fullscreenElement ? 'Leave full screen' : 'Full screen', onClick: () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {} apply(); closeModal(); } }] : []),
      { label: 'Resume', cls: 'gold', onClick: () => { apply(); closeModal(); refresh(); } },
    ];
    showModal({ title: 'Menu', sub: 'The game saves automatically at the start of every turn', body, buttons });
    const bindVol = (id, k) => { const e = $(id); e.oninput = () => { U.settings.vol[k] = e.value / 100; e.nextElementSibling.textContent = e.value; SFX.setVolume(U.settings.vol); saveSettings(); }; e.onchange = () => { if (k === 'sfx') SFX.coin(); }; };
    bindVol('#s-mus', 'music'); bindVol('#s-sfx', 'sfx');
  }

  function onVictory(w) {
    const S = GM.S; const p = S.players[w.p];
    if (NET.on()) { if (NET.role === 'host') NET.clearHosting(); } else store.del(SAVE_KEY);
    setTimeout(() => {
      hideBattle(); SFX.victory();
      const reason = { domination: 'Every rival realm has fallen.', mission: `Secret mission accomplished: ${GM.missionText(p.mission, S.players)}`, quick: `They reached ${S.cfg.quickTarget} territories.`, time: 'When the rounds ran out, they held more territories than anyone.' }[w.reason] || '';
      const rows = S.players.map(q => `<tr class="${q.idx === p.idx ? 'win' : ''}"><td><span style="color:${q.color}">■</span> ${esc(q.fname)}</td><td>${GM.countTerr(q.idx)}</td><td>${q.stats.conquered}</td><td>${q.stats.killed}</td><td>${q.stats.died}</td><td>${q.stats.trades}</td></tr>`).join('');
      recordHistory();
      const body = `<div class="vic-shield">${shieldSVG(p, '')}</div>
        <p style="text-align:center;font-family:var(--f-map);font-size:18px;font-style:italic">${esc(reason)}</p>${ORN}
        <table class="st"><tr><th>Realm</th><th>Terr.</th><th>Conquests</th><th>Kills</th><th>Losses</th><th>Trade-ins</th></tr>${rows}</table>
        ${powerGraph()}
        <p class="hint" style="text-align:center">${S.round} rounds · ${S.turn} turns</p>`;
      showModal({ wide: true, title: `Victory for the ${p.fname}!`, sub: 'Middle-earth has a new sovereign', body, buttons: [{ label: 'Admire the map', onClick: () => { closeModal(); VW().overview(); } }, { label: 'New game', cls: 'gold', onClick: () => { closeModal(); showMenu(); } }] });
      SFX.tension(0); fireworks([p.light, p.color, '#f6dc94', '#fff3d0']);
      refresh();
    }, 900);
  }
  // territories held by each realm, turn by turn
  function powerGraph() {
    const S = GM.S, h = U.hist; if (h.length < 4) return '';
    const Wd = 600, Hd = 150, pad = 8, n = h.length, max = Math.max(8, ...h.map(x => Math.max(...x.c)));
    const X = i => pad + i / (n - 1) * (Wd - pad * 2), Y = v => Hd - pad - v / max * (Hd - pad * 2);
    const lines = S.players.map((q, pi) => `<polyline fill="none" stroke="${q.light}" stroke-width="${q.idx === S.winner.p ? 3 : 1.6}" stroke-linejoin="round" stroke-linecap="round" opacity="${q.idx === S.winner.p ? 1 : 0.75}" points="${h.map((x, i) => X(i).toFixed(1) + ',' + Y(x.c[pi] || 0).toFixed(1)).join(' ')}"/>`).join('');
    const grid = [0.25, 0.5, 0.75].map(k => `<line x1="${pad}" x2="${Wd - pad}" y1="${(pad + k * (Hd - pad * 2)).toFixed(1)}" y2="${(pad + k * (Hd - pad * 2)).toFixed(1)}" stroke="#6d5430" stroke-width="0.6" stroke-dasharray="3 5"/>`).join('');
    return `<svg class="graph" viewBox="0 0 ${Wd} ${Hd}" preserveAspectRatio="none" role="img" aria-label="Territories held by each realm over the war">${grid}${lines}</svg><div class="graph-cap">Territories held, turn by turn</div>`;
  }

  /* ---------------- particles: title embers and victory fireworks ---------------- */
  let menuRAF = 0, fwRAF = 0;
  function menuFx() {
    const cv = $('#menubg'); if (!cv || menuRAF) return; const c = cv.getContext('2d');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { cv.width = cv.height = 1; return; }
    const parts = []; let last = 0, w = 0, h = 0;
    const spawn = any => ({ x: Math.random(), y: any ? Math.random() : 1.05, r: 0.6 + Math.random() * 2.2, vy: 0.018 + Math.random() * 0.05, vx: (Math.random() - 0.4) * 0.02, ph: Math.random() * 6.283, hot: Math.random() });
    for (let i = 0; i < 90; i++) parts.push(spawn(true));
    const step = tm => {
      if ($('#screen-menu').hidden) { menuRAF = 0; c.clearRect(0, 0, w, h); return; }
      menuRAF = requestAnimationFrame(step);
      const dt = Math.min(0.05, last ? (tm - last) / 1000 : 0.016); last = tm;
      const dpr = Math.min(devicePixelRatio || 1, 1.5), W2 = Math.round(innerWidth * dpr), H2 = Math.round(innerHeight * dpr);
      if (W2 !== w || H2 !== h) { w = cv.width = W2; h = cv.height = H2; }
      c.clearRect(0, 0, w, h); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < parts.length; i++) {
        const q = parts[i]; q.y -= q.vy * dt; q.x += (q.vx + Math.sin(tm / 1400 + q.ph) * 0.012) * dt;
        if (q.y < -0.05) { parts[i] = spawn(false); continue; }
        const a = (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(tm / 300 * (0.5 + q.hot) + q.ph))) * Math.min(1, q.y * 3), r = q.r * dpr;
        const g = c.createRadialGradient(q.x * w, q.y * h, 0, q.x * w, q.y * h, r * 4);
        g.addColorStop(0, `rgba(255,${190 + q.hot * 50 | 0},${110 + q.hot * 60 | 0},${a})`); g.addColorStop(1, 'rgba(255,140,60,0)');
        c.fillStyle = g; c.beginPath(); c.arc(q.x * w, q.y * h, r * 4, 0, 7); c.fill();
      }
    };
    menuRAF = requestAnimationFrame(step);
  }
  function stopFireworks() { cancelAnimationFrame(fwRAF); fwRAF = 0; const cv = $('#fxOverlay'); if (cv) cv.hidden = true; }
  function fireworks(colors, ms = 11000) {
    const cv = $('#fxOverlay'); if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    stopFireworks(); cv.hidden = false; const c = cv.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 1.5); const w = cv.width = Math.round(innerWidth * dpr), h = cv.height = Math.round(innerHeight * dpr);
    const parts = []; let last = 0, nextShot = 0; const t0 = performance.now();
    const shot = () => {
      const x = (0.12 + Math.random() * 0.76) * w, y = (0.1 + Math.random() * 0.4) * h, col = colors[(Math.random() * colors.length) | 0], n = 46 + (Math.random() * 30 | 0), pw = (150 + Math.random() * 170) * dpr;
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = pw * (0.35 + Math.random() * 0.65); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 1.1 + Math.random() * 0.9, col, r: (1 + Math.random() * 1.6) * dpr }); }
      SFX.ui('back');
    };
    const step = tm => {
      const el = tm - t0; if (el > ms && !parts.length) { stopFireworks(); return; }
      fwRAF = requestAnimationFrame(step);
      const dt = Math.min(0.05, last ? (tm - last) / 1000 : 0.016); last = tm;
      if (el < ms && tm > nextShot) { shot(); nextShot = tm + 260 + Math.random() * 620; }
      c.clearRect(0, 0, w, h); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i]; q.life += dt; if (q.life > q.max) { parts.splice(i, 1); continue; }
        const d = Math.exp(-dt * 1.9); q.vx *= d; q.vy = q.vy * d + 120 * dpr * dt; const ox = q.x, oy = q.y; q.x += q.vx * dt; q.y += q.vy * dt;
        const k = q.life / q.max; c.globalAlpha = (1 - k) * (0.6 + 0.4 * Math.sin(q.life * 40 + i)); c.strokeStyle = q.col; c.lineWidth = q.r;
        c.beginPath(); c.moveTo(ox - q.vx * 0.03, oy - q.vy * 0.03); c.lineTo(q.x, q.y); c.stroke();
      }
      c.globalAlpha = 1;
    };
    fwRAF = requestAnimationFrame(step);
  }

  /* ---------------- modal / toast / banner ---------------- */
  function showModal({ title, sub, body, buttons, wide, locked }) {
    const m = $('#modal');
    m.innerHTML = `<div class="mcard ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}${ORN}<div class="mbody"></div><div class="acts"></div></div>`;
    const mb = m.querySelector('.mbody'); if (typeof body === 'string') mb.innerHTML = body; else if (body) mb.appendChild(body);
    const acts = m.querySelector('.acts');
    (buttons || []).forEach(b => { const e = document.createElement('button'); e.className = 'btn ' + (b.cls || ''); e.textContent = b.label; if (b.id) e.id = b.id; if (b.disabled) e.disabled = true; e.onclick = b.onClick; acts.appendChild(e); });
    if (m.hidden) SFX.page();
    m.hidden = false; m.dataset.locked = locked ? '1' : '';
    m.querySelectorAll('input[type=range]').forEach(rangeFill);
    const first = acts.querySelector('.btn.gold:not(:disabled)') || acts.querySelector('.btn'); if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
  }
  function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
  function rangeFill(r) { const lo = +r.min || 0, hi = +r.max || 100; r.style.setProperty('--v', (hi > lo ? (r.value - lo) / (hi - lo) * 100 : 100) + '%'); }
  function toast(html) { const e = document.createElement('div'); e.className = 'toast'; e.innerHTML = html; $('#toast').appendChild(e); setTimeout(() => e.remove(), 3300); }
  function banner(p, sub) {
    const old = document.getElementById('banner'); if (old) old.remove();
    const S = GM.S; const mine = !p.isAI && !p.neutral && (!NET.on() || p.cid === NET.cid);
    const who = mine ? (S && humans().length > 1 && !NET.on() ? 'Take the table' : 'Your turn') : p.isAI ? ({ easy: 'Recruit', normal: 'Captain', hard: 'Warlord' }[p.diff] || 'Computer') + ' · computer' : esc(p.pname || 'Rival realm');
    const b = document.createElement('div'); b.id = 'banner'; b.style.cssText = `--fc:${p.color};--fl:${p.light};--fd:${p.dark}ee`;
    b.innerHTML = `<div class="bn-band"><i class="bn-sheen"></i>${shieldSVG(p, '')}<div class="bn-text"><div class="t1">${esc(sub).toUpperCase()}</div><div class="t2">${esc(p.fname)}</div><div class="t3">${who}</div></div></div>`;
    $('#mapwrap').appendChild(b); setTimeout(() => b.remove(), 2700);
  }
  const PHASE_FX = { attack: ['Attack', 'Choose your battles', ICON.swords], fortify: ['Fortify', 'One last move', ICON.move], reinforce: ['Reinforce', 'Muster your armies', ICON.troops] };
  function phaseFlash(ph) {
    const d = PHASE_FX[ph]; if (!d) return;
    const old = document.getElementById('phaseflash'); if (old) old.remove();
    const e = document.createElement('div'); e.id = 'phaseflash'; e.innerHTML = `${d[2]}<div><b>${d[0].toUpperCase()}</b><span>${d[1]}</span></div>`;
    $('#mapwrap').appendChild(e); setTimeout(() => e.remove(), 1500); SFX.whoosh();
  }

  /* ---------------- bindings ---------------- */
  function bindUI() {
    document.querySelectorAll('.tab').forEach(button => {
      const label = button.querySelector('span').textContent;
      button.setAttribute('aria-label', label); button.title = label;
    });
    $('#btnNext').onclick = onNext;
    $('#zin').onclick = () => VW().zoomBy(1.35); $('#zout').onclick = () => VW().zoomBy(1 / 1.35); $('#zfit').onclick = () => VW().fit();
    $('#tabs').onclick = e => {
      const b = e.target.closest('.tab'); if (!b || !GM.S) return;
      const k = b.dataset.tab;
      if (k === 'map') { closeModal(); return; }
      if (k === 'obj') openObjectives(); else if (k === 'cards') openCards(false); else if (k === 'log') openLog(); else if (k === 'rules') openRules();
    };
    $('#btnSound').onclick = () => { U.settings.sound = !U.settings.sound; SFX.enabled = U.settings.sound; saveSettings(); $('#sndWaves').style.opacity = U.settings.sound ? 1 : 0.15; if (U.settings.sound) { if (GM.S && $('#screen-menu').hidden) SFX.ambient(true); if (SFX.wantMusic) SFX.music(true); } };
    SFX.enabled = U.settings.sound; $('#sndWaves').style.opacity = U.settings.sound ? 1 : 0.15;
    if (!U.settings.vol || typeof U.settings.vol.music !== 'number') U.settings.vol = { music: 0.55, sfx: 0.8 };
    SFX.setVolume(U.settings.vol);
    // the score starts with the first touch (browsers keep audio locked until then)
    const firstTouch = () => { document.removeEventListener('pointerdown', firstTouch, true); SFX.unlock(); startMusic(); };
    document.addEventListener('pointerdown', firstTouch, true);
    // interface sounds
    const UI_SEL = '.btn, .tab, .iconbtn, .mode, .chip, .tcard, .dsel button, select';
    document.addEventListener('pointerover', e => { const b = e.target.closest && e.target.closest(UI_SEL); if (b && !b.disabled && b !== U.lastHover && e.pointerType === 'mouse') { U.lastHover = b; SFX.ui('hover'); } if (!b) U.lastHover = null; });
    document.addEventListener('click', e => { const b = e.target.closest && e.target.closest(UI_SEL); if (b && !b.disabled) SFX.ui(/Cancel|Close|Retreat|Leave/.test(b.textContent) ? 'back' : 'click'); }, true);
    document.addEventListener('input', e => { if (e.target.type === 'range') rangeFill(e.target); });
    $('#btnMenu').onclick = () => { if (GM.S) openSystemMenu(); };
    const syncDrawers = () => {
      $('#btnLeft').setAttribute('aria-expanded', $('#left').classList.contains('open'));
      $('#btnRight').setAttribute('aria-expanded', $('#right').classList.contains('open'));
    };
    $('#btnLeft').onclick = () => { $('#left').classList.toggle('open'); $('#right').classList.remove('open'); syncDrawers(); };
    $('#btnRight').onclick = () => { $('#right').classList.toggle('open'); $('#left').classList.remove('open'); syncDrawers(); };
    syncDrawers();
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('#modal').dataset.locked) closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!$('#modal').hidden) { if (!$('#modal').dataset.locked) closeModal(); return; }
        if ($('#left').classList.contains('open') || $('#right').classList.contains('open')) {
          $('#left').classList.remove('open'); $('#right').classList.remove('open'); syncDrawers(); return;
        }
        if (!U.busy) { hideBattle(); clearSel(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || !GM.S || !$('#screen-menu').hidden || !$('#modal').hidden) return;
      const tg = e.target; if (tg && /^(INPUT|SELECT|TEXTAREA)$/.test(tg.tagName)) return;
      if (VW().key && VW().key(e, true)) { e.preventDefault(); return; }
      const k = e.key.toLowerCase(), inBattle = U.battle && !U.battle.ai;
      if (k === ' ' || k === 'enter') { if (tg && tg.tagName === 'BUTTON') return; e.preventDefault(); if (inBattle) humanAttack(false); else onNext(); }
      else if (inBattle && k === 'b') humanAttack(true);
      else if (inBattle && k === 'r') { if (!U.busy) $('#bRet').click(); }
      else if (inBattle && '123'.includes(k)) { const b = document.querySelector(`#dsel button[data-n="${k}"]`); if (b && !b.disabled) b.click(); }
      else if (k === 'm') $('#btnSound').click();
      else if (k === 'f') VW().fit();
      else if (k === 'c') openCards(false); else if (k === 'o') openObjectives(); else if (k === 'l') openLog(); else if (k === 'h') openRules();
      else if (k === '+' || k === '=') VW().zoomBy(1.35); else if (k === '-') VW().zoomBy(1 / 1.35);
    });
    document.addEventListener('keyup', e => { if (VW().key) VW().key(e, false); });
    GM.on('change', () => { refresh(); netLocalChange(); });
    GM.on('turnStart', () => { if (!U.suppressTurn) onTurnStart(false); });
    GM.on('victory', onVictory);
    GM.on('setupDone', () => { save(); });
    GM.on('eliminated', ({ p, by }) => { const S = GM.S; toast(`The <b>${esc(S.players[by].fname)}</b> wipe out the ${esc(S.players[p].fname)}.`); SFX.eliminated(); VW().shake(700, 10); });
    GM.on('phase', ({ phase }) => { SFX.tension(phase === 'attack' ? 0.5 : 0.25); if (isHumanTurn() && !netApplying) phaseFlash(phase); });
    GM.on('turnEnd', ({ p, card }) => { const S = GM.S; if (card && S.players[p].isAI) toast(`The ${esc(S.players[p].fname)} draw a card.`); });
  }


  /* ---------------- online rooms ---------------- */
  const NET = G.NET; let netTimer = null, netApplying = false, battleHide = null, roomOpen = false;
  (function () { const st = document.createElement('style'); st.textContent = '#modal{z-index:60}.netinput{width:100%;padding:10px 12px;border-radius:3px;background:#120c07;color:var(--ivory);border:1px solid #6a4b22;font:inherit;font-size:16px}.netrow{display:flex;gap:8px;align-items:center}.netrow .netinput{flex:1;min-width:0}.netdot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;background:#6a5a44}.netdot.on{background:#7fd08a;box-shadow:0 0 8px #7fd08a}.netseat{display:grid;grid-template-columns:38px 1fr auto;gap:12px;align-items:center;padding:8px 12px;background:#1b1209;border:1px solid #3d2a13;border-radius:4px}.netseat svg{width:34px;height:40px}.netseats{display:grid;gap:8px;margin-top:12px}.netstatus{text-align:center;margin-top:10px;min-height:20px}'; document.head.appendChild(st); })();
  const canDriveAI = () => !NET.on() || NET.role === 'host';
  function netSnapshot() { const o = JSON.parse(GM.serialize()); o.log = o.log.slice(-50); return JSON.stringify(o); }
  function netLocalChange() {
    if (!NET.on() || netApplying) return;
    if (netTimer) return; // throttle: at most one publish every 110 ms, never starved
    netTimer = setTimeout(() => { netTimer = null; const S = GM.S; if (!S || !NET.on()) return; S.rev = (S.rev || 0) + 1; NET.pushState(netSnapshot()); }, 110);
  }
  function netApply({ json, from, sync }) {
    let inc; try { inc = JSON.parse(json); } catch (e) { return; }
    const S0 = U.netLive ? GM.S : null;
    if (NET.role === 'host') { const cur = GM.S && GM.S.players[GM.S.current]; if (!cur || cur.cid !== from) return; }
    if (S0 && !sync && (inc.rev || 0) <= (S0.rev || 0)) return;
    const old = S0 ? { owner: S0.owner.slice(), armies: S0.armies.slice(), turn: S0.turn, atk: S0.atkSeq || 0, winner: S0.winner } : null;
    netApplying = true; try { GM.restore(json); } finally { netApplying = false; }
    const S = GM.S; U.netLive = true; U.aiToken++; U.running = false;
    if (!$('#screen-menu').hidden) { $('#screen-menu').hidden = true; enterHUD(); U.hist = []; U.regPrev = null; closeModal(); roomOpen = false; clearSel(); VW().resize && VW().resize(); VW().home && VW().home(); SFX.ambient(true); startMusic(); }
    if (NET.role === 'host') NET.relay(json, from);
    if (old) netFx(old, S);
    if ((!old || old.turn !== S.turn) && S.phase !== 'over') { banner(curP(), `Round ${S.round}`); recordHistory(); if (isHumanTurn()) { SFX.horn(); toast('<b>Your turn.</b>'); showFront(); } }
    if (S.winner && !(old && old.winner)) onVictory(S.winner);
    refresh(); updateNetChip();
    if (isHumanTurn() && GM.mustTrade() && $('#modal').hidden) openCards(true);
    if (NET.role === 'host') proceed();
  }
  function netFx(old, S) {
    const r = S.lastAttack; const battle = (S.atkSeq || 0) !== old.atk && r;
    if (battle) {
      try { setHL({ arrow: { a: r.a, b: r.b, kind: 'attack' }, src: r.a, sel: -1, targets: new Set([r.b]), kind: 'attack' }); showBattle(r.a, r.b, true); animateBattle(r, true).catch(() => {}); } catch (e) { console.error(e); }
      clearTimeout(battleHide); battleHide = setTimeout(() => { if (U.battle && U.battle.ai) { hideBattle(); setHL({ arrow: null, src: -1, targets: new Set(), kind: null }); } }, 2400);
    }
    let conquered = false;
    for (let t = 0; t < S.owner.length; t++) {
      if (battle && (t === r.a || t === r.b)) continue;
      if (S.owner[t] !== old.owner[t]) { if (S.owner[t] >= 0) { if (old.owner[t] >= 0) { conquered = true; VW().conquest(t, S.players[S.owner[t]]); } else { VW().flash(t, S.players[S.owner[t]].light); VW().ring(t, S.players[S.owner[t]].light); } } }
      else { const d = S.armies[t] - old.armies[t]; if (d > 0) { VW().ring(t, '#ffe08a'); VW().floatText(t, '+' + d, '#ffe08a'); } else if (d < 0) VW().floatText(t, '−' + (-d), '#ff8a72'); }
    }
    if (conquered) SFX.conquer(); else if (!battle && S.armies.some((a, i) => a !== old.armies[i])) SFX.thud();
  }
  function updateNetChip() {
    const b = $('#btnNet'); if (!b) return; b.hidden = !NET.role;
    b.style.color = NET.status === 'open' ? '#7fd08a' : NET.status === 'reconnecting' || NET.status === 'connecting' ? '#f0c060' : '';
    b.title = NET.role ? `Online room ${NET.code}` : 'Online room';
  }
  function leaveOnline() { if (!NET.role) return; NET.leave(); U.netLive = false; roomOpen = false; updateNetChip(); }

  function askName(title, sub, go, okLabel) {
    const body = document.createElement('div');
    body.innerHTML = `<label class="hint" for="netName" style="display:block;margin-bottom:6px;font-style:normal">Your name</label><input class="netinput" id="netName" maxlength="24" autocomplete="nickname"><div class="netstatus hint" id="netMsg"></div>`;
    const inp = body.querySelector('#netName'); inp.value = NET.name || '';
    const run = async () => {
      const n = inp.value.trim(); if (!n) { body.querySelector('#netMsg').textContent = 'Enter a name so the others know who you are.'; inp.focus(); return; }
      NET.setName(n); const btn = $('#netGo'); if (btn) btn.disabled = true; body.querySelector('#netMsg').textContent = 'Connecting…';
      try { await go(); } catch (e) { body.querySelector('#netMsg').textContent = e.message || 'Could not connect.'; if (btn) btn.disabled = false; }
    };
    showModal({ title, sub, body, buttons: [{ label: 'Cancel', onClick: () => { closeModal(); leaveOnline(); } }, { label: okLabel, cls: 'gold', id: 'netGo', onClick: run }] });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); }); setTimeout(() => inp.focus(), 60);
  }
  function hostOnline(cfg, seats) {
    askName('Host an online game', 'You open a room and share its link. The game is saved on this device.', async () => {
      await NET.host({ cfg, seats }); updateNetChip(); openRoom();
    }, 'Open the room');
  }
  function reopenOnline() {
    const saved = NET.savedHosting(); if (!saved) return;
    askName(`Reopen room ${saved.code}`, 'Players who open the same link take their realms back.', async () => {
      await NET.host({ resume: saved }); updateNetChip();
      if (saved.started && saved.room.state) {
        netApplying = true; try { GM.restore(saved.room.state); } finally { netApplying = false; }
        U.netLive = true; U.aiToken++; U.running = false; U.busy = false;
        $('#screen-menu').hidden = true; closeModal(); clearSel(); VW().resize && VW().resize(); refresh(true); SFX.ambient(true);
        toast('Room reopened. Waiting for players to come back.'); openRoom(); proceed();
      } else openRoom();
    }, 'Reopen the room');
  }
  function joinOnline(code) {
    askName(`Join room ${code}`, 'You will take one of the open realms.', async () => { await NET.join(code); updateNetChip(); if (!NET.started) openRoom(); }, 'Join');
  }
  function startOnline() {
    if (NET.role !== 'host' || NET.started) return;
    const cfg = Object.assign({}, NET.room.cfg, { players: NET.playersForGame() });
    NET.startGameAsHost(); U.netLive = true; roomOpen = false; closeModal();
    startGame(cfg); netLocalChange();
  }
  function openRoom() {
    if (!NET.role) return; roomOpen = true;
    const host = NET.role === 'host'; const room = host ? NET.publicRoom() : NET.room;
    const body = document.createElement('div');
    if (!room) { body.innerHTML = '<p class="hint" style="text-align:center">Connecting to the host…</p>'; }
    else {
      const S = GM.S; const live = NET.started && S;
      const rows = room.seats.map((s, i) => {
        const f = facObj(s.faction); const pl = live ? S.players.find(p => p.faction === s.faction) : null;
        let who, dot = '';
        if (s.kind === 'ai' || (live && pl && pl.isAI && !pl.cid)) who = 'Computer player';
        else if (s.kind === 'host') { who = `${esc(s.name || room.hostName)} · host`; dot = `<span class="netdot ${host || NET.status === 'open' ? 'on' : ''}"></span>`; }
        else if (s.taken) { who = esc(s.name || 'Player') + (i === NET.you ? ' · you' : '') + (live && pl && pl.isAI ? ' · AI is playing' : ''); dot = `<span class="netdot ${s.online ? 'on' : ''}"></span>`; }
        else who = live ? 'Computer player' : 'Open — waiting for a player…';
        const ctl = host && live && pl && pl.cid && s.kind === 'open' && pl.alive ? `<button class="btn sm" data-ai="${pl.idx}">${pl.isAI ? 'Hand back' : 'Let the AI play'}</button>` : '';
        return `<div class="netseat">${shieldSVG(f, '')}<div style="min-width:0"><b style="font-family:var(--f-display)">${esc(f.name)}</b><div class="hint" style="font-style:normal">${dot}${who}</div></div><div>${ctl}</div></div>`;
      }).join('');
      body.innerHTML = `<div class="netrow"><input class="netinput" id="netLink" readonly><button class="btn sm" id="netCopy">Copy link</button></div>
        <div class="netseats">${rows}</div>
        <div class="netstatus hint">${host ? (NET.started ? 'The game is saved on this device. Reopen this room from the main menu to continue another day.' : 'Empty realms are played by the AI when you start.') : (NET.started ? '' : 'Waiting for the host to start the war…')}</div>`;
      const li = body.querySelector('#netLink'); li.value = NET.link();
      body.querySelector('#netCopy').onclick = async () => { try { await navigator.clipboard.writeText(li.value); toast('Link copied.'); } catch (e) { li.focus(); li.select(); } };
      body.querySelectorAll('[data-ai]').forEach(b => b.onclick = () => {
        const p = GM.S.players[+b.dataset.ai]; if (U.running && GM.S.current === p.idx) { toast('Wait for the AI to finish this turn.'); return; }
        p.isAI = !p.isAI; if (p.isAI) p.diff = 'normal'; GM.emit('change'); openRoom(); proceed();
      });
    }
    const buttons = [];
    if (host && !NET.started) buttons.push({ label: 'Close the room', onClick: () => { closeModal(); NET.clearHosting(); leaveOnline(); } }, { label: 'Start the war', cls: 'gold', onClick: startOnline });
    else if (!NET.started) buttons.push({ label: 'Leave', onClick: () => { closeModal(); leaveOnline(); } });
    else buttons.push({ label: 'Close', cls: 'gold', onClick: () => { roomOpen = false; closeModal(); } });
    showModal({ title: `Online room ${NET.code}`, sub: host ? 'Share the link. Friends who open it take the open realms.' : (room ? `Hosted by ${esc(room.hostName)}` : ''), body, buttons, locked: !NET.started });
  }
  NET.handlers.lobby = () => { updateNetChip(); if (roomOpen || (NET.role === 'guest' && !NET.started && !$('#screen-menu').hidden)) openRoom(); if (GM.S && U.netLive) refresh(); };
  NET.handlers.remoteState = netApply;
  NET.handlers.status = () => updateNetChip();
  NET.handlers.guest = ({ name, seated }) => toast(`<b>${esc(name)}</b> ${seated ? 'joined the room.' : 'is watching.'}`);
  NET.handlers.closed = () => { toast('The host closed the room.'); U.netLive = false; roomOpen = false; setTimeout(updateNetChip, 50); };
  function netBoot() {
    const b = $('#btnNet'); if (b) b.onclick = () => openRoom();
    const code = NET.codeFromHash(); if (code) joinOnline(code);
  }

  G.UI = U;
  let booted = false; const go = () => { if (!booted) { booted = true; boot(); } };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', go); else go();
})(window);
