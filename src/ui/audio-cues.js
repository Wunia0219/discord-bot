// Original synthesized cues. No recordings, samples or melody from a sound library.
// A rounded body and restrained glass overtones keep the high register clear.
export const GLASS_LAYERS = Object.freeze([
  {ratio:1,level:1.1,decay:1.5,attack:.005,pan:0,endRatio:.998},
  {ratio:2.002,level:.24,decay:1.05,attack:.003,pan:-.18,endRatio:.999},
  {ratio:3.99,level:.065,decay:.5,attack:.002,pan:.18,endRatio:.994},
  {ratio:.5,level:.2,decay:.65,attack:.007,pan:0,endRatio:1},
]);
export const EFFECTS_VOLUME = .8;
export const EFFECTS_PITCH_RATIO = 2; // One octave higher for a brighter, sparkling bell tone.
export const MUSIC_SOURCE = null; // Set a local asset URL when the supplied music is ready.
const note=(frequency,at,duration,volume)=>({frequency,at,duration,volume});

export function audioCue(kind,index=0){
  if(kind==='spin')return [note(293.66,0,.1,.065),note(440,.055,.12,.06),note(587.33,.11,.13,.055)];
  if(kind==='stop'){
    const frequency=[329.63,369.99,440,493.88,587.33][index];
    if(!frequency)return [];
    return [note(frequency,0,.15,.075),note(frequency*1.5,.065,.14,.04)];
  }
  if(kind==='return')return [note(440,0,.18,.06),note(587.33,.075,.3,.06)];
  if(kind==='small')return [293.66,440,369.99,587.33,440,739.99,587.33,880].map((frequency,index)=>
    note(frequency,index*.095,index===7?.4:.17,index===7?.08:.07)
  );
  if(kind==='big')return [293.66,369.99,440,587.33,369.99,440,587.33,739.99,440,587.33,739.99,880,587.33,739.99,880,1174.66].map((frequency,index)=>
    note(frequency,index*.085,index===15?.4:.18,index===15?.075:.065)
  ).concat([note(293.66,1.57,.45,.03),note(440,1.57,.45,.03),note(587.33,1.57,.45,.03),note(880,1.7,.3,.04)]);
  return [];
}

// The browser and offline audition renderer use the same voice plan/envelope.
export function cueVoices(kind,index=0){
  const notes=audioCue(kind,index);
  if(!notes.length)return [];
  const voices=notes.flatMap((note,noteIndex)=>GLASS_LAYERS.map(layer=>{
    const frequency=note.frequency*EFFECTS_PITCH_RATIO*layer.ratio;
    return {
      at:note.at,frequency,frequencyEnd:frequency*layer.endRatio,
      duration:note.duration*layer.decay,volume:note.volume*layer.level,
      attack:layer.attack,hold:0,pan:layer.pan+(noteIndex%3-1)*.065,
    };
  }));
  // Quiet early reflections on the final note add space without washing out the rhythm.
  const last=notes.at(-1),frequency=last.frequency*EFFECTS_PITCH_RATIO;
  for(const [delay,level,pan] of [[.023,.12,-.45],[.041,.085,.45],[.067,.055,-.3],[.101,.035,.3]]){
    voices.push({at:last.at+delay,frequency,frequencyEnd:frequency*.998,duration:last.duration*1.5+.08,volume:last.volume*level,attack:.012,hold:0,pan});
  }
  if(kind==='spin'||kind==='stop'){
    // A short falling transient gives the button/reel a tactile landing beneath the ping.
    voices.push({at:0,frequency:1450,frequencyEnd:780,duration:.028,volume:.018,attack:.0015,hold:0,pan:kind==='stop'?(index-2)*.1:0});
  }
  return voices.filter(voice=>voice.frequency<10000&&voice.frequencyEnd<10000);
}
