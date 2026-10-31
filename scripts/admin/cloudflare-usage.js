import {appendFileSync,existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {fetchUsage,prepareUsage,readUsageState,usageSummary} from '../../monitor/cloudflare-usage.js';
import {operationsWebhook,postNotification} from '../../monitor/discord.js';

const DIRECTORY='test-results/cloudflare-usage',WORKFLOW='cloudflare-usage.yml';
const read=path=>{
  if(statSync(path).size>65536)throw new Error('Usage notification state is too large');
  return JSON.parse(readFileSync(path,'utf8'));
};
const save=(name,value)=>{
  mkdirSync(DIRECTORY,{recursive:true});
  const path=`${DIRECTORY}/${name}.json`;
  writeFileSync(path+'.tmp',JSON.stringify(value)+'\n');renameSync(path+'.tmp',path);
};
function output(name,value,env){if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`${name}=${value}\n`);}

export async function previousUsageArtifact(env,{fetchImpl=globalThis.fetch.bind(globalThis)}={}){
  const repository=env.GITHUB_REPOSITORY,branch=env.GITHUB_DEFAULT_BRANCH;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!branch||env.GITHUB_REF!==`refs/heads/${branch}`||!env.GITHUB_TOKEN||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||''))throw new Error('Trusted default-branch Actions context required');
  const get=async path=>{
    const response=await fetchImpl(`https://api.github.com/repos/${repository}/${path}`,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'circus-usage-monitor'},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Cannot restore usage notification history');
    return response.json();
  };
  const body=await get(`actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&per_page=100`);
  if(!Array.isArray(body.workflow_runs))throw new Error('Invalid usage workflow history');
  const runs=body.workflow_runs.filter(run=>run.head_branch===branch&&run.head_repository?.full_name===repository&&run.path===`.github/workflows/${WORKFLOW}`&&['schedule','workflow_dispatch'].includes(run.event)&&Number.isSafeInteger(run.id));
  if(Number(env.GITHUB_RUN_ATTEMPT)>1&&runs.some(run=>run.id>Number(env.GITHUB_RUN_ID)))throw new Error('Start a new workflow run instead of rerunning older notification history');
  for(const run of runs){
    const current=String(run.id)===env.GITHUB_RUN_ID;
    if(!current&&run.status!=='completed')continue;
    const artifacts=await get(`actions/runs/${run.id}/artifacts?per_page=100`);
    if(!Array.isArray(artifacts.artifacts)||artifacts.total_count>100)throw new Error('Invalid usage artifact history');
    const candidates=artifacts.artifacts.flatMap(artifact=>{
      const match=/^cf-usage-(state|intent)-(\d+)-(\d+)$/.exec(artifact.name||'');
      if(!match||Number(match[2])!==run.id||current&&Number(match[3])>=Number(env.GITHUB_RUN_ATTEMPT))return [];
      if(artifact.expired||!Number.isSafeInteger(artifact.id)||artifact.size_in_bytes>65536)throw new Error('Previous usage state is unavailable; restore a trusted artifact before sending');
      return [{id:artifact.id,runId:run.id,attempt:Number(match[3]),final:match[1]==='state'}];
    }).sort((a,b)=>b.attempt-a.attempt||Number(b.final)-Number(a.final));
    if(candidates.length)return candidates[0];
    if(!current&&run.conclusion==='success')throw new Error('Previous usage state is missing; restore a trusted artifact before sending');
  }
  if(body.workflow_runs.length>=100)throw new Error('Previous usage state is missing; restore a trusted artifact before sending');
  return null;
}

export async function runUsageCommand(command,env=process.env){
  if(command==='previous'){
    const previous=await previousUsageArtifact(env);
    output('artifact',previous?.id||'',env);output('run',previous?.runId||'',env);
    return;
  }
  if(command==='prepare'||command==='dry-run'){
    if(command==='prepare')operationsWebhook(env.CF_USAGE_DISCORD_WEBHOOK);
    const input=`${DIRECTORY}/previous/state.json`;
    if(env.CF_USAGE_RESTORED==='true'&&!existsSync(input))throw new Error('Restored notification state is missing');
    const previous=existsSync(input)?read(input):undefined,now=Date.now();
    readUsageState(previous,now);
    let snapshot;
    try{snapshot=await fetchUsage({account:env.CF_ACCOUNT_ID,token:env.CF_ANALYTICS_TOKEN,now});}
    catch(error){console.error(error.message);}
    const result=prepareUsage(previous,snapshot,{now});
    if(command==='dry-run'){
      console.log(usageSummary(result));
      if(!result.queryOk)throw new Error('Cloudflare usage could not be verified');
      return;
    }
    save('state',result.state);save('report',result);
    output('send',result.send,env);
    return;
  }
  const statePath=`${DIRECTORY}/state.json`;
  if(command==='unsent'){
    const state=readUsageState(read(statePath),Date.now());
    if(state.pending?.status!=='sending')throw new Error('No prepared notification intent');
    state.notified=state.notified.filter(key=>!state.pending.keys.includes(key));
    Object.assign(state.pending,{status:'retry',nextAttempt:Date.now()});save('state',state);
    return;
  }
  if(command==='send'){
    if(!/^[1-9]\d*$/.test(env.CF_INTENT_ARTIFACT_ID||''))throw new Error('A saved notification intent artifact is required before POST');
    const state=readUsageState(read(statePath),Date.now());
    if(state.pending?.status!=='sending')throw new Error('No prepared notification intent');
    Object.assign(state.pending,await postNotification(operationsWebhook(env.CF_USAGE_DISCORD_WEBHOOK),{content:state.pending.content,allowed_mentions:{parse:[]}}));
    save('state',state);
    if(state.pending.status!=='sent'&&state.pending.status!=='retry')throw new Error(`Discord notification ${state.pending.status}; inspect delivery before retrying`);
    return;
  }
  if(command==='summary'){
    const result=read(`${DIRECTORY}/report.json`);result.state=readUsageState(read(statePath),Date.now());
    const summary=usageSummary(result);
    console.log(summary);
    if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,summary+'\n');
    if(['uncertain','blocked'].includes(result.state.pending?.status))console.log('::warning::Discord delivery needs review; this alert will not be blindly resent.');
    if(!result.queryOk)throw new Error('Cloudflare usage could not be verified');
    return;
  }
  throw new Error('Use previous, prepare, send, unsent, summary or dry-run');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await runUsageCommand(process.argv[2]);}catch(error){console.error(error.message);process.exitCode=1;}
}
