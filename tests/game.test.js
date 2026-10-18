import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, createRound, readState, SYMBOLS } from '../src/game.js';

test('each demo payout reconciles with the balance',()=>{
  for(const [roll,payout] of [[0,0],[.5,200],[.8,500],[.95,2000],[.99999,2000]]){
    const {state,round}=createRound(freshState(),100,roll,`round-${roll}`);
    assert.equal(round.payout,payout);assert.equal(state.balance,10000-100+payout);assert.equal(round.net,payout-100);
  }
});
test('duplicate ID does not change the ledger twice',()=>{
  const first=createRound(freshState(),100,.9,'one');const repeat=createRound(first.state,100,.1,'one');
  assert.equal(repeat.duplicate,true);assert.deepEqual(repeat.state,first.state);
  const last=createRound({...freshState(),balance:100},100,.1,'last');
  assert.equal(createRound(last.state,100,.9,'last').duplicate,true);
});
test('invalid bets and insufficient funds are rejected',()=>{
  for(const bet of [-1,0,10,NaN,1.5])assert.throws(()=>createRound(freshState(),bet,.5,'one'));
  assert.throws(()=>createRound({...freshState(),balance:49},50,.5,'one'));
  for(const roll of [-1,1,NaN,Infinity])assert.throws(()=>createRound(freshState(),100,roll,'one'));
});
test('milestone is awarded once and history is bounded',()=>{
  let state=freshState();let count=0;
  for(let i=0;i<150;i++){const r=createRound(state,100,.99,`id-${i}`);state=r.state;if(r.round.milestone)count++;}
  assert.equal(count,1);assert.equal(state.history.length,100);assert.equal(state.balance,295000);
  assert.deepEqual(readState(JSON.stringify(state)),state);
});
test('invalid persisted state safely resets',()=>{
  for(const raw of [null,'bad','{}',JSON.stringify({...freshState(),balance:-100}),JSON.stringify({...freshState(),history:[{}]})])assert.deepEqual(readState(raw),freshState());
});

test('all 5 by 3 outcomes display the paid symbols in the middle row',()=>{
  for(let i=0;i<1000;i++){
    const {round,state}=createRound(freshState(),100,i/1000,`grid-${i}`);
    assert.equal(round.grid.length,5);
    assert.deepEqual(round.grid.map(col=>col[1]),round.symbols);
    for(const col of round.grid){assert.equal(col.length,3);assert.ok(col.every(s=>SYMBOLS.includes(s)));}
    if(round.payout)assert.equal(new Set(round.symbols).size,1);
    else assert.ok(new Set(round.symbols).size>1);
    assert.deepEqual(readState(JSON.stringify(state)),state);
  }
});

test('incomplete grids and mismatched central symbols cannot restore',()=>{
  const {state}=createRound(freshState(),100,.9,'bad-grid');
  const incomplete=structuredClone(state);incomplete.history[0].grid.pop();
  assert.deepEqual(readState(JSON.stringify(incomplete)),freshState());
  const wrong=structuredClone(state);wrong.history[0].grid[0][1]='ankh';
  assert.deepEqual(readState(JSON.stringify(wrong)),freshState());
});
