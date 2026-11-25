/* AI opponents: exact battle odds + region-driven planning */
(function (G) {
  const D = G.DATA; const NT = D.TERR.length;
  const C = G.CAMPAIGN;
  const GM = () => G.GAME;

  /* ---------- exact dice odds ---------- */
  const OUT = [{}, {}];
  function enumerate(a, d, defence) {
    const res = {}; const n = a + d; const total = Math.pow(6, n);
    const v = new Array(n).fill(1);
    for (let k = 0; k < total; k++) {
      let x = k; for (let i = 0; i < n; i++) { v[i] = 1 + (x % 6); x = Math.floor(x / 6); }
      const A = v.slice(0, a).sort((p, q) => q - p), Dd = v.slice(a).sort((p, q) => q - p);
      let al = 0, dl = 0;
      for (let i = 0; i < Math.min(a, d); i++) {
        if (A[i] > Dd[i] + (i === 0 ? defence : 0)) dl++; else al++;
      }
      const key = al + ',' + dl; res[key] = (res[key] || 0) + 1 / total;
    }
    return Object.entries(res).map(([k, p]) => { const [al, dl] = k.split(',').map(Number); return [al, dl, p]; });
  }
  OUT.forEach((table, defence) => {
    for (let a = 1; a <= 3; a++) for (let d = 1; d <= 2; d++) table[a * 10 + d] = enumerate(a, d, defence);
  });
  const MAXA = 120;
  const memo = OUT.map(() => new Float64Array((MAXA + 1) * (MAXA + 1)).fill(-1));
  function winP(a, d, defence = 0) {
    a = Math.min(a, MAXA); d = Math.min(d, MAXA);
    if (d <= 0) return 1; if (a <= 0) return 0;
    const cached = memo[defence], k = a * (MAXA + 1) + d;
    if (cached[k] >= 0) return cached[k];
    const outcomes = OUT[defence][Math.min(3, a) * 10 + Math.min(2, d)];
    let p = 0;
    for (const [al, dl, pr] of outcomes) p += pr * winP(a - al, d - dl, defence);
    cached[k] = p; return p;
  }

  const PARAM = {
    easy: { attackP: 0.74, stopP: 0.45, conc: 0.35, rnd: 0.45, defend: 0.2, maxAttacks: 6 },
    normal: { attackP: 0.6, stopP: 0.32, conc: 0.7, rnd: 0.12, defend: 0.45, maxAttacks: 40 },
    hard: { attackP: 0.52, stopP: 0.25, conc: 0.85, rnd: 0.03, defend: 0.55, maxAttacks: 80 },
  };

  function S() { return GM().S; }
  function mine(pi) { const s = S(); const r = []; for (let i = 0; i < NT; i++) if (s.owner[i] === pi) r.push(i); return r; }
  function enemyAdj(t, pi) { return D.TERR[t].adj.filter(a => GM().enemyTerritory(a, pi)); }
  function threat(t, pi) { const s = S(); return enemyAdj(t, pi).reduce((m, a) => m + Math.max(0, s.armies[a] - 1), 0); }

  function regionScores(pi) {
    const s = S();
    return D.REGIONS.map(r => {
      const ts = GM().REGION_T[r.id];
      const own = ts.filter(t => s.owner[t] === pi).length;
      const enemyArm = ts.filter(t => s.owner[t] !== pi).reduce((m, t) => m + s.armies[t], 0);
      let myNear = 0; const seen = new Set();
      ts.forEach(t => { if (s.owner[t] === pi) { myNear += s.armies[t]; seen.add(t); } D.TERR[t].adj.forEach(a => { if (!seen.has(a) && s.owner[a] === pi) { myNear += s.armies[a]; seen.add(a); } }); });
      const frac = own / ts.length;
      const full = own === ts.length;
      const score = full ? -1 : (r.bonus / ts.length) * (0.4 + frac * 1.6) * (myNear + 1) / (myNear + enemyArm + 2) + (own > 0 ? 0.15 : 0);
      return { r: r.id, score, frac, full, enemyArm };
    });
  }
  function goalRegion(pi) {
    const sc = regionScores(pi).filter(x => !x.full && x.score > 0).sort((a, b) => b.score - a.score);
    return sc.length ? sc[0].r : -1;
  }

  /* ---------- reinforcement plan ---------- */
  function planReinforce(pi, n) {
    const s = S(); const P = PARAM[s.players[pi].diff] || PARAM.normal;
    const my = mine(pi);
    // During claims an unoccupied frontier is still a useful staging point.
    const border = my.filter(t => enemyAdj(t, pi).length || D.TERR[t].adj.some(a => s.owner[a] < 0));
    if (!border.length) return my.length ? [[my[0], n]] : [];
    const plan = new Map(); const add = (t, k) => { if (k > 0) plan.set(t, (plan.get(t) || 0) + k); };
    let left = n;
    if (s.campaign?.teams?.[pi] === 0) {
      const t = C.next(s.campaign);
      if (s.owner[t] === pi && s.armies[t] === 1 && left > 0) { add(t, 1); left--; }
    }
    if (Math.random() < P.rnd) {
      while (left-- > 0) add(border[Math.floor(Math.random() * border.length)], 1);
      return [...plan];
    }
    // defend held regions
    const held = D.REGIONS.filter(r => GM().regionOwner(r.id) === pi).map(r => r.id);
    if (held.length || s.bastions) {
      const guards = border.filter(t => held.includes(D.TERR[t].region) || GM().isBastion(t)).map(t => ({ t, def: threat(t, pi) * 1.1 - s.armies[t] })).filter(x => x.def > 0).sort((a, b) => b.def - a.def);
      let budget = Math.min(left, Math.ceil(n * P.defend));
      for (const g of guards) { if (budget <= 0) break; const k = Math.min(budget, Math.ceil(g.def)); add(g.t, k); budget -= k; left -= k; }
    }
    // staging point toward goal region
    const goal = goalRegion(pi);
    let stage = -1, best = -1e9;
    for (const t of border) {
      const targets = enemyAdj(t, pi);
      let v = 0;
      for (const e of targets) {
        const inGoal = D.TERR[e].region === goal ? 2.2 : 0;
        const ratio = (s.armies[t] + n) / (s.armies[e] + 1);
        v = Math.max(v, inGoal + Math.min(ratio, 4) * 0.5 - s.armies[e] * 0.05 + C.priority(s, pi, e) * 0.6);
      }
      if (D.TERR[t].region === goal) v += 1;
      v += C.priority(s, pi, t) * 0.35;
      v += s.armies[t] * 0.02;
      if (v > best) { best = v; stage = t; }
    }
    const conc = Math.round(left * P.conc);
    add(stage, conc); left -= conc;
    // rest to most threatened borders
    const byThreat = border.map(t => ({ t, d: threat(t, pi) - s.armies[t] })).sort((a, b) => b.d - a.d);
    let i = 0;
    while (left > 0) { add(byThreat[i % Math.min(3, byThreat.length)].t, 1); left--; i++; }
    return [...plan];
  }

  /* ---------- setup ---------- */
  function chooseClaim(pi) {
    const s = S(); let best = -1, bs = -1e9;
    for (let t = 0; t < NT; t++) {
      if (s.owner[t] >= 0) continue;
      const r = D.TERR[t].region, ts = GM().REGION_T[r];
      const mineIn = ts.filter(x => s.owner[x] === pi).length, enemyIn = ts.filter(x => s.owner[x] >= 0 && s.owner[x] !== pi).length;
      const adjMine = D.TERR[t].adj.filter(a => s.owner[a] === pi).length;
      const sc = (mineIn + 1) / ts.length * 3 - enemyIn * 0.45 + adjMine * 0.6 + D.REGIONS[r].bonus / ts.length + (GM().isBastion(t) ? 2 : 0) + C.priority(s, pi, t) * 0.5 + Math.random() * 0.6;
      if (sc > bs) { bs = sc; best = t; }
    }
    return best;
  }
  function chooseSetupPlace(pi) { const p = planReinforce(pi, 1); return p.length ? p[0][0] : mine(pi)[0]; }

  /* ---------- attack evaluation ---------- */
  function attackOptions(pi) {
    const s = S(); const P = PARAM[s.players[pi].diff] || PARAM.normal;
    const goal = goalRegion(pi); const opts = [];
    for (const t of mine(pi)) {
      if (s.armies[t] < 2) continue;
      for (const e of enemyAdj(t, pi)) {
        const a = s.armies[t] - 1, d = s.armies[e];
        const defence = GM().defenceBonus(e);
        const p = winP(a, d, defence);
        const reg = D.TERR[e].region, ts = GM().REGION_T[reg];
        const defOwner = s.owner[e];
        let value = 1 + defence * 3 + C.priority(s, pi, e);
        const missing = ts.filter(x => s.owner[x] !== pi).length;
        if (missing === 1) value += D.REGIONS[reg].bonus * 2.5;
        if (GM().regionOwner(reg) === defOwner && defOwner >= 0) value += D.REGIONS[reg].bonus * 1.6;
        if (!s.conquered) value += 3;
        if (reg === goal) value += 1.5;
        const defP = s.players[defOwner];
        const defTerr = GM().countTerr(defOwner);
        if (defP && !defP.neutral && defTerr <= 2) value += 4 + defP.cards.length * 1.5;
        if (defP && defP.neutral) value -= 0.4;
        if (s.players[pi].mission) {
          const m = s.players[pi].mission;
          if (m.type === 'destroy' && m.target === defOwner) value += 3;
          if (m.type === 'regions' && m.regions.includes(reg)) value += 2.5;
          if (m.type === 'terr' || m.type === 'terr2') value += 0.6;
        }
        if (s.cfg.mode === 'quick') value += 0.8;
        const sc = p * value - (1 - p) * (1.2 + a * 0.05);
        const thr = !s.conquered ? Math.min(P.attackP, 0.55) : P.attackP;
        if (p >= thr || (p >= 0.42 && value > 7)) opts.push({ t, e, p, value, sc });
      }
    }
    return opts.sort((x, y) => y.sc - x.sc);
  }

  function chooseMove(pi, from, to, min, max) {
    const s = S();
    const tFront = threat(from, pi), eFront = threat(to, pi);
    if (eFront === 0 && tFront === 0) return min;
    if (eFront === 0) return min;
    if (tFront === 0) return max;
    const share = eFront / (tFront + eFront);
    return Math.max(min, Math.min(max, Math.round(max * Math.max(0.5, share))));
  }

  function planFortify(pi) {
    const s = S(); const my = mine(pi);
    // distance to front for each own territory
    const distF = new Map(); const q = [];
    for (const t of my) if (enemyAdj(t, pi).length) { distF.set(t, 0); q.push(t); }
    while (q.length) { const x = q.shift(); for (const y of D.TERR[x].adj) if (s.owner[y] === pi && !distF.has(y)) { distF.set(y, distF.get(x) + 1); q.push(y); } }
    let best = null, bs = 0;
    for (const t of my) {
      if (s.armies[t] < 2) continue;
      const interior = !enemyAdj(t, pi).length;
      const targets = GM().fortifyTargets(t);
      for (const b of targets) {
        let gain;
        if (interior) {
          const db = distF.get(b) ?? 99, dt = distF.get(t) ?? 99;
          if (db >= dt) continue;
          gain = (s.armies[t] - 1) * (1 + (db === 0 ? threat(b, pi) * 0.05 : 0)) * (db === 0 ? 1.5 : 1);
        } else {
          // rebalance between two front territories
          const need = threat(b, pi) - s.armies[b], spare = s.armies[t] - 1 - Math.max(0, threat(t, pi) - s.armies[t] + 1);
          if (need <= 0 || spare <= 1) continue;
          gain = Math.min(need, spare) * 0.6;
        }
        if (gain > bs) { bs = gain; best = { a: t, b, n: interior ? s.armies[t] - 1 : Math.max(1, Math.floor(Math.min(threat(b, pi) - s.armies[b], s.armies[t] - 1) * 0.6)) }; }
      }
    }
    return best;
  }

  /* ---------- full turn ---------- */
  async function tradeAll(pi, io, forcedOnly) {
    const s = S(); const p = s.players[pi];
    let guard = 0;
    while (guard++ < 6) {
      const must = GM().mustTrade();
      if (!must && (forcedOnly || p.cards.length < 3)) break;
      const set = GM().bestSet(p.cards, pi); if (!set) break;
      const r = GM().trade(set); if (!r) break;
      await io.trade(pi, r);
    }
  }
  async function placeAll(pi, io) {
    const s = S();
    const plan = planReinforce(pi, s.reinforcements);
    for (const [t, n] of plan) { if (s.reinforcements <= 0) break; const k = GM().place(t, n); if (k) await io.place(t, k); }
    // any leftover
    if (s.reinforcements > 0) { const my = mine(pi); GM().place(my[0], s.reinforcements); }
  }

  async function occupy(pi, io) {
    const pd = S().pending;
    const n = chooseMove(pi, pd.from, pd.to, pd.min, pd.max);
    GM().moveAfterConquest(n);
    await io.move(pd.from, pd.to, n);
  }

  function campaignActions(pi) {
    const s = S(), c = s.campaign;
    if (!c || s.returnToAttack || s.winner) return;
    const commander = c.commanders[pi];
    function value(t) {
      return C.priority(s, pi, t) * 2 + Math.min(8, threat(t, pi) - s.armies[t] / 2);
    }
    const move = D.TERR[commander]?.adj.filter(t => GM().canMoveCommander(t)).sort((a, b) => value(b) - value(a))[0];
    if (move != null && C.priority(s, pi, move) > C.priority(s, pi, commander)) GM().moveCommander(move);
    const choices = c.hands[pi].flatMap((id, i) => GM().adventureTargets(i).map(t => {
      const score = id === 'dispatch' ? (C.priority(s, pi, t) - C.priority(s, pi, commander)) * 3 : value(t) + (id === 'crossing' ? 6 : 3);
      return { i, t, score };
    })).sort((a, b) => b.score - a.score);
    const best = choices[0];
    if (best && best.score >= 0) GM().playAdventure(best.i, best.t);
    else if (s.phase === 'fortify' && c.hands[pi].length >= C.HAND_LIMIT) {
      const stale = c.hands[pi].findIndex(id => C.CARDS[id].type === 'Mission');
      if (stale >= 0) GM().discardAdventure(stale);
    }
  }

  function playRingAction(s) {
    // The Ring moves once a round. A computer Warden leaves that decision to a human ally,
    // who would otherwise never get to give the order when the computer plays first.
    const teams = s.campaign.teams, me = s.current;
    if (teams[me] === 0 && s.players.some(p => !p.isAI && p.alive && teams[p.idx] === 0)) return false;
    const actions = C.ringActions(s);
    const finish = actions.find(a => a.kind === 'destroy' || a.kind === 'hunt');
    if (finish) return GM().ringAction(finish.kind, finish.t);
    const rest = actions.find(a => a.kind === 'rest');
    if (rest && s.campaign.pressure >= 2) return GM().ringAction(rest.kind, rest.t);
    const routes = actions.filter(a => a.kind === 'travel' && a.cost + s.campaign.pressure < C.CORRUPTION);
    function risk(a) {
      const owner = s.owner[a.t];
      const hunted = s.campaign.teams[owner] === 1 && s.campaign.commanders[owner] === a.t;
      return 4 * a.cost + (hunted ? 4 : 0) + C.ringDistance(a.t);
    }
    routes.sort((a, b) => risk(a) - risk(b));
    const travel = routes[0];
    if (travel) return GM().ringAction(travel.kind, travel.t);
    return false;
  }

  async function takeTurn(pi, io) {
    const s = S();
    if (s.pending) await occupy(pi, io);
    if (s.phase === 'reinforce') {
      await tradeAll(pi, io, false);
      campaignActions(pi);
      await placeAll(pi, io);
      GM().endReinforce();
    }
    const P = PARAM[s.players[pi].diff] || PARAM.normal;
    let attacks = 0;
    while (s.phase === 'attack' && !s.winner && attacks < P.maxAttacks) {
      if (io.aborted()) return;
      const opts = attackOptions(pi);
      if (!opts.length) break;
      // a little variety for weaker AIs
      const pick = (P.rnd > 0.1 && opts.length > 1 && Math.random() < P.rnd) ? opts[1] : opts[0];
      attacks++;
      await io.beginAttack(pick.t, pick.e);
      let committedP = pick.p;
      while (s.owner[pick.e] !== pi && s.armies[pick.t] >= 2 && !s.winner) {
        if (io.aborted()) return;
        const p = winP(s.armies[pick.t] - 1, s.armies[pick.e], GM().defenceBonus(pick.e));
        if (p < P.stopP && p < committedP * 0.6) break;
        const res = GM().attack(pick.t, pick.e, 3);
        if (!res) break;
        await io.battle(res);
      }
      await io.endAttack(pick.t, pick.e);
      if (s.pending) {
        await occupy(pi, io);
        if (s.phase === 'reinforce' && s.returnToAttack) {
          await tradeAll(pi, io, true);
          await placeAll(pi, io);
          GM().endReinforce();
        }
      }
    }
    if (s.winner) return;
    if (s.phase === 'attack') GM().endAttack();
    if (s.phase === 'fortify') {
      campaignActions(pi);
      const f = planFortify(pi);
      if (f && GM().fortify(f.a, f.b, f.n)) await io.move(f.a, f.b, f.n);
      if (s.campaign?.ring) playRingAction(s);
      else if (s.campaign) GM().marchConvoy();
    }
    if (!s.winner) GM().endTurn();
  }

  G.AI = { winP, takeTurn, chooseClaim, chooseSetupPlace, planReinforce, OUT: OUT[0] };
})(window);
