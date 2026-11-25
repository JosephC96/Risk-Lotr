// Run with: node tools/check_user_map.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
global.window = global;
for (const name of ['noise','data','user-map-data','user-map','campaign','game','ai']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js',name+'.js'),'utf8'), {filename:name+'.js'});
}
const cfg = (n,mode='classic',deal='random',neutral=false) => ({mode,deal,neutral,fortify:'adjacent',cardMode:'progressive',
  quickTarget:DATA.QUICK_TARGET,quickRounds:12,players:Array.from({length:n},(_,i)=>({faction:i,type:'human'}))});
const T=DATA.TERR;
assert.equal(T.length,64);
assert.deepEqual(DATA.REGIONS.map(r=>T.filter(t=>t.region===r.id).length),[11,7,8,5,4,7,10,6,6]);
assert.deepEqual(DATA.REGIONS.map(r=>r.bonus),[7,3,5,4,2,4,7,2,2]);
const reached=new Set([0]),queue=[0];
while(queue.length) for(const id of T[queue.pop()].adj) if(!reached.has(id)){reached.add(id);queue.push(id);}
assert.equal(reached.size,64);
T.forEach((t,i)=>{assert.equal(t.id,i);assert(t.polygons.length);assert(!t.adj.includes(i));t.adj.forEach(a=>assert(T[a].adj.includes(i)));});
assert.equal(T.reduce((sum,t)=>sum+t.adj.length,0)/2,100);
for (const [a,b] of USER_MAP.barriers) assert(!T[a].adj.includes(b));
assert.equal(DATA.SEA_LINKS.length,5);
let setups=0;
for(let n=2;n<=5;n++) for(const neutral of (n===2?[false,true]:[false])) for(const mode of ['classic','missions','quick','bastions']) for(const deal of ['random','manual']) {
  const s=GAME.newGame(cfg(n,mode,deal,neutral));
  assert.equal(s.deck.length + s.players.reduce((sum,p)=>sum+p.cards.length,0),66);
  assert(s.players.every(p=>p.cards.length===(p.neutral?0:1)));
  for(let i=0;i<1000 && ['claim','place'].includes(s.phase);i++) {
    if(s.phase==='claim') GAME.claim(s.owner.indexOf(-1)); else GAME.setupAutoRest();
  }
  assert.equal(s.phase,'reinforce');
  assert(!s.winner);
  assert(s.owner.every(o=>o>=0&&o<s.players.length));
  assert(s.armies.every(a=>a>=1));
  assert(s.setupPool.every(a=>a===0));
  if (neutral) assert(s.armies.every((a,t)=>!s.players[s.owner[t]].neutral || a===2));
  s.players.forEach(p=>{if(p.mission) assert(!GAME.missionDone(p));});
  setups++;
}
// Quick games must require expansion beyond the two-player initial deal.
let s=GAME.newGame(cfg(2,'quick'));
assert.equal(DATA.QUICK_TARGET,40);
assert.equal(GAME.countTerr(0),32);
assert.equal(GAME.countTerr(1),32);
const saved=GAME.serialize();
assert.equal(GAME.restore(saved).mapId,DATA.MAP_ID);
const stable=GAME.S;
assert.throws(()=>GAME.restore(JSON.stringify({...stable,mapId:null,owner:Array(42).fill(0),armies:Array(42).fill(1)})),/different map/);
assert.equal(GAME.S,stable);
s=GAME.S;
// Both a shared border and a drawn sea route support attacks/movement.
for(const [a,b] of [[4, T[4].adj[0]],DATA.SEA_LINKS[0]]) {
  s.current=0;s.phase='attack';s.owner.fill(1);s.owner[a]=0;s.armies.fill(2);s.armies[a]=10;
  assert(GAME.canAttack(a,b));
  const distant=T.find(t=>t.id!==a&&!T[a].adj.includes(t.id)).id;
  assert(!GAME.canAttack(a,distant));
  s.phase='fortify';s.owner[b]=0;s.fortified=false;
  assert(GAME.fortify(a,b,3));assert.equal(s.armies[a],7);assert.equal(s.armies[b],5);
  s.fortified=false;s.owner[distant]=0;
  assert(!GAME.fortify(a,distant,1));
}

