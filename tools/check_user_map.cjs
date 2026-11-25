// Run with: node tools/check_user_map.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
global.window = global;
for (const name of ['noise','data','user-map-data','user-map','game']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js',name+'.js'),'utf8'), {filename:name+'.js'});
}
const cfg = (n,mode='classic',deal='random',neutral=false) => ({mode,deal,neutral,fortify:'adjacent',cardMode:'progressive',
  quickTarget:DATA.QUICK_TARGET,quickRounds:12,players:Array.from({length:n},(_,i)=>({faction:i,type:'human'}))});
const T=DATA.TERR;
assert.equal(T.length,64);
assert.deepEqual(DATA.REGIONS.map(r=>T.filter(t=>t.region===r.id).length),[11,7,9,4,4,7,10,6,6]);
assert.deepEqual(DATA.REGIONS.map(r=>r.bonus),[7,3,5,4,2,4,7,2,2]);
const reached=new Set([0]),queue=[0];
while(queue.length) for(const id of T[queue.pop()].adj) if(!reached.has(id)){reached.add(id);queue.push(id);}
assert.equal(reached.size,64);
T.forEach((t,i)=>{assert.equal(t.id,i);assert(t.polygons.length);assert(!t.adj.includes(i));t.adj.forEach(a=>assert(T[a].adj.includes(i)));});
let setups=0;
for(let n=2;n<=5;n++) for(const neutral of (n===2?[false,true]:[false])) for(const mode of ['classic','missions','quick']) for(const deal of ['random','manual']) {
  const s=GAME.newGame(cfg(n,mode,deal,neutral));
  assert.equal(s.deck.length,66);
  for(let i=0;i<1000 && ['claim','place'].includes(s.phase);i++) {
    if(s.phase==='claim') GAME.claim(s.owner.indexOf(-1)); else GAME.setupAutoRest();
  }
  assert.equal(s.phase,'reinforce');
  assert(!s.winner);
  assert(s.owner.every(o=>o>=0&&o<s.players.length));
  assert(s.armies.every(a=>a>=1));
  assert(s.setupPool.every(a=>a===0));
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
for(const [a,b] of [[0,1],DATA.SEA_LINKS[0]]) {
  s.current=0;s.phase='attack';s.owner.fill(1);s.owner[a]=0;s.armies.fill(2);s.armies[a]=10;
  assert(GAME.canAttack(a,b));
  const distant=T.find(t=>t.id!==a&&!T[a].adj.includes(t.id)).id;
  assert(!GAME.canAttack(a,distant));
  s.phase='fortify';s.owner[b]=0;s.fortified=false;
  assert(GAME.fortify(a,b,3));assert.equal(s.armies[a],7);assert.equal(s.armies[b],5);
  s.fortified=false;s.owner[distant]=0;
  assert(!GAME.fortify(a,distant,1));
}
console.log(`PASS: ${setups} setups, 64 connected territories, region bonuses, deck, victory thresholds, borders/sea routes, save compatibility.`);
