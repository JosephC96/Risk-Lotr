// Run with: node tools/check_campaign.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
global.window = global;
for (const name of ['noise', 'data', 'user-map-data', 'user-map', 'campaign', 'game', 'ai']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js', name + '.js'), 'utf8'), { filename: name + '.js' });
}

const T = DATA.TERR, C = CAMPAIGN;
const first = C.ROUTE[0], second = C.ROUTE[1];
const setup = (format, count, deal = 'random', type = 'human') => GAME.newGame({
  mode: 'campaign', campaignFormat: format, deal, neutral: true, fortify: 'connected', cardMode: 'fixed',
  players: Array.from({ length: count }, (_, faction) => ({ faction, type })),
});
function deploy(s) {
  for (let i = 0; i < 100 && ['claim', 'place'].includes(s.phase); i++) {
    if (s.phase === 'claim') assert(GAME.claim(s.owner.indexOf(-1)));
    else GAME.setupAutoRest();
  }
  assert.equal(s.phase, 'reinforce');
  assert(s.owner.every(p => p >= 0));
  assert(s.armies.every(n => n >= 1));
  assert(s.players.every(p => s.owner[s.campaign.commanders[p.idx]] === p.idx));
  assert.equal(s.campaign.deck.length + s.campaign.hands.flat().length, 18);
  assert(s.campaign.hands.every(hand => hand.length === 1 && C.CARDS[hand[0]].type === 'Tactic'));
}
function finishRound(s) {
  s.current = (s.first + s.players.length - 1) % s.players.length;
  s.phase = 'fortify';
  GAME.endTurn();
}

assert.equal(new Set(C.ROUTE).size, C.ROUTE.length);
assert(C.ROUTE.slice(1).every((t, i) => T[C.ROUTE[i]].adj.includes(t)));
assert.throws(() => setup('escort', 3), /Invalid number of realms/);
for (const deal of ['random', 'manual']) {
  for (const n of [2, 3, 4, 5]) deploy(setup('race', n, deal));
  for (const n of [2, 4]) {
    const s = setup('escort', n, deal);
    assert.equal(s.owner[C.ROUTE[0]], 0);
    assert.equal(s.owner[C.ROUTE.at(-1)], 1);
    deploy(s);
    assert.equal(s.cfg.neutral, false);
    assert(s.campaign.teams.every((side, p) => side === p % 2));
  }
}

let s = setup('escort', 4);
deploy(s);
s.current = 0;
s.phase = 'reinforce';
s.campaign.commanders[0] = first;
s.owner[first] = 0;
s.owner[second] = 2;
assert(!GAME.canMoveCommander(second));
assert(!GAME.enemyTerritory(second));
s.owner[second] = 0;
s.campaign.hands[0] = ['levy', 'crossing', 'dispatch'];
s.armies[first] = s.armies[second] = 2;
assert(!GAME.playAdventure(1, C.ROUTE.at(-1)));
assert(GAME.playAdventure(1, second));
assert.equal(s.armies[first], 4);
assert.equal(s.armies[second], 4);
assert(!GAME.playAdventure(0, first));
assert(GAME.moveCommander(second));
assert(!GAME.moveCommander(first));
assert(GAME.discardAdventure(0));
assert.deepEqual(s.campaign.hands[0], ['dispatch']);

s.campaign.played = false;
s.campaign.moved = false;
assert(GAME.playAdventure(0, first));
assert.equal(s.campaign.commanders[0], first);
assert(!GAME.moveCommander(second));

// A draw from a conquest resolves an event immediately, with no extra hand card.
s.phase = 'fortify';
s.campaign.deck = ['stores'];
s.campaign.earned = true;
GAME.endTurn();
assert.equal(s.armies[first], 6);
assert(s.campaign.discard.includes('stores'));
assert(!s.campaign.earned);
assert.deepEqual(GAME.restore(GAME.serialize()).campaign, s.campaign);

// Escort can win by delivery. Pressure, blockade and deadline are separate paths.
s = setup('escort', 2);
deploy(s);
s.current = 0;
s.phase = 'fortify';
s.armies[second] = 2;
assert(GAME.marchConvoy());
assert(!GAME.marchConvoy());
assert.equal(s.campaign.step, 1);
finishRound(s);
assert.equal(s.campaign.step, 1);

s = setup('escort', 2);
deploy(s);
s.campaign.step = C.ROUTE.length - 2;
s.owner[C.current(s.campaign)] = 0;
s.owner[C.next(s.campaign)] = 0;
s.armies[C.next(s.campaign)] = 1;
finishRound(s);
assert.equal(s.campaign.step, C.ROUTE.length - 2);
s.armies[C.next(s.campaign)] = 2;
finishRound(s);
assert.equal(s.winner.reason, 'convoyDelivered');