// Occupation must resolve before victory, with the survivors of the last roll.
const [a,b] = [4,T[4].adj[0]];
s=GAME.newGame(cfg(2));
s.current=0; s.phase='attack'; s.owner.fill(0); s.owner[b]=1;
s.armies.fill(2); s.armies[a]=6;
function withDice(dice, play) {
  const realRandom=Math.random;
  Math.random=()=> {
    assert(dice.length,'Unexpected die roll');
    return (dice.shift()-.5)/6;
  };
  try { return play(); } finally { Math.random=realRandom; }
}
const conquest=withDice([6,2,1,5,3],()=>GAME.attack(a,b,3));
assert.equal(conquest.conquered,false);
s.armies[b]=1;
const finalAttack=withDice([6,2,1,5],()=>GAME.attack(a,b,3));
assert(finalAttack.conquered);
assert.equal(s.winner,null);
assert.equal(s.armies[b],0);
assert(GAME.moveAfterConquest(s.pending.min));
assert.equal(s.armies[b],3);
assert.equal(s.winner.reason,'domination');

// Two teams use separate holdings. A calculated defence bonus matches the dice.
s=GAME.newGame({...cfg(4,'bastions'),teams:true});
assert.deepEqual(s.bastions.teams,[0,1,0,1]);
assert.throws(()=>GAME.newGame({...cfg(3,'bastions'),teams:true}),/exactly four/);
const bastion=DATA.BASTIONS[0], neighbor=T[bastion].adj[0];
s.phase='attack'; s.current=0; s.owner[neighbor]=0; s.owner[bastion]=2; s.armies[neighbor]=3; s.armies[bastion]=1;
assert(!GAME.canAttack(neighbor,bastion));
assert(!GAME.fortifyTargets(neighbor).includes(bastion));
s.owner[bastion]=1;
assert(GAME.canAttack(neighbor,bastion));
const defended=withDice([5,2,4],()=>GAME.attack(neighbor,bastion,2));
assert.deepEqual(defended.pairs,[false]);
assert.equal(defended.defence,1);
assert(Math.abs(AI.winP(1,1,1)-10/36)<1e-9);
assert(Math.abs(AI.winP(1,1)-15/36)<1e-9);

// Each supplied bastion receives one garrison, with no allied supply bypass.
const target=DATA.BASTIONS[1], trail=[bastion], prev=new Map([[bastion,null]]);
for (let i=0;i<trail.length && !prev.has(target);i++) {
  for (const next of T[trail[i]].adj) if (!prev.has(next)) { prev.set(next,trail[i]); trail.push(next); }
}
const route=[];
for (let t=target;t!==null;t=prev.get(t)) route.push(t);
s.owner.fill(1);
route.forEach(t=>s.owner[t]=2);
s.owner[bastion]=0; s.owner[target]=0;
assert.deepEqual(GAME.suppliedBastions(0),[]);
route.forEach(t=>s.owner[t]=0);
assert(GAME.suppliedBastions(0).includes(bastion));
assert(GAME.suppliedBastions(0).includes(target));
s.first=0; s.current=3; s.phase='fortify'; s.armies.fill(2);
GAME.endTurn();
assert.equal(s.bastions.points[0],GAME.bastionStandings().find(x=>x.id===0).held);
assert.equal(s.armies[bastion],3);
assert.equal(s.armies[target],3);
assert.equal(s.current,0);
assert.deepEqual(GAME.restore(GAME.serialize()).bastions,s.bastions);
const round=GAME.S.round;
GAME.S.players[0].alive=false;
GAME.S.owner=GAME.S.owner.map(o=>o===0?1:o);
GAME.S.first=0; GAME.S.current=1; GAME.S.phase='fortify';
GAME.endTurn();
assert.equal(GAME.S.round,round);
GAME.S.round=DATA.BASTION_ROUNDS; GAME.S.bastions.points[1]=100; GAME.S.current=3; GAME.S.phase='fortify';
GAME.endTurn();
assert.equal(GAME.S.winner.reason,'renown');
assert.deepEqual(GAME.S.winner.winners,[1,3]);

// Equal renown, territory and army totals produce a draw.
s=GAME.newGame({...cfg(4,'bastions'),teams:true});
s.owner=s.owner.map((_,i)=>i%4);
s.armies.fill(2);
for (const t of DATA.BASTIONS) s.bastions.points[s.owner[t]]--;
s.bastions.points=s.bastions.points.map(points=>points+10);
s.round=s.bastions.rounds; s.current=3; s.first=0; s.phase='fortify';
GAME.endTurn();
assert.equal(s.winner.reason,'draw');
assert.deepEqual(s.winner.winners,[]);
console.log(`PASS: ${setups} setups, current map, conquest and victory, bastion odds, supply, alliances, scoring, save compatibility.`);
