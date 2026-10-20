import {mkdirSync,writeFileSync} from 'node:fs';
import {cueVoices,EFFECTS_VOLUME,EFFECTS_PITCH_RATIO} from '../../src/ui/audio-cues.js';

const sampleRate=44100;
const output='test-results/audio';
mkdirSync(output,{recursive:true});
function render(name,timeline){
  const voices=timeline.flatMap(({kind,index=0,at=0})=>cueVoices(kind,index).map(voice=>({...voice,at:voice.at+at})));
  const duration=Math.max(...voices.map(voice=>voice.at+voice.duration))+.12;
  const samples=new Float64Array(Math.ceil(duration*sampleRate)*2);
  for(const voice of voices){
    const offset=Math.round(voice.at*sampleRate),count=Math.ceil(voice.duration*sampleRate);
    const left=Math.cos((voice.pan+1)*Math.PI/4),right=Math.sin((voice.pan+1)*Math.PI/4);
    const glide=Math.log(voice.frequencyEnd/voice.frequency)/voice.duration;
    for(let index=0;index<count;index++){
      const time=index/sampleRate;
      const release=voice.attack+voice.hold;
      const envelope=time<voice.attack?voice.volume*time/voice.attack:time<release?voice.volume:voice.volume*Math.exp(Math.log(.00001/voice.volume)*(time-release)/(voice.duration-release));
      const phase=2*Math.PI*voice.frequency*(Math.abs(glide)<1e-10?time:Math.expm1(glide*time)/glide);
      const value=Math.sin(phase)*envelope*EFFECTS_VOLUME;
      samples[(offset+index)*2]+=value*left;
      samples[(offset+index)*2+1]+=value*right;
    }
  }
  const peak=samples.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
  if(peak>=.9)throw new Error('Preview has insufficient audio headroom');
  const file=Buffer.alloc(44+samples.length*2);
  file.write('RIFF',0);file.writeUInt32LE(file.length-8,4);file.write('WAVEfmt ',8);file.writeUInt32LE(16,16);file.writeUInt16LE(1,20);file.writeUInt16LE(2,22);
  file.writeUInt32LE(sampleRate,24);file.writeUInt32LE(sampleRate*4,28);file.writeUInt16LE(4,32);file.writeUInt16LE(16,34);file.write('data',36);file.writeUInt32LE(samples.length*2,40);
  for(let index=0;index<samples.length;index++)file.writeInt16LE(Math.round(samples[index]*32767),44+index*2);
  const path=output+'/'+name+'.wav';writeFileSync(path,file);
  return {path,duration:Number(duration.toFixed(3)),channels:2,peakDbFS:Number((20*Math.log10(peak)).toFixed(2))};
}
const results=[
  render('reels-and-small-win',[{kind:'spin'},...[0,1,2,3,4].map(index=>({kind:'stop',index,at:.5+index*.2})),{kind:'small',at:1.8}]),
  render('big-win',[{kind:'big'}]),
];
writeFileSync(output+'/preview-metadata.json',JSON.stringify({originalSynthesis:true,externalSamples:false,timbre:'layered-glass-soft-body-stereo-reflections',pitchRatio:EFFECTS_PITCH_RATIO,results},null,2));
console.log(JSON.stringify(results,null,2));
