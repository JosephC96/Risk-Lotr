/* Campaign rules for the hand-drawn board. */
(function (G) {
  const T = G.DATA.TERR;
  const ROUTE = [5, 6, 7, 35, 47, 59, 60, 61, 58];
  const SIDES = ['Escort', 'Raiders'];
  const RING_SIDES = ['Wardens', 'Hunters'];
  const RING_PATHS = [
    [16, 8, 7, 6, 10, 20, 21, 22, 23, 39, 24, 26, 52, 54],
    [16, 8, 7, 35, 37, 41, 49, 50, 55, 56, 54],
  ];
  const RING_START = RING_PATHS[0][0], RING_DESTINATION = RING_PATHS[0].at(-1);
  const RING_WAYPOINTS = [...new Set(RING_PATHS.flat())];
  const RING_EDGES = RING_PATHS.flatMap(path => path.slice(1).map((t, i) => [path[i], t]))
    .filter(([a, b], i, edges) => edges.findIndex(([p, q]) => p === a && q === b) === i);
  const SANCTUARIES = new Set([6, 22, 23, 37, 49, 50]);
  const PERILS = new Set([21, 26, 52, 55, 56]);
  const RING_LIMIT = 24, CORRUPTION = 6;
  const LIMIT = 14, PRESSURE = 3, HAND_LIMIT = 4;
  const CARDS = {
    levy: { name: 'Muster at Dusk', type: 'Tactic', biome: 'meadow', text: 'Place two armies in one territory you control.' },
    supply: { name: 'Supply Wagons', type: 'Tactic', biome: 'port', text: 'Place three armies on a waypoint you control.' },
    dispatch: { name: 'Swift Dispatch', type: 'Tactic', biome: 'desert', text: 'Send your commander to any waypoint you control. This uses your command move.' },
    watch: { name: 'Light the Signal', type: 'Mission', biome: 'fortress', text: 'Station your commander on a waypoint with at least two armies. Add two armies there.' },
    crossing: { name: 'Two Shores', type: 'Mission', biome: 'valley', text: 'Hold two consecutive waypoints and station your commander at one. Add two armies to each.' },
    relief: { name: 'Relieve the Frontier', type: 'Mission', biome: 'blackgate', text: 'Station your commander on a waypoint bordering an enemy. Add three armies there.' },
    stores: { name: 'Forgotten Stores', type: 'Event', biome: 'forest', text: 'When drawn, add two armies where your commander is stationed.' },
    signal: { name: 'Signals at First Light', type: 'Event', biome: 'snow', text: 'When drawn, add one army to each of your first three held waypoints along the route.' },
    harbor: { name: 'Sanctuary Gate', type: 'Event', biome: 'whitecity', text: 'When drawn, add two armies to your weakest territory.' },
  };
  const cardIds = Object.keys(CARDS);
  function create(players, format, shuffle) {
    const deck = shuffle([...cardIds, ...cardIds]);
    const hands = players.map(() => []);
    for (const p of players) {
      if (p.neutral) continue;
      const starter = deck.findIndex(id => CARDS[id].type === 'Tactic');
      if (starter >= 0) hands[p.idx].push(deck.splice(starter, 1)[0]);
    }
    return {
      format, step: 0, pressure: 0, marchedRound: 0,
      teams: format === 'race' ? null : players.map(p => p.idx % 2),
      ...(format === 'ring' ? { ring: { trail: [RING_START], sheltered: [], huntedRound: 0, destroyed: false } } : {}),
      points: players.map(() => 0), commanders: players.map(() => -1),
      moved: false, played: false, earned: false, hands, deck, discard: [],
    };
  }
  function validSize(format, count) { return format === 'race' ? count >= 2 && count <= 5 : count === 2 || count === 4; }
  function normalizeFormat(format) { return ['escort', 'race', 'ring'].includes(format) ? format : 'race'; }
  function teamNames(format) { return format === 'ring' ? RING_SIDES : SIDES; }
  function current(c) { return c.ring ? c.ring.trail.at(-1) : ROUTE[c.step]; }
  function next(c) { return c.ring ? onward(c)[0] : ROUTE[c.step + 1]; }
  function onward(c) {
    if (!c.ring) return ROUTE[c.step + 1] == null ? [] : [ROUTE[c.step + 1]];
    return RING_EDGES.filter(([a]) => a === current(c)).map(([, b]) => b);
  }
  function side(S, p) { return S.campaign.teams?.[p]; }
  function waypoints(c) { return c?.ring ? RING_WAYPOINTS : ROUTE; }
  function isWaypoint(t, c) { return waypoints(c).includes(t); }

  // Two starting waypoints per side give each formation a starting front.
  function reserveAnchors(S) {
    if (!S.campaign.teams) return;
    const places = S.campaign.ring ? [RING_START, RING_DESTINATION, RING_PATHS[0][1], RING_PATHS[0].at(-2)]
      : [ROUTE[0], ROUTE.at(-1), ROUTE[1], ROUTE.at(-2)];
    places.forEach((t, i) => {
      const p = i % S.players.length;
      S.owner[t] = p;
      S.armies[t] = 1;
      S.setupPool[p]--;
    });
  }
  function priority(S, p, t) {
    const c = S.campaign;
    if (!c) return 0;
    if (onward(c).includes(t)) return 6;
    if (t === current(c)) return c.teams ? (side(S, p) === 1 ? 7 : 5) : 2;
    if (c.ring ? RING_EDGES.some(([a, b]) => onward(c).includes(a) && b === t) : t === ROUTE[c.step + 2]) return 3;
    return isWaypoint(t, c) ? 1 : 0;
  }
  function postCommander(S, p) {
    const owned = T.filter(t => S.owner[t.id] === p);
    owned.sort((a, b) => priority(S, p, b.id) - priority(S, p, a.id) || S.armies[b.id] - S.armies[a.id]);
    return owned[0]?.id ?? -1;
  }
  function startTurn(S, log) {
    const c = S.campaign;
    if (!c) return;
    c.moved = false;
    c.played = false;
    c.earned = false;
    const p = S.current;
    if (S.owner[c.commanders[p]] !== p) c.commanders[p] = postCommander(S, p);
    const t = c.commanders[p];
    if (isWaypoint(t, c)) {
      S.armies[t]++;
      log(`The commander at ${T[t].name} rallies one army.`, p);
    }
  }
  function canMoveCommand(S, t) {
    const c = S.campaign, p = S.current;
    if (!c || c.moved || S.pending || S.returnToAttack || !['reinforce', 'fortify'].includes(S.phase)) return false;
    const from = c.commanders[p];
    return S.owner[t] === p && T[from]?.adj.includes(t);
  }
  function moveCommand(S, t, log) {
    if (!canMoveCommand(S, t)) return false;
    S.campaign.commanders[S.current] = t;
    S.campaign.moved = true;
    log(`The commander redeploys to ${T[t].name}.`, S.current);
    return true;
  }
  function recordConquest(S, a, b, defender, log) {
    const c = S.campaign;
    if (!c) return;
    if (isWaypoint(b, c) || a === c.commanders[S.current]) c.earned = true;
    if (b === c.commanders[defender]) {
      c.commanders[defender] = -1;
      log(`The commander is driven from ${T[b].name}.`, defender);
    }
    if (!S.players[defender].alive) c.discard.push(...c.hands[defender].splice(0));
  }
  function weakest(S, p) {
    return S.owner.reduce((best, owner, t) => owner === p && (best < 0 || S.armies[t] < S.armies[best]) ? t : best, -1);
  }
  function applyEvent(S, id, p, log) {
    const commander = S.campaign.commanders[p];
    const lands = id === 'signal' ? waypoints(S.campaign).filter(t => S.owner[t] === p).slice(0, 3) : [id === 'stores' ? commander : weakest(S, p)];
    const bonus = id === 'signal' ? 1 : 2;
    const valid = lands.filter(t => S.owner[t] === p);
    valid.forEach(t => { S.armies[t] += bonus; });
    log(`${CARDS[id].name}${valid.length ? ': supplies reach ' + valid.map(t => T[t].name).join(', ') : ': no eligible territory'}.`, p);
  }
  function draw(S, shuffle, log) {
    const c = S.campaign;
    if (!c?.earned) return;
    c.earned = false;
    if (!c.deck.length) c.deck = shuffle(c.discard.splice(0));
    const id = c.deck.pop(), p = S.current;
    if (!id) return;
    if (CARDS[id].type === 'Event') {
      applyEvent(S, id, p, log);
      c.discard.push(id);
      return;
    }
    if (c.hands[p].length >= HAND_LIMIT) {
      c.discard.push(id);
      log(`The adventure hand is full. ${CARDS[id].name} is discarded.`, p);
      return;
    }
    c.hands[p].push(id);
    log(`${S.players[p].fname} draw an adventure card.`, p);
  }

  function cardTargets(S, index, enemyTerritory) {
    const c = S.campaign, p = S.current;
    const id = c?.hands[p]?.[index];
    if (!id || c.played || S.pending || S.returnToAttack || !['reinforce', 'fortify'].includes(S.phase)) return [];
    const commander = c.commanders[p], route = waypoints(c), step = route.indexOf(commander);
    if (id === 'levy') return T.filter(t => S.owner[t.id] === p).map(t => t.id);
    if (id === 'supply') return route.filter(t => S.owner[t] === p);
    if (id === 'dispatch') return c.moved ? [] : route.filter(t => S.owner[t] === p && t !== commander);
    if (step < 0 || S.owner[commander] !== p) return [];
    if (id === 'watch') return S.armies[commander] >= 2 ? [commander] : [];
    if (id === 'relief') return T[commander].adj.some(t => enemyTerritory(t, p)) ? [commander] : [];
    const connected = c.ring ? RING_EDGES.flatMap(([a, b]) => a === commander ? [b] : b === commander ? [a] : [])
      : [ROUTE[step - 1], ROUTE[step + 1]];
    return connected.filter(t => S.owner[t] === p);
  }
  function playCard(S, index, t, enemyTerritory, log) {
    if (!cardTargets(S, index, enemyTerritory).includes(t)) return false;
    const c = S.campaign, p = S.current;
    const [id] = c.hands[p].splice(index, 1);
    c.discard.push(id);
    c.played = true;
    if (id === 'dispatch') {
      c.commanders[p] = t;
      c.moved = true;
    } else {
      S.armies[t] += id === 'supply' || id === 'relief' ? 3 : 2;
      if (id === 'crossing') S.armies[c.commanders[p]] += 2;
    }
    log(`${S.players[p].fname} play ${CARDS[id].name} at ${T[t].name}.`, p);
    return true;
  }
  function discardCard(S, index, log) {
    const c = S.campaign, p = S.current;
    if (!c?.hands[p]?.[index] || S.pending || !['reinforce', 'fortify'].includes(S.phase)) return false;
    const [id] = c.hands[p].splice(index, 1);
    c.discard.push(id);
    log(`${S.players[p].fname} discard an adventure card.`, p);
    return true;
  }

  function roadOpen(S) {
    const c = S.campaign, onward = next(c);
    return onward != null && side(S, S.owner[current(c)]) === 0 &&
      side(S, S.owner[onward]) === 0 && S.armies[onward] >= 2;
  }
  function march(S, log) {
    const c = S.campaign;
    c.step++;
    c.marchedRound = S.round;
    c.pressure = Math.max(0, c.pressure - 1);
    log(`The convoy reaches ${T[current(c)].name}.`);
    return next(c) == null;
  }
  function canMarch(S) {
    const c = S.campaign;
    return !!(c?.teams && !c.ring && c.teams[S.current] === 0 && S.phase === 'fortify' &&
      !S.pending && c.marchedRound !== S.round && roadOpen(S));
  }
  function tick(S, log) {
    const c = S.campaign, at = current(c), onward = next(c);
    if (c.ring) return S.round >= RING_LIMIT ? { side: 1, reason: 'ringOutlasted' } : null;
    if (c.teams) {
      if (c.marchedRound !== S.round && roadOpen(S)) {
        if (march(S, log)) return { side: 0, reason: 'convoyDelivered' };
      } else if (side(S, S.owner[at]) === 1 && c.commanders[S.owner[at]] === at) {
        c.pressure++;
        log(`Raiders surround the convoy at ${T[at].name}. Pressure ${c.pressure}/${PRESSURE}.`);
        if (c.pressure >= PRESSURE) return { side: 1, reason: 'convoySeized' };
      } else if (c.marchedRound !== S.round) log(`The convoy waits for a safe road to ${T[onward].name}.`);
      if (S.round >= LIMIT) return { side: 1, reason: 'convoyDelayed' };
      return null;
    }
    c.step++;
    const p = S.owner[onward];
    if (S.players[p]?.alive && !S.players[p].neutral) {
      const points = c.commanders[p] === onward ? 2 : 1;
      c.points[p] += points;
      log(`The convoy reaches ${T[onward].name}. ${S.players[p].fname} earn ${points} influence.`, p);
    } else log(`The convoy reaches ${T[onward].name}.`);
    return next(c) == null ? { reason: 'convoyInfluence' } : null;
  }

  function ringActions(S) {
    const c = S?.campaign;
    if (!c?.ring || S.phase !== 'fortify' || S.pending || S.winner) return [];
    const p = S.current, at = current(c), ownSide = side(S, S.owner[at]);
    if (side(S, p) === 1) {
      return c.ring.huntedRound !== S.round && S.owner[at] === p && c.commanders[p] === at
        ? [{ kind: 'hunt', t: at, cost: 2 }] : [];
    }
    if (c.marchedRound === S.round) return [];
    if (at === RING_DESTINATION) {
      return ownSide === 0 || c.pressure <= CORRUPTION / 2 ? [{ kind: 'destroy', t: at, cost: 0 }] : [];
    }
    const actions = onward(c).map(t => {
      const p = S.owner[t], friendly = side(S, p) === 0;
      const guarded = friendly && c.commanders[p] === t;
      return { kind: 'travel', t, cost: Number(!friendly) + Number(PERILS.has(t) && !guarded) };
    });
    if (ownSide === 0 && SANCTUARIES.has(at) && c.pressure > 0 && !c.ring.sheltered.includes(at)) {
      actions.push({ kind: 'rest', t: at, cost: -Math.min(2, c.pressure) });
    }
    return actions;
  }

  function actOnRing(S, kind, t, log) {
    const action = ringActions(S).find(a => a.kind === kind && a.t === t);
    if (!action) return null;
    const c = S.campaign;
    if (kind === 'hunt') c.ring.huntedRound = S.round;
    else c.marchedRound = S.round;
    c.pressure = Math.min(CORRUPTION, c.pressure + action.cost);
    if (kind === 'destroy') {
      c.ring.destroyed = true;
      log('The Ring is cast into the fire of Mount Doom.', S.current);
      return { victory: { side: 0, reason: 'ringDestroyed' } };
    }
    if (kind === 'travel') {
      c.ring.trail.push(t);
      c.step++;
      log(`The Ring-bearer reaches ${T[t].name}.`, S.current);
    } else if (kind === 'rest') {
      c.ring.sheltered.push(t);
      log(`The Ring-bearer rests at ${T[t].name}.`, S.current);
    } else log(`A Hunter commander closes in at ${T[t].name}.`, S.current);
    if (action.cost) log(`The Ring's corruption is now ${c.pressure}/${CORRUPTION}.`);
    if (c.pressure === CORRUPTION) return { victory: { side: 1, reason: 'ringCaptured' } };
    return {};
  }
  function ringDistance(t) {
    return Math.min(...RING_PATHS.filter(path => path.includes(t)).map(path => path.length - 1 - path.indexOf(t)));
  }

  G.CAMPAIGN = { ROUTE, SIDES, LIMIT, PRESSURE, HAND_LIMIT, CARDS, create, validSize, normalizeFormat, teamNames, current, next,
    onward, waypoints, isWaypoint, RING_PATHS, RING_EDGES, RING_LIMIT, CORRUPTION, RING_DESTINATION, SANCTUARIES,
    ringActions, actOnRing, ringDistance,
    reserveAnchors, priority, postCommander, startTurn, moveCommand, canMoveCommand, recordConquest,
    draw, cardTargets, playCard, discardCard, canMarch, march, tick };
})(window);