s = setup('escort', 2);
deploy(s);
s.owner[first] = 1;
s.campaign.commanders[1] = first;
for (let i = 0; i < C.PRESSURE; i++) finishRound(s);
assert.equal(s.winner.reason, 'convoySeized');

s = setup('escort', 2);
deploy(s);
s.owner[second] = 1;
s.round = C.LIMIT;
finishRound(s);
assert.equal(s.winner.reason, 'convoyDelayed');

s = setup('race', 2);
deploy(s);
s.owner[second] = 1;
s.campaign.commanders[1] = second;
finishRound(s);
assert.equal(s.campaign.step, 1);
assert.equal(s.campaign.points[1], 2);

// Ring Quest uses the drawn borders and game actions, with a separate final act.
for (const path of C.RING_PATHS) {
  assert.equal(path[0], 16);
  assert.equal(path.at(-1), 54);
  assert(path.slice(1).every((t, i) => T[path[i]].adj.includes(t)));
}
assert.throws(() => setup('ring', 3), /Invalid number of realms/);
s = setup('ring', 2, 'manual');
assert.equal(C.current(s.campaign), 16);
assert.equal(s.owner[16], 0);
assert.equal(s.owner[54], 1);
deploy(s);
assert.deepEqual(s.campaign.teams, [0, 1]);
s.current = 0; s.phase = 'fortify';
assert(GAME.ringAction('travel', 8));
assert(!GAME.ringAction('travel', 7));
finishRound(s);
s.current = 0; s.phase = 'fortify';
assert(GAME.ringAction('travel', 7));
finishRound(s);
s.current = 0; s.phase = 'fortify';
assert.deepEqual(C.ringActions(s).filter(a => a.kind === 'travel').map(a => a.t), [6, 35]);
assert(!GAME.ringAction('travel', 54));
s.owner[6] = 0;
assert(GAME.ringAction('travel', 6));
finishRound(s);
s.current = 0; s.phase = 'fortify'; s.campaign.pressure = 3;
assert(GAME.ringAction('rest', 6));
assert.equal(s.campaign.pressure, 1);
finishRound(s);
s.current = 0; s.phase = 'fortify';
assert(!GAME.ringAction('rest', 6));
const progress = GAME.serialize();
s = GAME.restore(progress);
assert.deepEqual(s.campaign.ring.trail, [16, 8, 7, 6]);
assert.deepEqual(s.campaign.ring.sheltered, [6]);
s.campaign.ring.trail = C.RING_PATHS[0].slice(0, -1);
s.owner[54] = 1;
assert(GAME.ringAction('travel', 54));
assert.equal(s.campaign.pressure, 2);
assert(!s.winner);
assert(!GAME.ringAction('destroy', 54));
finishRound(s);
s.current = 0; s.phase = 'fortify';
assert(GAME.ringAction('destroy', 54));
assert.equal(s.winner.reason, 'ringDestroyed');
assert(s.campaign.ring.destroyed);

s = setup('ring', 4);
deploy(s);
s.current = 1; s.phase = 'fortify'; s.campaign.pressure = 2;
s.owner[16] = 1; s.campaign.commanders[1] = 16;
assert(GAME.ringAction('hunt', 16));
assert.equal(s.campaign.pressure, 4);
assert(!GAME.ringAction('hunt', 16));
finishRound(s);
s.current = 1; s.phase = 'fortify';
assert(GAME.ringAction('hunt', 16));
assert.equal(s.winner.reason, 'ringCaptured');
assert.deepEqual(s.winner.winners, [1, 3]);

s = setup('ring', 2);
deploy(s);
s.round = C.RING_LIMIT;
finishRound(s);
assert.equal(s.winner.reason, 'ringOutlasted');

const io = { aborted: () => false, trade() {}, place() {}, beginAttack() {}, battle() {}, endAttack() {}, move() {} };
async function simulate() {
  const winners = {};
  for (const [format, n] of [['race', 2], ['race', 5], ['escort', 2], ['escort', 4], ['ring', 2], ['ring', 4]]) {
    for (let run = 0; run < 5; run++) {
      const s = setup(format, n, 'random', 'ai');
      deploy(s);
      let turns = 0;
      const limit = format === 'ring' ? C.RING_LIMIT : C.LIMIT;
      while (!s.winner && turns++ < n * limit + 1) {
        await AI.takeTurn(s.current, io);
        assert(!s.pending);
        assert(s.armies.every(n => n >= 1));
        assert(s.campaign.hands.every(hand => hand.length <= C.HAND_LIMIT));
      }
      assert(s.winner);
      winners[s.winner.reason] = (winners[s.winner.reason] || 0) + 1;
    }
  }
  console.log('PASS: campaign setup, route borders, leaders, cards, saves, Ring orders, victory conditions, and 30 full AI matches.', winners);
}
simulate().catch(error => { console.error(error); process.exitCode = 1; });
