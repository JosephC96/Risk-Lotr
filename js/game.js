/* Rules engine — classic territory-conquest rules (reinforce / attack / fortify, cards, missions) */
(function (G) {
  const D = G.DATA;
  const NT = D.TERR.length;
  const TERR_MISSION = Math.ceil(NT * 24 / 42), GARRISON_MISSION = Math.ceil(NT * 18 / 42);
  const listeners = {};
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, data) { (listeners[ev] || []).forEach(f => { try { f(data); } catch (e) { console.error(e); } }); }

  const START_ARMIES = { 2: 40, 3: 35, 4: 30, 5: 25 };
  const TRADE_SEQ = [4, 6, 8, 10, 12, 15];

  let S = null; // state

  function shuffle(a, rnd = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function rollDie() { return 1 + Math.floor(Math.random() * 6); }

  function regionTerr(r) { return D.TERR.filter(t => t.region === r).map(t => t.id); }
  const REGION_T = D.REGIONS.map(r => regionTerr(r.id));

  /* ---------- missions ---------- */
  const MISSION_REGIONS = [
    { regions: [1, 6, 2], extra: false },
    { regions: [3, 4, 5], extra: false },
    { regions: [0, 4], extra: true },
    { regions: [7, 8, 6], extra: false },
    { regions: [1, 5], extra: true },
    { regions: [2, 3, 0], extra: false },
  ];
  function missionText(m, players) {
    if (!m) return '';
    if (m.type === 'terr') return `Conquer ${m.n} territories.`;
    if (m.type === 'terr2') return `Occupy ${m.n} territories with at least 2 armies on each.`;
    if (m.type === 'regions') {
      const names = m.regions.map(r => D.REGIONS[r].name);
      const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
      return `Conquer ${list}${m.extra ? ', plus one more region of your choice' : ''}.`;
    }
    if (m.type === 'destroy') { const p = players[m.target]; return `Destroy the ${p ? p.fname : '—'} completely. If another realm does it first, conquer ${TERR_MISSION} territories.`; }
    return '';
  }

  /* ---------- setup ---------- */
  function newGame(cfg) {
    const seats = cfg.players; // [{faction, type:'human'|'ai', diff}]
    const n = seats.length;
    const players = seats.map((s, i) => {
      const f = D.FACTIONS[s.faction];
      return { idx: i, cid: s.cid || null, pname: s.pname || '', faction: s.faction, fname: f.name, short: f.short, color: f.color, light: f.light, dark: f.dark, emblem: f.emblem, isAI: s.type === 'ai', diff: s.diff || 'normal', cards: [], alive: true, neutral: false, mission: null, stats: { conquered: 0, lost: 0, killed: 0, died: 0, battles: 0, trades: 0, maxTerr: 0 } };
    });
    if (n === 2 && cfg.neutral) {
      const f = D.NEUTRAL;
      players.push({ idx: 2, faction: 5, fname: f.name, short: f.short, color: f.color, light: f.light, dark: f.dark, emblem: f.emblem, isAI: true, diff: 'normal', cards: [], alive: true, neutral: true, mission: null, stats: { conquered: 0, lost: 0, killed: 0, died: 0, battles: 0, trades: 0, maxTerr: 0 } });
    }
    const deck = [];
    const types = [];
    for (let i = 0; i < NT; i++) types.push(i % 3);
    const rnd = G.NZ.mulberry32(31);
    shuffle(types, rnd);
    for (let i = 0; i < NT; i++) deck.push({ t: i, type: types[i] });
    deck.push({ t: -1, type: 3 }, { t: -1, type: 3 });
    shuffle(deck);

    S = {
      v: 1, mapId: D.MAP_ID || null, cfg, players, owner: new Array(NT).fill(-1), armies: new Array(NT).fill(0),
      current: 0, phase: 'setup', turn: 0, round: 1, tradeCount: 0, deck, discard: [],
      log: [], conquered: false, fortified: false, reinforcements: 0, reinfDetail: null,
      pending: null, setupPool: [], winner: null, returnToAttack: false, lastAttack: null, history: [],
    };
    const start = (START_ARMIES[n] || 25) + Math.max(0, Math.ceil(NT / players.length) - Math.ceil(42 / players.length));
    S.setupPool = players.map(() => start);

    // missions
    if (cfg.mode === 'missions') {
      const pool = [{ type: 'terr', n: TERR_MISSION }, { type: 'terr2', n: GARRISON_MISSION }];
      MISSION_REGIONS.forEach(m => pool.push({ type: 'regions', regions: m.regions, extra: m.extra }));
      players.forEach(p => { if (!p.neutral) pool.push({ type: 'destroy', target: p.idx }); });
      shuffle(pool);
      players.forEach(p => {
        if (p.neutral) return;
        let k = pool.findIndex(m => !(m.type === 'destroy' && m.target === p.idx));
        p.mission = pool.splice(k, 1)[0];
      });
    }

    // first player
    // classic: everyone rolls one die, highest starts (ties re-roll)
    let contenders = players.filter(p => !p.neutral).map(p => p.idx);
    S.startRolls = [];
    while (contenders.length > 1) {
      const round = contenders.map(i => ({ p: i, v: rollDie() }));
      S.startRolls.push(round);
      const max = Math.max(...round.map(r => r.v));
      contenders = round.filter(r => r.v === max).map(r => r.p);
    }
    S.first = contenders[0];
    S.current = S.first;

    const order = [];
    for (let k = 0; k < players.length; k++) order.push((S.first + k) % players.length);

    if (cfg.deal === 'manual' && cfg.mode !== 'quick') {
      S.phase = 'claim';
      log(`Territory claiming begins. The ${players[S.first].fname} go first.`, S.first);
    } else {
      const ts = shuffle([...Array(NT).keys()]);
      ts.forEach((t, i) => { const p = order[i % order.length]; S.owner[t] = p; S.armies[t] = 1; S.setupPool[p]--; });
      log('The territories have been dealt at random among the realms.');
      // neutral auto places all
      players.forEach(p => { if (p.neutral) autoDistribute(p.idx); });
      if (cfg.mode === 'quick') {
        players.forEach(p => autoDistribute(p.idx));
        beginTurns();
        return S;
      }
      S.phase = 'place';
      log('Take turns placing your remaining armies, one at a time.');
    }
    skipNeutralSetup();
    return S;
  }

  function autoDistribute(pi) {
    const mine = S.owner.map((o, i) => o === pi ? i : -1).filter(i => i >= 0);
    if (!mine.length) { S.setupPool[pi] = 0; return; }
    const p = S.players[pi];
    if (p.neutral) {
      while (S.setupPool[pi] > 0) { const t = mine[Math.floor(Math.random() * mine.length)]; S.armies[t]++; S.setupPool[pi]--; }
      return;
    }
    // weight border territories and those in regions we hold most of
    const w = mine.map(t => {
      const enemies = D.TERR[t].adj.filter(a => S.owner[a] !== pi).length;
      const reg = D.TERR[t].region; const rt = REGION_T[reg];
      const frac = rt.filter(x => S.owner[x] === pi).length / rt.length;
      return enemies ? 1 + enemies * 0.6 + frac * 3 : 0.05;
    });
    const sum = w.reduce((a, b) => a + b, 0);
    while (S.setupPool[pi] > 0) {
      let r = Math.random() * sum, k = 0;
      while (k < w.length - 1 && r > w[k]) { r -= w[k]; k++; }
      S.armies[mine[k]]++; S.setupPool[pi]--;
    }
  }

  function nextSetupPlayer() {
    const n = S.players.length;
    for (let k = 1; k <= n; k++) {
      const c = (S.current + k) % n;
      if (S.phase === 'claim') return c;
      if (S.setupPool[c] > 0) return c;
    }
    return -1;
  }
  function skipNeutralSetup() {
    // neutral acts instantly during setup
    let guard = 0;
    while (S.players[S.current].neutral && guard++ < 200) {
      if (S.phase === 'claim') {
        const free = S.owner.map((o, i) => o < 0 ? i : -1).filter(i => i >= 0);
        if (!free.length) break;
        claim(free[Math.floor(Math.random() * free.length)], true);
      } else if (S.phase === 'place') {
        const mine = S.owner.map((o, i) => o === S.current ? i : -1).filter(i => i >= 0);
        if (S.setupPool[S.current] > 0) setupPlace(mine[Math.floor(Math.random() * mine.length)], true);
        else break;
      } else break;
    }
  }

  function claim(t, internal) {
    if (S.phase !== 'claim' || S.owner[t] >= 0) return false;
    const p = S.current;
    S.owner[t] = p; S.armies[t] = 1; S.setupPool[p]--;
    emit('claim', { t, p });
    if (S.owner.every(o => o >= 0)) {
      S.phase = 'place';
      log('Every territory is claimed. Now place your remaining armies.');
      S.players.forEach(pl => { if (pl.neutral) autoDistribute(pl.idx); });
    }
    advanceSetup();
    if (!internal) emit('change');
    return true;
  }
  function setupPlace(t, internal) {
    const p = S.current;
    if (S.phase !== 'place' || S.owner[t] !== p || S.setupPool[p] <= 0) return false;
    S.armies[t]++; S.setupPool[p]--;
    emit('place', { t, p, n: 1 });
    advanceSetup();
    if (!internal) emit('change');
    return true;
  }
  function setupAutoRest() {
    const p = S.current; if (S.phase !== 'place') return;
    autoDistribute(p);
    advanceSetup(); emit('change');
  }
  function advanceSetup() {
    if (S.phase === 'place' && S.setupPool.every(v => v <= 0)) { beginTurns(); return; }
    const nx = nextSetupPlayer();
    if (nx >= 0) S.current = nx;
    skipNeutralSetup();
    if (S.phase === 'place' && S.setupPool.every(v => v <= 0)) beginTurns();
  }

  function beginTurns() {
    S.current = S.first; S.turn = 0; S.round = 1;
    log('The war begins!');
    emit('setupDone');
    startTurn();
  }

  /* ---------- reinforcements ---------- */
  function countTerr(p) { let n = 0; for (let i = 0; i < NT; i++) if (S.owner[i] === p) n++; return n; }
  function countArmies(p) { let n = 0; for (let i = 0; i < NT; i++) if (S.owner[i] === p) n += S.armies[i]; return n; }
  function regionOwner(r) { const ts = REGION_T[r]; const o = S.owner[ts[0]]; return ts.every(t => S.owner[t] === o) ? o : -1; }
  function calcReinforcements(p) {
    const n = countTerr(p);
    const base = Math.max(3, Math.floor(n / 3));
    const regions = D.REGIONS.filter(r => regionOwner(r.id) === p).map(r => ({ id: r.id, name: r.name, bonus: r.bonus }));
    const total = base + regions.reduce((a, r) => a + r.bonus, 0);
    return { terr: n, base, regions, total };
  }

  function startTurn() {
    const p = S.players[S.current];
    S.turn++;
    S.conquered = false; S.fortified = false; S.pending = null; S.returnToAttack = false; S.lastAttack = null;
    S.phase = 'reinforce'; S.placed = {};
    const r = calcReinforcements(S.current);
    S.reinforcements = r.total; S.reinfDetail = r;
    log(`${p.fname}: ${r.total} reinforcements${r.regions.length ? ' (including ' + r.regions.map(x => x.name + ' +' + x.bonus).join(', ') + ')' : ''}.`, p.idx);
    emit('turnStart', { p: S.current });
    emit('change');
  }

  /* ---------- cards ---------- */
  function nextTradeValue() {
    if (S.cfg.cardMode === 'fixed') return null;
    const k = S.tradeCount;
    return k < TRADE_SEQ.length ? TRADE_SEQ[k] : 15 + 5 * (k - TRADE_SEQ.length + 1);
  }
  function setValue(cards) {
    if (S.cfg.cardMode === 'fixed') {
      const ty = cards.map(c => c.type).filter(t => t !== 3);
      const uniq = new Set(ty);
      if (uniq.size === 1 && ty.length === 3) return [4, 6, 8][ty[0]];
      if (uniq.size === 3) return 10;
      if (ty.length < 3) { // wild involved
        if (uniq.size === 2) return 10;
        return [4, 6, 8][ty[0]];
      }
      return 0;
    }
    return nextTradeValue();
  }
  function isSet(cards) {
    if (cards.length !== 3) return false;
    const wild = cards.filter(c => c.type === 3).length;
    if (wild >= 1) return true; // any two + wild
    const ty = cards.map(c => c.type);
    const u = new Set(ty).size;
    return u === 1 || u === 3;
  }
  function bestSet(cards, p) {
    let best = null, bestScore = -1;
    for (let a = 0; a < cards.length; a++) for (let b = a + 1; b < cards.length; b++) for (let c = b + 1; c < cards.length; c++) {
      const set = [cards[a], cards[b], cards[c]];
      if (!isSet(set)) continue;
      const wilds = set.filter(x => x.type === 3).length;
      const owned = set.some(x => x.t >= 0 && S.owner[x.t] === p) ? 2 : 0;
      const score = (setValue(set) || 0) + owned - wilds * 1.5;
      if (score > bestScore) { bestScore = score; best = [a, b, c]; }
    }
    return best;
  }
  function trade(idxs) {
    const p = S.players[S.current];
    if (S.phase !== 'reinforce') return null;
    const cards = idxs.map(i => p.cards[i]);
    if (cards.some(c => !c) || !isSet(cards)) return null;
    const value = setValue(cards);
    let bonusT = -1;
    for (const c of cards) if (c.t >= 0 && S.owner[c.t] === S.current) { bonusT = c.t; break; }
    if (bonusT >= 0) S.armies[bonusT] += 2;
    S.reinforcements += value;
    S.tradeCount++;
    p.stats.trades++;
    p.cards = p.cards.filter((_, i) => !idxs.includes(i));
    S.discard.push(...cards);
    log(`${p.fname} trade cards for ${value} armies${bonusT >= 0 ? ` (+2 on ${D.TERR[bonusT].name})` : ''}.`, p.idx);
    emit('trade', { p: S.current, value, bonusT });
    emit('change');
    return { value, bonusT };
  }
  function mustTrade() { const p = S.players[S.current]; return S.phase === 'reinforce' && p.cards.length >= 5; }
  function drawCard(pi) {
    if (!S.deck.length) { S.deck = shuffle(S.discard); S.discard = []; }
    const c = S.deck.pop(); if (c) S.players[pi].cards.push(c); return c;
  }

  /* ---------- reinforce / place ---------- */
  function place(t, n) {
    const p = S.current;
    if (S.phase !== 'reinforce' || S.owner[t] !== p) return 0;
    n = Math.min(n, S.reinforcements); if (n <= 0) return 0;
    S.armies[t] += n; S.reinforcements -= n;
    S.placed = S.placed || {}; S.placed[t] = (S.placed[t] || 0) + n;
    emit('place', { t, p, n });
    emit('change');
    return n;
  }
  function unplace(t) {
    if (S.phase !== 'reinforce' || !S.placed || !S.placed[t]) return false;
    S.placed[t]--; S.armies[t]--; S.reinforcements++;
    emit('change'); return true;
  }
  function endReinforce() {
    if (S.phase !== 'reinforce' || S.reinforcements > 0 || mustTrade()) return false;
    S.phase = 'attack';
    if (S.returnToAttack) { S.returnToAttack = false; }
    emit('phase', { phase: 'attack' }); emit('change');
    return true;
  }

  /* ---------- combat ---------- */
  function canAttack(a, b) {
    return S.phase === 'attack' && !S.pending && S.owner[a] === S.current && S.owner[b] !== S.current && S.armies[a] >= 2 && D.TERR[a].adj.includes(b);
  }
  function attack(a, b, dice) {
    if (!canAttack(a, b)) return null;
    const ad = Math.max(1, Math.min(dice || 3, 3, S.armies[a] - 1));
    const dd = Math.min(2, S.armies[b]);
    const A = [], Dd = [];
    for (let i = 0; i < ad; i++) A.push(rollDie());
    for (let i = 0; i < dd; i++) Dd.push(rollDie());
    A.sort((x, y) => y - x); Dd.sort((x, y) => y - x);
    let al = 0, dl = 0; const pairs = [];
    for (let i = 0; i < Math.min(ad, dd); i++) { const win = A[i] > Dd[i]; if (win) dl++; else al++; pairs.push(win); }
    const att = S.players[S.current], defIdx = S.owner[b], def = S.players[defIdx];
    S.armies[a] -= al; S.armies[b] -= dl;
    att.stats.battles++; att.stats.killed += dl; att.stats.died += al; def.stats.killed += al; def.stats.died += dl;
    const res = { a, b, A, D: Dd, pairs, al, dl, conquered: false, attacker: S.current, defender: defIdx, eliminated: false };
    if (S.armies[b] <= 0) {
      S.owner[b] = S.current; S.armies[b] = 0;
      S.conquered = true; res.conquered = true;
      att.stats.conquered++; def.stats.lost++;
      S.pending = { from: a, to: b, min: Math.min(ad, S.armies[a] - 1), max: S.armies[a] - 1 };
      log(`${att.fname} conquer ${D.TERR[b].name}${def ? ' from the ' + def.fname : ''}.`, att.idx);
      if (countTerr(defIdx) === 0) {
        def.alive = false; res.eliminated = true;
        const got = def.cards.length;
        att.cards.push(...def.cards); def.cards = [];
        log(`The ${def.fname} have been wiped out by the ${att.fname}!${got ? ` Their ${got} cards are taken.` : ''}`, att.idx);
        // destroy mission fallback for others
        S.players.forEach(p => { if (p.mission && p.mission.type === 'destroy' && p.mission.target === defIdx && p.idx !== S.current) p.mission = { type: 'terr', n: TERR_MISSION, was: 'destroy' }; });
        emit('eliminated', { p: defIdx, by: S.current });
      }
    }
    S.lastAttack = res; S.atkSeq = (S.atkSeq || 0) + 1;
    emit('battle', res);
    checkVictory();
    emit('change');
    return res;
  }
  function moveAfterConquest(n) {
    const pd = S.pending; if (!pd) return false;
    n = Math.max(pd.min, Math.min(pd.max, n));
    S.armies[pd.from] -= n; S.armies[pd.to] += n;
    S.pending = null;
    emit('move', { from: pd.from, to: pd.to, n, conquest: true });
    // card-overflow after eliminating a player
    const p = S.players[S.current];
    if (!S.winner && p.cards.length >= 6) {
      S.phase = 'reinforce'; S.reinforcements = 0; S.returnToAttack = true; S.reinfDetail = null; S.placed = {};
      log(`${p.fname} hold ${p.cards.length} cards and must trade in at once.`, p.idx);
      emit('forcedTrade');
    }
    emit('change');
    return true;
  }
  function endAttack() {
    if (S.phase !== 'attack' || S.pending) return false;
    S.phase = 'fortify'; emit('phase', { phase: 'fortify' }); emit('change'); return true;
  }

  /* ---------- fortify ---------- */
  function fortifyTargets(a) {
    const p = S.current; if (S.owner[a] !== p) return [];
    if (S.cfg.fortify !== 'connected') return D.TERR[a].adj.filter(b => S.owner[b] === p);
    const seen = new Set([a]), q = [a];
    while (q.length) { const x = q.shift(); for (const y of D.TERR[x].adj) if (!seen.has(y) && S.owner[y] === p) { seen.add(y); q.push(y); } }
    seen.delete(a); return [...seen];
  }
  function fortify(a, b, n) {
    if (S.phase !== 'fortify' || S.fortified) return false;
    if (S.owner[a] !== S.current || S.armies[a] < 2 || !fortifyTargets(a).includes(b)) return false;
    n = Math.max(1, Math.min(n, S.armies[a] - 1));
    S.armies[a] -= n; S.armies[b] += n; S.fortified = true;
    log(`${S.players[S.current].fname} move ${n} ${n > 1 ? 'armies' : 'army'} from ${D.TERR[a].name} to ${D.TERR[b].name}.`, S.current);
    emit('move', { from: a, to: b, n, conquest: false });
    emit('change');
    return true;
  }

  function endTurn() {
    if (S.winner) return null;
    if (S.phase === 'reinforce' || S.pending) return null;
    const p = S.players[S.current];
    let card = null;
    if (S.conquered) { card = drawCard(S.current); log(`${p.fname} earn a territory card.`, p.idx); }
    p.stats.maxTerr = Math.max(p.stats.maxTerr, countTerr(S.current));
    emit('turnEnd', { p: S.current, card });
    // next player
    const n = S.players.length; let nx = S.current;
    for (let k = 1; k <= n; k++) { const c = (S.current + k) % n; if (S.players[c].alive && !S.players[c].neutral) { nx = c; break; } }
    let firstAlive = nx;
    for (let k = 0; k < n; k++) { const c = (S.first + k) % n; if (S.players[c].alive && !S.players[c].neutral) { firstAlive = c; break; } }
    if (nx === firstAlive) S.round++;
    S.current = nx;
    if (S.cfg.mode === 'quick' && S.round > (S.cfg.quickRounds || 12)) { quickTimeUp(); return card; }
    checkVictory();
    if (!S.winner) startTurn();
    return card;
  }

  /* ---------- victory ---------- */
  function missionDone(p) {
    const m = p.mission; if (!m) return false;
    if (m.type === 'terr') return countTerr(p.idx) >= m.n;
    if (m.type === 'terr2') { let k = 0; for (let i = 0; i < NT; i++) if (S.owner[i] === p.idx && S.armies[i] >= 2) k++; return k >= m.n; }
    if (m.type === 'regions') {
      if (!m.regions.every(r => regionOwner(r) === p.idx)) return false;
      if (!m.extra) return true;
      return D.REGIONS.some(r => !m.regions.includes(r.id) && regionOwner(r.id) === p.idx);
    }
    if (m.type === 'destroy') return !S.players[m.target].alive;
    return false;
  }
  function checkVictory() {
    if (S.winner) return S.winner;
    const alive = S.players.filter(p => p.alive && !p.neutral);
    let w = null, reason = '';
    if (alive.length === 1) { w = alive[0]; reason = 'domination'; }
    else if (S.cfg.mode === 'missions') {
      const cur = S.players[S.current];
      if (cur.alive && missionDone(cur)) { w = cur; reason = 'mission'; }
    } else if (S.cfg.mode === 'quick') {
      const target = S.cfg.quickTarget || D.QUICK_TARGET || 26;
      const cur = S.players[S.current];
      if (countTerr(cur.idx) >= target) { w = cur; reason = 'quick'; }
    } else {
      // classic: all territories (neutral may remain) — domination of all non-neutral players handled above
    }
    if (w) {
      S.winner = { p: w.idx, reason }; S.phase = 'over';
      log(`The ${w.fname} win the war!`, w.idx);
      emit('victory', S.winner);
    }
    return S.winner;
  }
  function quickTimeUp() {
    const alive = S.players.filter(p => p.alive && !p.neutral);
    alive.sort((a, b) => (countTerr(b.idx) - countTerr(a.idx)) || (countArmies(b.idx) - countArmies(a.idx)));
    const w = alive[0];
    S.winner = { p: w.idx, reason: 'time' }; S.phase = 'over';
    log(`Time is up. The ${w.fname} hold the most territories and win.`, w.idx);
    emit('victory', S.winner); emit('change');
  }

  function log(text, p) { S.log.push({ text, p: p == null ? -1 : p, turn: S.turn, round: S.round }); if (S.log.length > 400) S.log.shift(); emit('log', S.log[S.log.length - 1]); }

  /* ---------- save / load ---------- */
  function serialize() { return JSON.stringify(S); }
  function restore(json) {
    const next = JSON.parse(json);
    if (!next || (next.mapId || null) !== (D.MAP_ID || null) ||
        !Array.isArray(next.owner) || next.owner.length !== NT ||
        !Array.isArray(next.armies) || next.armies.length !== NT) {
      throw new Error('This saved game belongs to a different map.');
    }
    S = next; emit('change'); return S;
  }

  G.GAME = {
    on, emit, newGame, claim, setupPlace, setupAutoRest, place, unplace, trade, bestSet, isSet, setValue, nextTradeValue, mustTrade,
    endReinforce, canAttack, attack, moveAfterConquest, endAttack, fortifyTargets, fortify, endTurn,
    calcReinforcements, countTerr, countArmies, regionOwner, REGION_T, missionText, missionDone, serialize, restore,
    get S() { return S; }, log,
  };
})(window);
