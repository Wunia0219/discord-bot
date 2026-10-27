import test from 'node:test';
import assert from 'node:assert/strict';
import { presentRoundWin } from '../src/ui/wins/round-win.js';
import { BETS } from '../src/game/index.js';

test('whole-round winnings select one matching sound and presentation at every payout boundary',()=>{
  for(const bet of BETS){
    for(const [payout,tier,cue] of [[0,null,null],[bet/2,null,'return'],[bet,null,'return'],[bet+1,null,'small'],[10*bet-1,null,'small'],[10*bet,'big','big'],[30*bet-1,'big','big'],[30*bet,'super','big'],[100*bet-1,'super','big'],[100*bet,'mega','big'],[2700*bet,'mega','big']]){
      const events=[];
      const result=presentRoundWin({bet,payout},{
        sound:{win:kind=>events.push(['audio',kind])},
        celebrate:(kind,amount)=>events.push(['celebration',kind,amount]),
        celebrateSmall:()=>events.push(['small-presentation']),
      });
      const expected=[];
      if(tier)expected.push(['celebration',tier,payout]);
      else if(cue==='small')expected.push(['small-presentation']);
      if(cue)expected.push(['audio',cue]);
      assert.equal(result,tier,`bet ${bet}, payout ${payout}`);
      assert.deepEqual(events,expected,`bet ${bet}, payout ${payout}: start the visual before one audio cue`);
    }
  }
});
